import "server-only";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { type Permission, type SavingsBox, savingsBoxes } from "@/db/schema";
import { NotFoundError, PermissionError } from "@/server/errors";
import {
  type EffectiveAccess,
  hasPermission,
  OWNER_PERMISSIONS,
  resolveEffectiveAccess,
} from "@/server/permissions/access";

/**
 * T047 — gate único de autorización para todas las acciones de dominio.
 * Puro respecto al request: recibe la db y el `userId` por parámetro (la
 * resolución de sesión vive en `src/server/auth/session.ts`, cuya
 * `requireCurrentUser` depende de cookies y no se re-exporta acá). Las
 * actions de cada dominio hacen `requireCurrentUser()` + `assertPermission`.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/**
 * Helpers puros para la UI: dado un `EffectiveAccess` (de
 * `resolveEffectiveAccess`), responden si se puede mostrar cada acción. El
 * owner pasa siempre sin mirar `permissions`.
 */

/** ¿Puede listar el historial de transacciones? (page de la alcancía). */
export function canView(access: EffectiveAccess): boolean {
  return hasPermission(access, "view:transactions");
}

/** ¿Puede registrar depósitos/retiros? (form de la alcancía). */
export function canCreate(access: EffectiveAccess): boolean {
  return hasPermission(access, "create:transactions");
}

/** ¿Puede resetear el saldo a 0? (acción destructiva). */
export function canReset(access: EffectiveAccess): boolean {
  return hasPermission(access, "reset:box");
}

/**
 * Verifica que `userId` tenga `permission` sobre `boxId`, lanzando el error
 * de dominio que corresponda:
 *
 * - Alcancía inexistente → `NotFoundError` (code `not_found`): el caller
 *   (action o Route Handler) decide si mapear extraños a 404 aparte.
 * - Alcancía existente sin el permiso (owner excluido, guest con otro set,
 *   extraño) → `PermissionError` (code `forbidden`).
 * - OK → `void`.
 *
 * Para distinguar extraño (404) de guest sin permiso (403), consultar
 * `resolveEffectiveAccess` y mapear `boxExists: false` a `NotFoundError`.
 */
export async function assertPermission(
  db: Db,
  userId: string,
  boxId: string,
  permission: Permission,
): Promise<void> {
  const access = await resolveEffectiveAccess(db, userId, boxId);
  if (!access.boxExists) {
    throw new NotFoundError("La alcancía no existe.");
  }
  if (!hasPermission(access, permission)) {
    throw new PermissionError();
  }
}

/**
 * Resuelve la alcancía exigiendo acceso a `userId` (owner o guest con
 * cualquier permiso). Devuelve la fila completa + el acceso efectivo, para
 * páginas tipo `getBox`. Lanza `NotFoundError` si la alcancía no existe o
 * si `userId` no tiene ningún acceso (owner ni `box_access`): un guest con
 * `box_access` pasa aunque su set de permisos esté vacío.
 */
export async function requireBoxAccess(
  db: Db,
  userId: string,
  boxId: string,
): Promise<{ box: SavingsBox; isOwner: boolean; permissions: Permission[] }> {
  const boxes = await db
    .select()
    .from(savingsBoxes)
    .where(eq(savingsBoxes.id, boxId))
    .limit(1);
  const box = boxes[0];

  if (!box) {
    throw new NotFoundError("La alcancía no existe.");
  }

  const isOwner = box.ownerId === userId;
  let permissions: Permission[];

  if (isOwner) {
    permissions = [...OWNER_PERMISSIONS];
  } else {
    const access = await resolveEffectiveAccess(db, userId, boxId);
    if (access.permissions.length === 0) {
      // Extraño: sin filas de access, se trata como inexistente (404).
      throw new NotFoundError("La alcancía no existe.");
    }
    permissions = access.permissions;
  }

  return { box, isOwner, permissions };
}
