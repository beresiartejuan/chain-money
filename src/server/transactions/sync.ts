import "server-only";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { type TransactionType, transactions } from "@/db/schema";
import { type Cursor, makeCursor } from "@/lib/cursor";
import {
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import { hasPermission } from "@/server/permissions/access";
import { requireBoxAccess } from "@/server/permissions/assert";

/**
 * Sync incremental de transacciones (T062/T063/T064), pura respecto al
 * request: recibe la db y el `userId` por parámetro y no toca cookies
 * (`next/headers`), igual que el resto de los services. Así es testeable
 * con una DB real y reutilizable desde Route Handlers o jobs. El handler
 * (`src/app/api/boxes/[boxId]/transactions/route.ts`) es la capa delgada
 * que resuelve la sesión y mapea los errores de dominio a status HTTP.
 *
 * ## Contrato del delta (T062)
 *
 * - Orden ASC por la tupla `(createdAt, id)`: es el orden natural para un
 *   delta incremental (el cursor avanza hacia el futuro) y garantiza orden
 *   determinista cuando dos transacciones comparten `createdAt` (T063). El
 *   índice `transactions_box_created_at_id_idx` sostiene exactamente este
 *   orden.
 * - Punto de partida (precedencia: `sinceTransactionId` > `since` >
 *   `sinceMs`; el handler mapea `cursor` → `since`):
 *   - `sinceMs`: fecha-sola EXCLUSIVA en unix ms (`createdAt > sinceMs`).
 *     Acepta ISO 8601 o unix ms, pero esa conversión la hace el handler:
 *     el service ya recibe milisegundos.
 *   - `since`: cursor tupla `(createdAtMs, id)` (T009) — reanudación
 *     exacta de una página: una tx con el mismo `createdAt` entra solo si
 *     su `id` desempata después del cursor (sin gaps ni duplicados).
 *   - `sinceTransactionId`: busca la tx EN la box y usa su `(createdAt,
 *     id)` como cursor. Id desconocido o tx de OTRA alcancía →
 *     `NotFoundError` (404): no se revela en qué otra alcancía está.
 * - Sin punto de partida → desde el inicio de la box (paginación completa).
 * - Truco del `limit + 1`: pide una fila más de las pedidas;
 *   `hasMore = rows.length > limit`, se recorta a `limit` y `nextCursor`
 *   es el cursor de la última tx solo si `hasMore` (null en la última).
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/** Página por defecto si el caller no pide un límite. */
export const TRANSACTIONS_SYNC_DEFAULT_LIMIT = 50;

/** Tope duro de página: acota la query y el payload por request. */
export const TRANSACTIONS_SYNC_MAX_LIMIT = 100;

/** Shape serializable de una transacción en la respuesta de sync. */
export type SyncTransaction = {
  id: string;
  type: TransactionType;
  amountMinor: number;
  counterparty: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
};

/** Resultado de una página del sync incremental. */
export type GetTransactionsResult = {
  /** Página de transacciones, ASC por la tupla `(createdAt, id)`. */
  transactions: SyncTransaction[];
  /**
   * Cursor opaco (T009) de la última tx de la página para pedir la
   * siguiente; `null` cuando esta página era la última (`hasMore: false`).
   */
  nextCursor: string | null;
  /** `true` si quedó al menos una tx más después de esta página. */
  hasMore: boolean;
};

/** Punto de partida del delta (mutuamente excluyentes entre sí). */
export type GetTransactionsOptions = {
  /**
   * Fecha-sola EXCLUSIVA en unix ms: `createdAt > sinceMs`. Sin desempate
   * por id: reanudar una página con `sinceMs` puede duplicar transacciones
   * que comparten `createdAt` con el borde — para reanudar exacto usar
   * `since` (la tupla completa).
   */
  sinceMs?: number;
  /** Cursor tupla `(createdAt, id)` de la última tx ya vista. */
  since?: Cursor;
  /** Id de la tx ancla EN `boxId` (ver `resolveSinceTransaction`). */
  sinceTransactionId?: string;
  /** Tamaño de página: entero en 1..TRANSACTIONS_SYNC_MAX_LIMIT. */
  limit?: number;
};

/**
 * Valida `limit` (entero en 1..TRANSACTIONS_SYNC_MAX_LIMIT, default 50).
 * Es regla del service (testeable sin HTTP); el handler la mapea a 400.
 *
 * @throws ValidationError con `fieldErrors.limit` si está fuera de rango.
 */
function assertValidLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > TRANSACTIONS_SYNC_MAX_LIMIT
  ) {
    throw new ValidationError({
      limit: [
        `El límite debe ser un entero entre 1 y ${TRANSACTIONS_SYNC_MAX_LIMIT}.`,
      ],
    });
  }
}

/**
 * Busca la tx `transactionId` DENTRO de `boxId` (mismo filtro de box) y
 * devuelve su `(createdAt, id)` como cursor de reanudación. Si la tx no
 * está en esta box (id desconocido o tx de otra alcancía) →
 * `NotFoundError`: la consulta cruza por `boxId`, así que una tx ajena es
 * indistinguible de una inexistente y no se filtra su existencia.
 *
 * @throws NotFoundError si la tx no existe dentro de `boxId`.
 */
export async function resolveSinceTransaction(
  db: Db,
  boxId: string,
  transactionId: string,
): Promise<Cursor> {
  const rows = await db
    .select({ createdAt: transactions.createdAt })
    .from(transactions)
    .where(
      and(eq(transactions.id, transactionId), eq(transactions.boxId, boxId)),
    )
    .limit(1);
  const anchor = rows[0];
  if (!anchor) {
    throw new NotFoundError("La transacción no existe en esta alcancía.");
  }
  return { createdAtMs: anchor.createdAt, id: transactionId };
}

/**
 * Resuelve el cursor de partida según la precedencia documentada
 * (`sinceTransactionId` > `since` > `sinceMs`); `null` → desde el inicio.
 */
async function resolveSince(
  db: Db,
  boxId: string,
  options: GetTransactionsOptions,
): Promise<Cursor | null> {
  if (options.sinceTransactionId !== undefined) {
    return resolveSinceTransaction(db, boxId, options.sinceTransactionId);
  }
  return options.since ?? null;
}

/** Mapea la fila de DB al shape serializable (`type` → TransactionType). */
function toSyncTransaction(row: {
  id: string;
  type: string;
  amountMinor: number;
  counterparty: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
}): SyncTransaction {
  return { ...row, type: row.type as TransactionType };
}

/**
 * Página del historial de `boxId` a partir del punto de partida, ordenada
 * ASC por la tupla `(createdAt, id)`:
 *
 * ```sql
 * WHERE boxId = ?
 *   AND (createdAt > since.createdAtMs
 *        OR (createdAt = since.createdAtMs AND id > since.id))
 * ORDER BY createdAt ASC, id ASC
 * LIMIT limit + 1
 * ```
 *
 * La fila extra decide `hasMore` sin una segunda query: si hay más filas
 * que `limit`, se recorta a `limit` y `nextCursor` sale de la última fila
 * de la página; si no, `nextCursor` es `null`.
 *
 * @throws ValidationError si `limit` está fuera de 1..100.
 * @throws NotFoundError si `sinceTransactionId` no existe en la box.
 */
export async function getTransactionsSince(
  db: Db,
  boxId: string,
  options: GetTransactionsOptions = {},
): Promise<GetTransactionsResult> {
  assertValidLimit(options.limit);
  const limit = options.limit ?? TRANSACTIONS_SYNC_DEFAULT_LIMIT;
  const since = await resolveSince(db, boxId, options);

  const conditions = [eq(transactions.boxId, boxId)];
  if (since) {
    // Reanudación por tupla (T063): una tx con el MISMO `createdAt` entra
    // solo si su `id` desempata después del cursor — el walk por cursores
    // no pierde ni duplica transacciones con timestamps iguales.
    const tuplePredicate = or(
      gt(transactions.createdAt, since.createdAtMs),
      and(
        eq(transactions.createdAt, since.createdAtMs),
        gt(transactions.id, since.id),
      ),
    );
    if (tuplePredicate) {
      conditions.push(tuplePredicate);
    }
  } else if (options.sinceMs !== undefined) {
    // Fecha-sola: exclusiva (`createdAt > sinceMs`), sin desempate por id.
    conditions.push(gt(transactions.createdAt, options.sinceMs));
  }

  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      counterparty: transactions.counterparty,
      note: transactions.note,
      createdBy: transactions.createdBy,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    transactions: page.map(toSyncTransaction),
    hasMore,
    nextCursor: hasMore && last ? makeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * Variante del endpoint incremental con el gate de autorización (T064),
 * el mismo patrón que las actions de dominio (`requireBoxAccess` +
 * `hasPermission`):
 *
 * - Box inexistente o `userId` extraño (sin relación) → `NotFoundError`
 *   (el handler mapea a 404; no se revela la existencia de la box).
 * - Guest conocido sin `view:transactions` (p. ej. solo
 *   `create:transactions`) → `PermissionError` (403): los tokens llevan
 *   permisos explícitos y leer el historial exige el de view.
 * - Owner (todos los permisos) o guest con view → consulta normal.
 *
 * El ancla `sinceTransactionId` se resuelve recién acá, DESPUÉS del gate:
 * a un extraño no se le deja ni sondear la existencia de una tx.
 *
 * @throws NotFoundError si la box no existe o `userId` no tiene relación
 *   (también si la tx ancla no está en la box).
 * @throws PermissionError si no tiene `view:transactions`.
 * @throws ValidationError si `limit` está fuera de rango.
 */
export async function getTransactionsWithAccess(
  db: Db,
  userId: string,
  boxId: string,
  options: GetTransactionsOptions = {},
): Promise<GetTransactionsResult> {
  const access = await requireBoxAccess(db, userId, boxId);

  if (!hasPermission(access, "view:transactions")) {
    throw new PermissionError();
  }

  return getTransactionsSince(db, boxId, options);
}
