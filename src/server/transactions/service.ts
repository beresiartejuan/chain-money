import "server-only";
import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  type NewTransaction,
  type Transaction,
  transactions,
} from "@/db/schema";
import { currencyExponent } from "@/lib/currency";
import { newId } from "@/lib/ids";
import { transactionSchema } from "@/lib/validation/transaction";
import {
  InsufficientFundsError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import { hasPermission } from "@/server/permissions/access";
import { requireBoxAccess } from "@/server/permissions/assert";
import { ALLOW_NEGATIVE_BALANCE } from "@/server/transactions/config";

/**
 * Lógica de negocio de transacciones (T055), pura respecto al request:
 * recibe la db y el `userId` por parámetro y no toca cookies
 * (`next/headers`), igual que el resto de los services. Así es testeable
 * con una DB real y reutilizable desde actions, Route Handlers o jobs.
 * `actions.ts` es la capa delgada que resuelve la sesión.
 *
 * T057: la atribución (`createdBy`, `createdAt`) es forzada server-side,
 * ningún campo del input puede tocarla. T058: los `withdraw` validan el
 * balance dentro de una transacción de DB. T059: `resetBox` resetea el
 * balance a 0 con una transacción `reset`.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/**
 * Lo mínimo que `toFieldErrors` necesita de un error de Zod (mismo patrón
 * que en `@/server/auth/service`): se define acá para no acoplar este
 * service a la versión interna de Zod ni al módulo de auth.
 */
type ZodLikeError = { issues: { path: PropertyKey[]; message: string }[] };

/** Convierte un error de Zod en el mapa campo → mensajes que espera la UI. */
function toFieldErrors(error: ZodLikeError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field === "") continue;
    const messages = fieldErrors[field] ?? [];
    messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return fieldErrors;
}

/**
 * Entrada cruda de creación (antes de validar): los valores llegan como
 * strings desde el form. El schema compartido (`transactionSchema`) hace
 * el resto: trim de opcionales, límites y `amount` → minor units.
 */
export type CreateTransactionInput = {
  type: string;
  amount: string;
  counterparty?: string;
  note?: string;
};

/**
 * Nota autogenerada de la transacción `reset` que inserta `resetBox`
 * (T059). El usuario no elige la nota de un reset.
 */
export const RESET_NOTE = "Reset de alcancía";

/**
 * Resultado de `resetBox` (T059): `reset` es `false` cuando el balance ya
 * era 0 y no se insertó nada (no-op idempotente, base de T060); en ese caso
 * el historial queda intacto.
 */
export type ResetBoxResult = {
  ok: true;
  reset: boolean;
  /** Balance de la alcancía tras la operación: siempre 0. */
  balanceMinor: number;
};

/**
 * Reintentos ante `SQLITE_BUSY` en el `BEGIN IMMEDIATE` de la transacción.
 * El driver local (@libsql/client 0.18) abre cada transacción con busy
 * timeout 0 (tursodatabase/libsql-client-ts#288): si otra transacción
 * escribiendo gana el lock primero, la nuestra falla al instante. La
 * escritura es igual de válida, así que se reintenta con backoff corto en
 * vez de propagar un error 500 al usuario. `InsufficientFundsError` NUNCA
 * se reintenta (es una respuesta de dominio, no contention).
 */
const BUSY_RETRY_MAX_ATTEMPTS = 3;
const BUSY_RETRY_BASE_DELAY_MS = 25;

/**
 * Recorre la cadena de `cause` buscando el code `SQLITE_BUSY` de libSQL:
 * drizzle envuelve los errores de query en `DrizzleQueryError`, cuyo
 * `cause` es el error del driver con `code: "SQLITE_BUSY"`. El `BEGIN
 * IMMEDIATE` falla antes de pasar por drizzle (error crudo del client), y
 * el recorrido por `cause` también lo alcanza.
 */
function isSqliteBusyError(error: unknown): boolean {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    const code = (current as { code?: unknown }).code;
    if (code === "SQLITE_BUSY") {
      return true;
    }
  }
  return false;
}

/** Espera `ms` milisegundos (para el backoff entre reintentos). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lo que `db` y el `tx` de una transacción comparten para los helpers de
 * acá abajo (select del balance, insert de transacciones). Estructura
 * mínima a propósito: así sirve para `db` y para el `tx` del callback de
 * `db.transaction`.
 */
type Executor = Pick<Db, "select" | "insert">;

/**
 * Expresión SQL del balance de una alcancía (T058/T059): `deposit` suma
 * +amountMinor, `withdraw` suma -amountMinor y `reset` suma su
 * `amountMinor` (que por construcción es -(balance previo) y lleva a 0).
 * `COALESCE` devuelve 0 para una alcancía sin transacciones. Se calcula,
 * nunca se almacena (PRODUCT.md, invariante 9).
 */
function balanceExpression() {
  return sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdraw' THEN -${transactions.amountMinor} ELSE ${transactions.amountMinor} END), 0)`;
}

/**
 * Balance actual de la alcancía `boxId` sumando todo su historial. Se pasa
 * el executor como parámetro para poder correr DENTRO de la transacción
 * (`tx`) cuando el caller lo necesita bajo lock.
 */
async function boxBalance(executor: Executor, boxId: string): Promise<number> {
  const rows = await executor
    .select({ balance: balanceExpression() })
    .from(transactions)
    .where(eq(transactions.boxId, boxId));
  const row = rows[0];
  return row ? row.balance : 0;
}

/**
 * Inserta la fila de transacción con atribución forzada: `values` SIEMPRE
 * sale de acá con `createdBy`/`createdAt` de server (el caller fija
 * `createdBy` con el userId autenticado y `createdAt` lo resuelve el
 * `$defaultFn` del schema). Ningún campo del input llega a este punto: el
 * schema de validación strippea llaves desconocidas y acá se reconstruye
 * el objeto campo por campo (T057).
 */
async function insertTransactionRow(
  executor: Executor,
  values: NewTransaction,
): Promise<Transaction> {
  const inserted = await executor
    .insert(transactions)
    .values(values)
    .returning();
  const transaction = inserted[0];
  if (!transaction) {
    throw new Error("Failed to insert transaction");
  }
  return transaction;
}

/**
 * Withdraw con la regla de balance (T058), dentro de transacción `BEGIN
 * IMMEDIATE` (modo default del driver libsql): SELECT del balance y, si
 * alcanza, INSERT en la MISMA transacción. El `BEGIN IMMEDIATE` toma el
 * lock de escritura antes del SELECT y lo retiene hasta el commit, y las
 * escrituras están serializadas, así que no hay ventana en la que dos
 * withdrawals pasen el chequeo con el mismo balance y juntos excedan.
 * Lanzar `InsufficientFundsError` hace rollback: la DB queda como estaba.
 */
async function insertWithdrawWithinBalance(
  db: Db,
  values: NewTransaction,
): Promise<Transaction> {
  return db.transaction(async (tx): Promise<Transaction> => {
    const balance = await boxBalance(tx, values.boxId);
    if (balance - values.amountMinor < 0) {
      // Respuesta de dominio ANTES de insertar: el rollback no tiene nada
      // que deshacer, el rechazado nunca se inserta.
      throw new InsufficientFundsError();
    }
    return insertTransactionRow(tx, values);
  });
}

/**
 * Ante `SQLITE_BUSY` el rollback automático del driver dejó la transacción
 * limpia: si el `BEGIN IMMEDIATE` falló, la tx nunca se abrió; si falló el
 * COMMIT, `Sqlite3Transaction.commit()` ya devolvió la conexión al pool y
 * `release` hace ROLLBACK de lo que quedara abierto. El reintento arranca
 * una transacción nueva, así que re-ejecutar el callback (select + insert
 * con un id/createdAt frescos) es correcto y no duplica filas.
 */

/**
 * Crea una transacción (deposit/withdraw) en la alcancía `boxId` a nombre
 * de `userId`:
 *
 * 1. Gate de acceso (`requireBoxAccess`): extraño sin relación o box
 *    inexistente → `NotFoundError`; la existencia de la box no se filtra a
 *    extraños. Un guest conocido pasa aunque su set de permisos esté vacío.
 * 2. Permiso (`hasPermission(create:transactions)`): el owner tiene todos
 *    los permisos; un guest necesita el permiso explícito en su
 *    `box_access` → si no, `PermissionError`.
 * 3. Validación con el schema compartido para el exponente de la moneda de
 *    la box (`currencyExponent(box.currency)`) → `ValidationError` con
 *    `fieldErrors` por campo.
 * 4. Atribución forzada (T057): `createdBy` es siempre `userId`
 *    autenticado y `createdAt` sale del `$defaultFn` del schema (server
 *    time). El schema strippea `createdBy`/`createdAt` extra del input y,
 *    como defensa en profundidad, el objeto a insertar se reconstruye acá
 *    campo por campo.
 * 5. Regla de balance (T058): con `ALLOW_NEGATIVE_BALANCE = false`, un
 *    `withdraw` corre DENTRO de una transacción `BEGIN IMMEDIATE` que
 *    primero calcula el balance (misma fórmula de `boxBalance`) y lanza
 *    `InsufficientFundsError` si `balance - amount < 0`, antes de insertar.
 *    Ante `SQLITE_BUSY` (lock tomado por otra transacción, ver comentario
 *    de `BUSY_RETRY_MAX_ATTEMPTS`) reintenta con backoff corto.
 *    Los deposits no consultan balance: siempre se permiten.
 *
 * @throws NotFoundError si la box no existe o `userId` no tiene relación.
 * @throws PermissionError si no tiene `create:transactions`.
 * @throws ValidationError si el input no pasa el schema (por campo).
 * @throws InsufficientFundsError si es withdraw y excede el balance.
 */
export async function createTransaction(
  db: Db,
  userId: string,
  boxId: string,
  input: CreateTransactionInput,
): Promise<Transaction> {
  const access = await requireBoxAccess(db, userId, boxId);

  if (!hasPermission(access, "create:transactions")) {
    throw new PermissionError();
  }

  const parsed = transactionSchema(
    currencyExponent(access.box.currency),
  ).safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }
  const { type, amount, counterparty, note } = parsed.data;

  const values: NewTransaction = {
    id: newId(),
    boxId,
    type,
    amountMinor: amount,
    counterparty: counterparty ?? null,
    note: note ?? "",
    createdBy: userId,
  };

  if (type === "withdraw" && !ALLOW_NEGATIVE_BALANCE) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= BUSY_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        return await insertWithdrawWithinBalance(db, values);
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          throw error; // respuesta de dominio: no es contention
        }
        if (isSqliteBusyError(error) && attempt < BUSY_RETRY_MAX_ATTEMPTS) {
          lastError = error;
          await delay(BUSY_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        throw error;
      }
    }
    // Inalcanzable: el loop siempre retorna o lanza. Guarda para TS.
    throw lastError;
  }

  // Deposit (o withdraw con ALLOW_NEGATIVE_BALANCE = true): insert directo,
  // atómico por sí solo, sin lock extendido.
  return insertTransactionRow(db, values);
}

/**
 * Reset dentro de transacción (T059): calcula el balance bajo el lock del
 * `BEGIN IMMEDIATE` y, si ≠ 0, inserta UNA transacción `reset` con
 * `amountMinor = -balance` que lleva el balance a 0 (si el balance era
 * negativo, `amountMinor` sale positivo: el reset es robusto, ver T061).
 * Si el balance ya es 0 no inserta nada (no-op idempotente, base de T060).
 */
async function resetBoxWithinTransaction(
  db: Db,
  userId: string,
  boxId: string,
): Promise<ResetBoxResult> {
  return db.transaction(async (tx): Promise<ResetBoxResult> => {
    const balance = await boxBalance(tx, boxId);
    if (balance === 0) {
      return { ok: true, reset: false, balanceMinor: 0 };
    }
    await insertTransactionRow(tx, {
      id: newId(),
      boxId,
      type: "reset",
      amountMinor: -balance,
      counterparty: null,
      note: RESET_NOTE,
      createdBy: userId,
    });
    return { ok: true, reset: true, balanceMinor: 0 };
  });
}

/**
 * Resetea el balance de la alcancía `boxId` a 0 (T059):
 *
 * 1. Gate de acceso (`requireBoxAccess`): extraño sin relación o box
 *    inexistente → `NotFoundError`; un guest conocido pasa.
 * 2. Permiso (`hasPermission(reset:box)`): el owner pasa siempre; un guest
 *    necesita `reset:box` explícito en su `box_access` → si no,
 *    `PermissionError`.
 * 3. Transacción de DB (`BEGIN IMMEDIATE`, con reintentos ante
 *    `SQLITE_BUSY` igual que `createTransaction`): balance ≠ 0 → inserta la
 *    transacción `reset` con nota `RESET_NOTE`, `counterparty: null` y
 *    `createdBy: userId` (atribución forzada); balance 0 → no-op sin
 *    insertar. En ambos casos devuelve `balanceMinor: 0`.
 *
 * @throws NotFoundError si la box no existe o `userId` no tiene relación.
 * @throws PermissionError si no tiene `reset:box`.
 */
export async function resetBox(
  db: Db,
  userId: string,
  boxId: string,
): Promise<ResetBoxResult> {
  const access = await requireBoxAccess(db, userId, boxId);

  if (!hasPermission(access, "reset:box")) {
    throw new PermissionError();
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= BUSY_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await resetBoxWithinTransaction(db, userId, boxId);
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < BUSY_RETRY_MAX_ATTEMPTS) {
        lastError = error;
        await delay(BUSY_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw error;
    }
  }
  // Inalcanzable: el loop siempre retorna o lanza. Guarda para TS.
  throw lastError;
}
