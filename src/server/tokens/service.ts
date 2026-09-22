import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  type BoxToken,
  type BoxTokenStatus,
  boxAccess,
  boxTokens,
  type Permission,
  savingsBoxes,
  users,
} from "@/db/schema";
import { generateAccessToken, hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import {
  NotFoundError,
  OwnBoxRedeemError,
  PermissionError,
  RateLimitError,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  TokenInvalidError,
  ValidationError,
} from "@/server/errors";
import {
  ALL_PERMISSIONS,
  combinePermissions,
  isPermission,
  parsePermissionsJson,
  resolveEffectiveAccess,
  serializePermissionsJson,
} from "@/server/permissions/access";
import { checkRateLimit } from "@/server/rate-limit";
import { RATE_LIMITS, rateLimitKey } from "@/server/rate-limits";

/**
 * T049/T050 — lógica de negocio de tokens de acceso compartido, pura
 * respecto al request: cada función recibe la db por parámetro y no toca
 * cookies (`next/headers`) ni nada del runtime de Next, igual que el resto
 * de los services. Así es testeable con una DB real y reutilizable desde
 * actions, Route Handlers o jobs. `actions.ts` es la capa delgada que
 * resuelve la sesión.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/** Resultado de `createToken`: el token crudo se devuelve UNA sola vez. */
export type CreateTokenResult = {
  /** Token crudo (base64url). Nunca se persiste: en DB queda solo el hash. */
  token: string;
  /** Id de la fila `box_tokens` creada. */
  id: string;
  /** Prefix de 8 chars para identificar el token en UI/logs. */
  prefix: string;
  /** Permisos efectivamente persistidos (dedup, orden canónico). */
  permissions: Permission[];
};

/** Resultado de `redeemToken`: con el `boxId` la UI redirige a la alcancía. */
export type RedeemTokenResult = {
  boxId: string;
};

/**
 * Rate limit del canje (T030/T050), consolidado en `@/server/rate-limits`
 * (T083). Re-exportados con su nombre histórico: los tests los importan de
 * acá, y `redeemRateLimitKey` queda como helper de las keys `redeem:{userId}`
 * (mismo formato que `rateLimitKey("redeem", userId)`).
 */
export const REDEEM_RATE_LIMIT = RATE_LIMITS.redeem.limit;
export const REDEEM_RATE_WINDOW_MS = RATE_LIMITS.redeem.windowMs;

/** Llave de rate limit del canje, por userId. */
export function redeemRateLimitKey(userId: string): string {
  return rateLimitKey("redeem", userId);
}

/**
 * Longitud esperada del token crudo: `generateAccessToken` produce 32 bytes
 * → 43 chars base64url. El check de formato es un pre-filtro barato ANTES
 * del lookup por hash; un token bien formado pero inexistente cae igual en
 * `TokenInvalidError` después, así que no filtra nada extra.
 */
const RAW_TOKEN_LENGTH = 43;

/**
 * Valida el set de permisos pedido para un token (T049): array no vacío con
 * valores todos ∈ `ALL_PERMISSIONS`. El set persistido se normaliza (dedup +
 * orden canónico del catálogo) para que dos tokens con el mismo set guarden
 * exactamente el mismo JSON. NO se fuerza `view:transactions`: la decisión
 * es "mínimo 1 permiso, cualquiera" (el owner elige; lo que no tiene sentido
 * es un token sin permisos, y eso lo cubre el mínimo de 1).
 */
function validateTokenPermissions(input: readonly unknown[]): Permission[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError({
      permissions: ["Elegí al menos un permiso para el token."],
    });
  }

  const hasInvalid = input.some((value) => !isPermission(value));
  if (hasInvalid) {
    throw new ValidationError({
      permissions: ["Hay permisos desconocidos en la selección."],
    });
  }

  // Dedup + orden canónico: subconjunto de ALL_PERMISSIONS en su orden.
  const unique = new Set(input as Permission[]);
  return [...ALL_PERMISSIONS].filter((p) => unique.has(p));
}

/**
 * Crea un token de un solo uso para compartir la alcancía `boxId` (T049).
 *
 * - **Solo owner** (T048): la decisión sale de `resolveEffectiveAccess`,
 *   igual que en `renameBox`. Guest conocido (con `box_access`) →
 *   `PermissionError` (ya sabe que la box existe); extraño sin relación y
 *   box inexistente → `NotFoundError` (no se filtra la existencia).
 * - Valida permisos (no vacío, ⊆ catálogo) **antes** de generar el token.
 * - `generateAccessToken` → inserta `{ tokenHash, tokenPrefix, permissions
 *   serializados, status 'active', createdBy }`. El token crudo vuelve en
 *   el resultado UNA sola vez; en DB queda solo el hash.
 *
 * @throws ValidationError con `fieldErrors.permissions` si el set es inválido.
 * @throws PermissionError si el caller es guest (no owner) de la box.
 * @throws NotFoundError si la box no existe o el caller es un extraño.
 */
export async function createToken(
  db: Db,
  userId: string,
  boxId: string,
  permissions: readonly unknown[],
): Promise<CreateTokenResult> {
  const access = await resolveEffectiveAccess(db, userId, boxId);

  if (!access.boxExists) {
    throw new NotFoundError("La alcancía no existe.");
  }
  if (!access.isOwner) {
    // Extraño con box existente pero sin filas de access → 404 (no se
    // revela la existencia); guest con access → 403 explícito, consistente
    // con `renameBox`.
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

  const validated = validateTokenPermissions(permissions);

  const { token, hash, prefix } = generateAccessToken();

  const inserted = await db
    .insert(boxTokens)
    .values({
      id: newId(),
      boxId,
      tokenHash: hash,
      tokenPrefix: prefix,
      permissions: serializePermissionsJson(validated),
      status: "active",
      createdBy: userId,
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert box token");
  }

  return {
    token,
    id: row.id,
    prefix: row.tokenPrefix,
    permissions: parsePermissionsJson(row.permissions),
  };
}

/**
 * Canjea un token crudo por acceso a la alcancía (T050), atómicamente.
 *
 * Flujo:
 * 1. **Rate limit ANTES del lookup** (key `redeem:{userId}`, 10/min): frenar
 *    fuerza bruta no debe depender de si el token existe. Excedido →
 *    `RateLimitError` con `retryAfterMs`.
 * 2. Formato básico (string de la longitud base64url esperada): malformado
 *    → `TokenInvalidError`. El mismo error cubre "no existe" (lookup por
 *    hash vacío): NO se distingue, para no filtrar qué tokens existen.
 * 3. Owner check: `createdBy === userId` o `box.ownerId === userId` →
 *    `OwnBoxRedeemError` (el canje es para otorgar acceso a terceros).
 * 4. **Transacción** (`BEGIN IMMEDIATE` default del driver libsql, igual
 *    que `createBox`): re-check de `status === 'active'` (otro request
 *    pudo canjear entre el lookup y el lock), update compare-and-set
 *    `WHERE status = 'active'` + insert/update de `box_access`.
 *    - status `expired` → `TokenExpiredError`; `redeemed` →
 *      `TokenAlreadyRedeemedError` (pre-lock y re-check post-lock).
 *    - `box_access` ya existente (unique boxId+userId; p. ej. el guest ya
 *      tenía un access previo): se **unen** los permisos (`combinePermissions`)
 *      con update, y `tokenId` pasa a apuntar al token recién canjeado.
 *      Documentado en el schema: un nuevo canje actualiza en lugar de
 *      crear otra fila.
 *
 * @throws RateLimitError si se agotó el cupo de intentos de canje.
 * @throws TokenInvalidError si el token está malformado o no existe.
 * @throws TokenExpiredError / TokenAlreadyRedeemedError según el status.
 * @throws OwnBoxRedeemError si el caller es el owner de la alcancía.
 */
export async function redeemToken(
  db: Db,
  userId: string,
  rawToken: string,
): Promise<RedeemTokenResult> {
  const limit = checkRateLimit(
    redeemRateLimitKey(userId),
    REDEEM_RATE_LIMIT,
    REDEEM_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    throw new RateLimitError(limit.retryAfterMs);
  }

  if (typeof rawToken !== "string" || rawToken.length !== RAW_TOKEN_LENGTH) {
    throw new TokenInvalidError();
  }

  const tokenHash = hashAccessToken(rawToken);

  const found = await db
    .select()
    .from(boxTokens)
    .where(eq(boxTokens.tokenHash, tokenHash))
    .limit(1);
  const token = found[0];
  if (!token) {
    // "No existe" y "malformado" comparten error: no se filtra la existencia.
    throw new TokenInvalidError();
  }

  if (token.status === "expired") {
    throw new TokenExpiredError();
  }
  if (token.status === "redeemed") {
    throw new TokenAlreadyRedeemedError();
  }

  // Owner check ANTES de la transacción (fail fast sin lock): el dueño no
  // puede canjear tokens de su propia alcancía. Se verifica por las dos
  // vías (createdBy y ownerId de la box) por robustez.
  const boxes = await db
    .select({ ownerId: savingsBoxes.ownerId })
    .from(savingsBoxes)
    .where(eq(savingsBoxes.id, token.boxId))
    .limit(1);
  const box = boxes[0];
  if (!box) {
    // FK garantiza que la box existe; si no, el token es huérfano: tratar
    // como inválido no filtra nada.
    throw new TokenInvalidError();
  }
  if (token.createdBy === userId || box.ownerId === userId) {
    throw new OwnBoxRedeemError();
  }

  return db.transaction(async (tx): Promise<RedeemTokenResult> => {
    // Re-check dentro del lock: otro request pudo canjear el token entre
    // el lookup inicial y el `BEGIN IMMEDIATE`.
    const locked = await tx
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, token.id))
      .limit(1);
    const current = locked[0];
    if (!current || current.status !== "active") {
      throw statusError(current?.status);
    }

    // Compare-and-set: solo marca `redeemed` si sigue `active`. Si otro
    // request ganó la carrera, el WHERE no matchea y el rollback deshace
    // todo.
    const updated = await tx
      .update(boxTokens)
      .set({
        status: "redeemed",
        redeemedAt: Date.now(),
        redeemedBy: userId,
      })
      .where(and(eq(boxTokens.id, current.id), eq(boxTokens.status, "active")))
      .returning();
    const redeemedRow = updated[0];
    if (!redeemedRow) {
      // Alguien canjeó entre el re-check y el update (no debería pasar con
      // el lock, pero el CAS es la última línea de defensa).
      throw new TokenAlreadyRedeemedError();
    }

    // Acceso: si (boxId, userId) ya existe (unique), unir permisos; si no,
    // insertar. Parsear los permisos del token (JSON tolerante) y
    // serializar la unión a la forma canónica.
    const tokenPermissions = parsePermissionsJson(redeemedRow.permissions);
    const existingAccess = await tx
      .select()
      .from(boxAccess)
      .where(
        and(eq(boxAccess.boxId, token.boxId), eq(boxAccess.userId, userId)),
      )
      .limit(1);
    const existing = existingAccess[0];

    if (existing) {
      const merged = serializePermissionsJson(
        combinePermissions([
          parsePermissionsJson(existing.permissions),
          tokenPermissions,
        ]),
      );
      await tx
        .update(boxAccess)
        .set({ permissions: merged, tokenId: token.id })
        .where(eq(boxAccess.id, existing.id));
    } else {
      await tx.insert(boxAccess).values({
        id: newId(),
        boxId: token.boxId,
        userId,
        tokenId: token.id,
        permissions: serializePermissionsJson(tokenPermissions),
      });
    }

    return { boxId: token.boxId };
  });
}

/**
 * Gate de owner compartido por las mutaciones/consulta de tokens (T052/T053):
 * mismas reglas que `createToken`/`renameBox` — box inexistente o extraño
 * (sin filas de access) → `NotFoundError` (no se filtra la existencia de la
 * box); guest con access → `PermissionError` explícito. La decisión de
 * ownership sale de `resolveEffectiveAccess`, no de queries propias.
 */
async function requireTokenBoxOwner(
  db: Db,
  userId: string,
  boxId: string,
): Promise<void> {
  const access = await resolveEffectiveAccess(db, userId, boxId);
  if (!access.boxExists) {
    throw new NotFoundError("La alcancía no existe.");
  }
  if (!access.isOwner) {
    // Extraño con box existente pero sin filas de access → 404 (no se
    // revela la existencia); guest con access → 403 explícito.
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
}

/** Mapea el status de un token al error de dominio que corresponde. */
function statusError(status: BoxToken["status"] | undefined): Error {
  if (status === "expired") {
    return new TokenExpiredError();
  }
  if (status === "redeemed") {
    return new TokenAlreadyRedeemedError();
  }
  // Status desconocido (o fila borrada en la carrera): tratar como token
  // inválido, nunca un 500 por datos corruptos.
  return new TokenInvalidError();
}

/**
 * Resultado de `revokeToken` (T052): confirma el borrado físico de la fila.
 */
export type RevokeTokenResult = {
  /** Id de la fila `box_tokens` eliminada. */
  id: string;
};

/**
 * Revoca (borra físicamente) el token `tokenId` (T052), **solo el owner** de
 * la alcancía. Es la única mutación destructiva de tokens y existe para
 * invalidar un canje FUTURO: un token que ya fue canjeado no se puede
 * revocar, porque el acceso otorgado persiste (decisión de producto, T092)
 * y `box_access.tokenId` es FK NOT NULL sin `ON DELETE` hacia
 * `box_tokens.id` — borrar la fila dejaría el acceso huérfano y violaría la
 * FK (`PRAGMA foreign_keys = 1`). Ese intento devuelve
 * `TokenAlreadyRedeemedError`.
 *
 * @throws TokenAlreadyRedeemedError si el token ya fue canjeado (no se puede
 *   borrar sin romper la trazabilidad del acceso otorgado).
 * @throws NotFoundError si la box del token no existe, el caller es un
 *   extraño, o el `tokenId` no existe.
 * @throws PermissionError si el caller es guest (no owner) de la box.
 */
export async function revokeToken(
  db: Db,
  userId: string,
  tokenId: string,
): Promise<RevokeTokenResult> {
  const found = await db
    .select({ boxId: boxTokens.boxId, status: boxTokens.status })
    .from(boxTokens)
    .where(eq(boxTokens.id, tokenId))
    .limit(1);
  const token = found[0];
  if (!token) {
    throw new NotFoundError("El token no existe.");
  }

  await requireTokenBoxOwner(db, userId, token.boxId);

  if (token.status === "redeemed") {
    throw new TokenAlreadyRedeemedError(
      "El token ya fue canjeado: el acceso otorgado persiste y no se puede revocar.",
    );
  }

  const deleted = await db
    .delete(boxTokens)
    .where(eq(boxTokens.id, tokenId))
    .returning({ id: boxTokens.id });
  const deletedRow = deleted[0];
  if (!deletedRow) {
    throw new NotFoundError("El token no existe.");
  }
  return { id: deletedRow.id };
}

/**
 * Expira el token `tokenId` (T052), **solo el owner**: marca
 * `status = 'expired'` para invalidar canjes futuros sin borrar la fila (el
 * historial y la trazabilidad se conservan). Idempotente: expirar un token
 * ya expirado es un OK sin cambios. Sobre un token canjeado el update no
 * aplica y devuelve `TokenAlreadyRedeemedError` (ya consumido, no hay nada
 * que invalidar).
 *
 * @throws TokenAlreadyRedeemedError si el token ya fue canjeado.
 * @throws NotFoundError si la box del token no existe, el caller es un
 *   extraño, o el `tokenId` no existe.
 * @throws PermissionError si el caller es guest (no owner) de la box.
 */
export async function expireToken(
  db: Db,
  userId: string,
  tokenId: string,
): Promise<BoxToken> {
  const found = await db
    .select()
    .from(boxTokens)
    .where(eq(boxTokens.id, tokenId))
    .limit(1);
  const token = found[0];
  if (!token) {
    throw new NotFoundError("El token no existe.");
  }

  await requireTokenBoxOwner(db, userId, token.boxId);

  if (token.status === "redeemed") {
    throw new TokenAlreadyRedeemedError();
  }
  if (token.status === "expired") {
    // Idempotente: no hay nada que cambiar, devolver la fila tal cual.
    return token;
  }

  const updated = await db
    .update(boxTokens)
    .set({ status: "expired" })
    .where(and(eq(boxTokens.id, tokenId), eq(boxTokens.status, "active")))
    .returning();
  const updatedRow = updated[0];
  if (!updatedRow) {
    // Solo posible si otra request lo canjeó entre el read y el update:
    // el CAS con `status = 'active'` es la última línea de defensa.
    throw new TokenAlreadyRedeemedError();
  }
  return updatedRow;
}

/**
 * Vista de un token para el owner (T053): sin secretos — el hash y el token
 * crudo NUNCA salen por acá; `tokenPrefix` es el identificador no secreto
 * pensado para UI/logs. `redeemedBy` es el nombre del usuario que canjeó
 * (`null` si aún no se canjeó o si el usuario fue borrado).
 */
export type TokenSummary = {
  id: string;
  tokenPrefix: string;
  permissions: Permission[];
  status: BoxTokenStatus;
  createdAt: number;
  redeemedAt: number | null;
  /** Nombre del usuario que canjeó, si existe. */
  redeemedByName: string | null;
};

/**
 * Lista los tokens de la alcancía `boxId` (T053), **solo el owner**, más
 * nuevos primero. Cada item es un `TokenSummary` sin `tokenHash` (ni crudo):
 * la única referencia al token es el prefix de 8 chars. El nombre de
 * `redeemedBy` sale de un LEFT JOIN a `users` (puede ser `null` si el
 * usuario ya no existe).
 *
 * @throws PermissionError si el caller es guest (no owner) de la box.
 * @throws NotFoundError si la box no existe o el caller es un extraño.
 */
export async function listTokens(
  db: Db,
  userId: string,
  boxId: string,
): Promise<TokenSummary[]> {
  await requireTokenBoxOwner(db, userId, boxId);

  const rows = await db
    .select({
      id: boxTokens.id,
      tokenPrefix: boxTokens.tokenPrefix,
      permissions: boxTokens.permissions,
      status: boxTokens.status,
      createdAt: boxTokens.createdAt,
      redeemedAt: boxTokens.redeemedAt,
      redeemedByName: users.name,
    })
    .from(boxTokens)
    .leftJoin(users, eq(boxTokens.redeemedBy, users.id))
    .where(eq(boxTokens.boxId, boxId))
    .orderBy(desc(boxTokens.createdAt));

  return rows.map((row) => ({
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    permissions: parsePermissionsJson(row.permissions),
    status: row.status as BoxTokenStatus,
    createdAt: row.createdAt,
    redeemedAt: row.redeemedAt,
    redeemedByName: row.redeemedByName,
  }));
}
