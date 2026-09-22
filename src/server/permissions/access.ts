import "server-only";
import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { boxAccess, type Permission, savingsBoxes } from "@/db/schema";

/**
 * T046 — resolución de acceso efectivo: un solo lugar que responde qué puede
 * hacer un usuario sobre una alcancía. Las partes puras (catálogo, unión de
 * conjuntos, parseo/serialización tolerante del JSON de `permissions`) viven
 * acá y se testean sin DB; `resolveEffectiveAccess` es la única función que
 * consulta tablas. El gate que lanza errores de dominio vive en `assert.ts`.
 *
 * Igual que el resto de los services: recibe la db por parámetro y no toca
 * cookies (`next/headers`), así que es testeable con una DB real y
 * reutilizable desde actions, Route Handlers o jobs.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/**
 * Catálogo completo de permisos, en orden canónico. `satisfies` ata el
 * catálogo al tipo `Permission` del schema: si se agrega un permiso nuevo y
 * no se actualiza acá, TS falla el build.
 */
export const ALL_PERMISSIONS = [
  "view:transactions",
  "create:transactions",
  "reset:box",
] as const satisfies readonly Permission[];

/** Permisos del dueño: todos, sin necesitar filas en `box_access`. */
export const OWNER_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS;

/** Set O(1) del catálogo, para el type guard y el parseo tolerante. */
const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Type guard: `value` es un permiso del catálogo (para JSON tolerante). */
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/**
 * Filtra a permisos válidos deduplicando por orden de primera aparición.
 * Nunca lanza: los valores inválidos se ignoran (defensa contra JSON
 * corrupto en `box_access`/`box_tokens`).
 */
function filterValid(values: readonly unknown[]): Permission[] {
  const out: Permission[] = [];
  for (const value of values) {
    if (isPermission(value) && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

/**
 * Unión de conjuntos de permisos, deduplicada y en orden de primera
 * aparición. Helper puro (sin DB) para combinar sets de `box_access` o de
 * múltiples tokens.
 */
export function combinePermissions(
  sets: readonly (readonly Permission[])[],
): Permission[] {
  return filterValid(sets.flat());
}

/**
 * Parsea el JSON de la columna `permissions` (en `box_access` y
 * `box_tokens`, ej. `'["view:transactions"]'`). Tolerante por diseño: JSON
 * inválido, un valor no-array o entradas fuera del catálogo se ignoran;
 * nunca lanza, así que una fila corrupta solo aporta 0 permisos.
 */
export function parsePermissionsJson(json: string): Permission[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return filterValid(parsed);
}

/**
 * Serializa permisos a la forma canónica que guardan `box_access` y
 * `box_tokens`: JSON `string[]`, deduplicado en orden de primera aparición
 * (invirtiendo `parsePermissionsJson` se recupera el mismo set).
 */
export function serializePermissionsJson(
  permissions: readonly Permission[],
): string {
  return JSON.stringify(combinePermissions([permissions]));
}

/** Resultado de `resolveEffectiveAccess`: qué puede hacer `userId` en `boxId`. */
export type EffectiveAccess = {
  /** `true` solo si el usuario es el dueño de la alcancía. */
  isOwner: boolean;
  /** `false` si la alcancía no existe (el 404 lo decide el caller). */
  boxExists: boolean;
  /** Owner → todos; guest → unión de sus `box_access`; extraño → vacío. */
  permissions: Permission[];
};

/** ¿La access incluye `permission`? Owner pasa siempre (helper puro p/ UI). */
export function hasPermission(
  access: Pick<EffectiveAccess, "isOwner" | "permissions">,
  permission: Permission,
): boolean {
  return access.isOwner || access.permissions.includes(permission);
}

/**
 * Resuelve el acceso efectivo de `userId` sobre `boxId`:
 *
 * - Alcancía inexistente → `{ isOwner: false, boxExists: false,
 *   permissions: [] }`.
 * - Owner → `{ isOwner: true, boxExists: true }` con todos los permisos,
 *   sin mirar `box_access` (ser dueño no requiere filas de acceso).
 * - Guest → unión de las filas de `box_access` del usuario. Por la unique
 *   `box_access_box_user_unique` debería haber una sola, pero se unen todas
 *   por robustez; JSON corrupto aporta 0 permisos y nunca lanza.
 * - Extraño (autenticado sin access) → `{ isOwner: false, boxExists: true,
 *   permissions: [] }`: si el caller quiere ocultar la existencia de la
 *   alcancía, mapea a 404 él mismo.
 */
export async function resolveEffectiveAccess(
  db: Db,
  userId: string,
  boxId: string,
): Promise<EffectiveAccess> {
  const boxes = await db
    .select({ ownerId: savingsBoxes.ownerId })
    .from(savingsBoxes)
    .where(eq(savingsBoxes.id, boxId))
    .limit(1);
  const box = boxes[0];

  if (!box) {
    return { isOwner: false, boxExists: false, permissions: [] };
  }

  if (box.ownerId === userId) {
    return {
      isOwner: true,
      boxExists: true,
      permissions: [...OWNER_PERMISSIONS],
    };
  }

  const rows = await db
    .select({ permissions: boxAccess.permissions })
    .from(boxAccess)
    .where(and(eq(boxAccess.boxId, boxId), eq(boxAccess.userId, userId)));

  return {
    isOwner: false,
    boxExists: true,
    permissions: combinePermissions(
      rows.map((row) => parsePermissionsJson(row.permissions)),
    ),
  };
}
