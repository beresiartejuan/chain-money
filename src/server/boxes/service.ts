import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  boxAccess,
  type NewSavingsBox,
  type Permission,
  type SavingsBox,
  savingsBoxes,
  transactions,
  users,
} from "@/db/schema";
import { isSupportedCurrency } from "@/lib/currency";
import { newId } from "@/lib/ids";
import {
  LimitReachedError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import {
  parsePermissionsJson,
  resolveEffectiveAccess,
} from "@/server/permissions/access";
import { requireBoxAccess } from "@/server/permissions/assert";

/**
 * Lógica de negocio de alcancías, pura respecto al request: cada función
 * recibe la db por parámetro y no toca cookies (`next/headers`) ni nada del
 * runtime de Next, igual que el resto de los services. Así es testeable con
 * una DB real y reutilizable desde actions, Route Handlers o jobs.
 * `actions.ts` es la capa delgada que resuelve la sesión.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/**
 * Tope de alcancías por usuario. Es lógica de acción, no de base de datos
 * (la tabla no tiene constraint): se enforcea atómicamente en `createBox`
 * con count + insert dentro de la misma transacción.
 */
export const MAX_BOXES_PER_USER = 5;

/** Límites del nombre de una alcancía (se valida sobre el valor con trim). */
import {
  BOX_NAME_MAX_LENGTH,
  BOX_NAME_MIN_LENGTH,
} from "@/lib/validation/box-name";

export { BOX_NAME_MAX_LENGTH, BOX_NAME_MIN_LENGTH };

/**
 * Reintentos ante `SQLITE_BUSY` en el `BEGIN IMMEDIATE` de la transacción.
 * El driver local (@libsql/client 0.18) abre cada transacción con busy
 * timeout 0 (tursodatabase/libsql-client-ts#288): si otra transacción
 * escribiendo gana el lock primero, la nuestra falla al instante. La
 * escritura es igual de válida, así que se reintenta con backoff corto en
 * vez de propagar un error 500 al usuario. `LimitReachedError` y
 * `ValidationError` NUNCA se reintentan (son respuestas de dominio, no
 * contention).
 */
const BUSY_RETRY_MAX_ATTEMPTS = 3;
const BUSY_RETRY_BASE_DELAY_MS = 25;

/** Entrada de creación: name sin normalizar y código de moneda. */
export type CreateBoxInput = {
  name: string;
  currency: string;
};

/**
 * Balance calculado de una alcancía, en unidades menores de su moneda. Es
 * una proyección del historial, nunca un campo almacenado (PRODUCT.md,
 * invariante 9): deposit suma +amountMinor, withdraw suma -amountMinor y
 * reset suma su amountMinor (por construcción -(balance previo), lleva a 0).
 */
export type WithBalance = {
  box: SavingsBox;
  /** Balance agregado del historial; 0 si la box no tiene transacciones. */
  balanceMinor: number;
};

/**
 * Valida `name` (1–80 chars luego de trim) y `currency` (catálogo cerrado,
 * case-sensitive; ver `isSupportedCurrency`). Lanza `ValidationError` con
 * `fieldErrors` por campo para que la UI marque los inputs.
 */
function validateBoxInput(input: CreateBoxInput): void {
  const name = input.name.trim();
  const fieldErrors: Record<string, string[]> = {};

  if (name.length < BOX_NAME_MIN_LENGTH || name.length > BOX_NAME_MAX_LENGTH) {
    fieldErrors.name = [
      `El nombre debe tener entre ${BOX_NAME_MIN_LENGTH} y ${BOX_NAME_MAX_LENGTH} caracteres.`,
    ];
  }

  if (!isSupportedCurrency(input.currency)) {
    fieldErrors.currency = ["Moneda no soportada."];
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(fieldErrors);
  }
}

/**
 * Recorre la cadena de `cause` buscando el code `SQLITE_BUSY` de libSQL:
 * drizzle envuelve los errores de query en `DrizzleQueryError`, cuyo
 * `cause` es el error del driver con `code: "SQLITE_BUSY"`.
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
 * Transacción atómica del límite (T042): cuenta las alcancías del dueño y,
 * si hay cupo, inserta. Count + insert en la misma transacción es
 * suficiente en SQLite: el `BEGIN IMMEDIATE` toma el lock de escritura
 * antes del count y lo retiene hasta el commit, y los writes están
 * serializados, así que no hay ventana en la que dos transacciones pasen
 * el count con el mismo valor y las dos inserten.
 */
async function insertBoxWithinLimit(
  db: Db,
  userId: string,
  name: string,
  currency: string,
): Promise<SavingsBox> {
  return db.transaction(async (tx): Promise<SavingsBox> => {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(savingsBoxes)
      .where(eq(savingsBoxes.ownerId, userId));
    if (n >= MAX_BOXES_PER_USER) {
      // Lanzar acá hace rollback: la DB queda exactamente como estaba.
      throw new LimitReachedError();
    }

    const inserted = await tx
      .insert(savingsBoxes)
      .values({
        id: newId(),
        ownerId: userId,
        name,
        currency,
      })
      .returning();

    const box = inserted[0];
    if (!box) {
      throw new Error("Failed to insert savings box");
    }
    return box;
  });
}

/**
 * Crea una alcancía para `userId` con validación de entrada, verificación
 * de owner y límite atómico de `MAX_BOXES_PER_USER`.
 *
 * Flujo:
 * 1. Valida name (1–80, trim) y currency (`isSupportedCurrency`,
 *    case-sensitive) **antes** de abrir la transacción: no hay razón para
 *    tomar un lock de escritura con entrada inválida.
 * 2. Verifica que el user exista: la FK fallaría igual en el insert, pero
 *    el chequeo explícito da un error claro en vez de una FK violation.
 * 3. Corre la transacción count + insert; ante `SQLITE_BUSY` (lock tomado
 *    por otra transacción, ver comentario de `BUSY_RETRY_MAX_ATTEMPTS`)
 *    reintenta con backoff corto.
 *
 * @throws ValidationError si name/currency no pasan la validación.
 * @throws LimitReachedError si el usuario ya tiene el máximo de alcancías.
 * @throws Error si `userId` no existe (chequeo explícito con mensaje claro).
 */
export async function createBox(
  db: Db,
  userId: string,
  input: CreateBoxInput,
): Promise<SavingsBox> {
  validateBoxInput(input);

  const ownerExists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (ownerExists.length === 0) {
    throw new Error(`No existe el usuario dueño de la alcancía: ${userId}`);
  }

  const name = input.name.trim();
  const { currency } = input;

  let lastError: unknown;
  for (let attempt = 1; attempt <= BUSY_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await insertBoxWithinLimit(db, userId, name, currency);
    } catch (error) {
      if (error instanceof LimitReachedError) {
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

/**
 * Variante de `NewSavingsBox` que la action podría necesitar a futuro; se
 * exporta por simetría con el resto de los services.
 */
export type CreateBoxRow = NewSavingsBox;

/**
 * Alcancía compartida con el usuario: la box con los permisos efectivos que
 * le otorga su `box_access` (ya parseados).
 */
export type SharedBox = {
  box: SavingsBox;
  permissions: Permission[];
};

/** Acceso efectivo a una alcancía: la box + si es owner + permisos efectivos. */
export type BoxAccessInfo = {
  box: SavingsBox;
  isOwner: boolean;
  permissions: Permission[];
};

/** Acceso efectivo + balance calculado (lo que consume la UI). */
export type BoxAccessWithBalance = BoxAccessInfo & WithBalance;

/** Resultado de `listBoxes`: propias y compartidas, ya diferenciadas. */
export type ListBoxesResult = {
  own: WithBalance[];
  shared: Array<SharedBox & WithBalance>;
};

/**
 * Expresión SQL del balance (idéntica a la de `@/server/transactions/service`,
 * que es la fuente de verdad de la fórmula): `deposit` y `reset` suman
 * +amountMinor (el reset lleva amountMinor = -(balance previo), así que
 * sumarlo es correcto), `withdraw` suma -amountMinor. Devuelve el balance en
 * unidades menores; el `COALESCE` lo maneja la query agregada de `listBoxes`.
 */
function balanceExpression() {
  return sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdraw' THEN -${transactions.amountMinor} ELSE ${transactions.amountMinor} END), 0)`;
}

/**
 * Balances de las alcancías `boxIds` en UNA sola query: `SUM ... GROUP BY
 * boxId` con la fórmula de `balanceExpression`. Devuelve un Map para lookup
 * O(1): una box sin transacciones no produce fila en el GROUP BY (la query
 * va contra `transactions`), así que las ausentes se tratan como 0 en el
 * caller (`?? 0`).
 */
async function balancesByBoxId(
  db: Db,
  boxIds: string[],
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (boxIds.length === 0) {
    return balances;
  }
  const rows = await db
    .select({
      boxId: transactions.boxId,
      balance: balanceExpression(),
    })
    .from(transactions)
    .where(inArray(transactions.boxId, boxIds))
    .groupBy(transactions.boxId);
  for (const row of rows) {
    balances.set(row.boxId, row.balance);
  }
  return balances;
}

/**
 * Lista las alcancías visibles para `userId` (T043):
 * - `own`: las que le pertenecen (`ownerId = userId`), más nuevas primero.
 * - `shared`: las compartidas con él via `box_access` (JOIN), más nuevas
 *   primero según el `createdAt` del access (cuándo le otorgaron acceso), con
 *   los permisos de ese access ya parseados.
 *
 * Cada box sale con su `balanceMinor` calculado en una sola query agregada
 * (SUM agrupado por boxId; sin transacciones → 0).
 *
 * Un usuario dueño de una box que además tenga un access sobre ella (estado
 * raro, el redeem no debería generar ese access) la vería en ambas listas:
 * es un caso no contemplado por el modelo actual y no se filtra a propósito.
 */
export async function listBoxes(
  db: Db,
  userId: string,
): Promise<ListBoxesResult> {
  const own = await db
    .select()
    .from(savingsBoxes)
    .where(eq(savingsBoxes.ownerId, userId))
    .orderBy(desc(savingsBoxes.createdAt));

  // Nested select (`box: {...}`): el objeto completo sale nullable y con
  // innerJoin el JOIN garantiza que exista, así que se descarta el null.
  const sharedRows = await db
    .select({
      access: {
        createdAt: boxAccess.createdAt,
        permissions: boxAccess.permissions,
      },
      box: {
        id: savingsBoxes.id,
        ownerId: savingsBoxes.ownerId,
        name: savingsBoxes.name,
        currency: savingsBoxes.currency,
        createdAt: savingsBoxes.createdAt,
        updatedAt: savingsBoxes.updatedAt,
      },
    })
    .from(boxAccess)
    .innerJoin(savingsBoxes, eq(boxAccess.boxId, savingsBoxes.id))
    .where(eq(boxAccess.userId, userId))
    .orderBy(desc(boxAccess.createdAt));

  const balances = await balancesByBoxId(
    db,
    own.map((box) => box.id).concat(sharedRows.map((row) => row.box.id)),
  );

  return {
    own: own.map((box) => ({
      box,
      balanceMinor: balances.get(box.id) ?? 0,
    })),
    shared: sharedRows.map((row) => ({
      box: row.box,
      permissions: parsePermissionsJson(row.access.permissions),
      balanceMinor: balances.get(row.box.id) ?? 0,
    })),
  };
}

/**
 * Resuelve el acceso efectivo de `userId` a la alcancía `boxId` (T044),
 * delegando el gate en el módulo central (T048):
 * - owner → permisos totales (`OWNER_PERMISSIONS`).
 * - guest con `box_access` → permisos de ese access, parseados.
 * - box inexistente o sin relación → `NotFoundError`: la existencia de la
 *   box no se filtra a extraños (nunca `PermissionError` acá).
 *
 * La semántica de 404-oculto vive en `requireBoxAccess`
 * (`@/server/permissions/assert`): ninguna acción de dominio decide permisos
 * por su cuenta.
 */
export async function getBox(
  db: Db,
  userId: string,
  boxId: string,
): Promise<BoxAccessWithBalance> {
  const access = await requireBoxAccess(db, userId, boxId);
  const balances = await balancesByBoxId(db, [boxId]);
  return {
    ...access,
    balanceMinor: balances.get(boxId) ?? 0,
  };
}

/**
 * Renombra la alcancía `boxId` (T045). Única mutación permitida sobre la
 * box, y solo el owner puede hacerla: un guest con cualquier `box_access`
 * (aunque tenga todos los permisos) NO puede renombrar → `PermissionError`
 * explícito (es un guest conocido; la negativa le dice que la box existe y
 * que no puede, lo cual ya sabía). Un extraño sin relación y una box
 * inexistente ven `NotFoundError` (no se filtra la existencia a extraños,
 * igual que en `getBox`).
 *
 * T048: la decisión de ownership sale de `resolveEffectiveAccess`
 * (`@/server/permissions/access`), no de queries propias de este service.
 */
export async function renameBox(
  db: Db,
  userId: string,
  boxId: string,
  newName: string,
): Promise<SavingsBox> {
  const name = newName.trim();
  if (name.length < BOX_NAME_MIN_LENGTH || name.length > BOX_NAME_MAX_LENGTH) {
    throw new ValidationError({
      name: [
        `El nombre debe tener entre ${BOX_NAME_MIN_LENGTH} y ${BOX_NAME_MAX_LENGTH} caracteres.`,
      ],
    });
  }

  const access = await resolveEffectiveAccess(db, userId, boxId);
  if (!access.boxExists || !access.isOwner) {
    // Box inexistente y extraño comparten 404 (no se filtra la existencia);
    // guest conocido (con filas de access) → `forbidden` explícito.
    if (access.boxExists) {
      const hasAccessRow = await db
        .select({ id: boxAccess.id })
        .from(boxAccess)
        .where(and(eq(boxAccess.boxId, boxId), eq(boxAccess.userId, userId)))
        .limit(1);
      if (hasAccessRow.length === 0) {
        throw new NotFoundError();
      }
      throw new PermissionError();
    }
    throw new NotFoundError();
  }

  const updated = await db
    .update(savingsBoxes)
    .set({ name, updatedAt: Date.now() })
    .where(eq(savingsBoxes.id, boxId))
    .returning();
  const updatedBox = updated[0];
  if (!updatedBox) {
    throw new Error("Failed to update savings box");
  }
  return updatedBox;
}
