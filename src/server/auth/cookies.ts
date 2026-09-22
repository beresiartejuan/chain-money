/**
 * Configuración centralizada de la cookie de sesión.
 *
 * Módulo puro, intencionalmente sin dependencias de servidor pesado
 * (`next/headers`, Drizzle, etc.): solo constantes y una función, para que se
 * pueda importar (y testear) fuera del runtime de Next.js. El hardening vive
 * aquí y solo aquí; los call sites deben leer estas opciones, no armar las
 * suyas.
 */

/** Nombre de la cookie que transporta el identificador de sesión. */
export const SESSION_COOKIE_NAME = "cm_session";

/** Expiración base de la sesión: 30 días, en milisegundos. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** El mismo TTL en segundos: la unidad que espera `maxAge` en cookies. */
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/**
 * Opciones de hardening para la cookie de sesión.
 *
 * - `httpOnly`: el JS del navegador nunca lee la cookie (mitiga XSS).
 * - `sameSite: "lax"`: no se envía en requests cross-site (mitiga CSRF).
 * - `secure`: solo en producción, para que el desarrollo local sobre
 *   `http://localhost` siga funcionando.
 * - `maxAge` en segundos porque es la unidad que usan las APIs de cookies.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  };
}
