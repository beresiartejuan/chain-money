import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import type { User } from "@/db/schema";
import { hashAccessToken } from "@/lib/crypto/token";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/server/auth/cookies";
import { createSessionRow, resolveSessionUser } from "@/server/auth/service";
import { UnauthorizedError } from "@/server/errors";

/**
 * Resolución de sesión actual. Esta capa sí depende de `next/headers`
 * (cookies): lee/setea/borra la cookie de sesión usando siempre las opciones
 * de hardening de `cookies.ts`. La lógica de DB vive en `service.ts`, que es
 * la parte testeable; aquí solo queda el glue con el request.
 */

/**
 * Genera un token, inserta la fila de sesión (hash como id) y setea la cookie
 * httpOnly con el token crudo. Devuelve el token crudo, solo para el flujo
 * interno del request (p. ej. debugging o pasarlo a otra capa); la UI no lo
 * necesita.
 */
export async function createSession(userId: string): Promise<string> {
  const { token } = await createSessionRow(db, userId);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());

  return token;
}

/**
 * Devuelve el usuario autenticado para el request actual, o `null` si no hay
 * cookie, el token es desconocido o la sesión expiró.
 *
 * Envuelta en `cache()` de React: en un request con múltiples componentes
 * (layout + page + …) golpea la DB una sola vez. Fuera de RSC/action
 * (p. ej. tests directos) `cache()` degrada a identidad, así que también
 * funciona como función normal.
 *
 * La lógica de DB (lookup + expiry) vive en `resolveSessionUser`
 * (`service.ts`): cookie válida → usuario; inexistente o expirada → `null`
 * (una sesión expirada NO autentica, y de paso se borra de la DB).
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }

  return resolveSessionUser(db, hashAccessToken(raw));
});

/**
 * Como `getCurrentUser` pero lanza `UnauthorizedError` si no hay sesión. Para
 * acciones que exigen usuario autenticado.
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (user === null) {
    throw new UnauthorizedError();
  }
  return user;
}
