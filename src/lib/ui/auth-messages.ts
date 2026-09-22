/**
 * Mapeo de códigos de error de las actions de auth (`src/server/auth/actions.ts`
 * y `src/server/auth/recovery-actions.ts`) a mensajes en español para la UI.
 *
 * Función pura, sin dependencias de React/Next: las páginas solo consumen
 * `authErrorMessage` / `rateLimitMessage` y el mapeo se testa directo.
 *
 * Postura de seguridad (misma que el backend): los mensajes nunca distinguen
 * entre "email inexistente" y "password incorrecto" (un mismo código siempre
 * produce el mismo texto), y los códigos desconocidos caen en un mensaje
 * genérico para no filtrar detalles de errores no previstos.
 */

/** Mensaje para errores inesperados (fallo de red o código no previsto). */
export const UNEXPECTED_AUTH_ERROR =
  "Ocurrió un error inesperado. Intentá de nuevo.";

/** Mensaje por defecto para códigos sin entrada en el mapa. */
const DEFAULT_ERROR_MESSAGE = UNEXPECTED_AUTH_ERROR;

/** Mensaje en español para cada código estable de error de las actions. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  email_taken: "Ese email ya está registrado.",
  invalid_credentials: "Email o contraseña incorrectos.",
  rate_limited: "Demasiados intentos. Probá de nuevo en unos minutos.",
  unauthorized: "Necesitás una sesión activa para hacer eso.",
  validation: "Revisá los campos marcados.",
};

/**
 * Mensaje para el código `code`, con `overrides` opcionales por página
 * (p. ej. recovery usa un genérico distinto para `invalid_credentials`).
 * Los códigos desconocidos devuelven el mensaje genérico; nunca lanza.
 */
export function authErrorMessage(
  code: string,
  overrides: Record<string, string> = {},
): string {
  return overrides[code] ?? AUTH_ERROR_MESSAGES[code] ?? DEFAULT_ERROR_MESSAGE;
}

/**
 * Formatea una espera en milisegundos como texto legible: `"45 s"`,
 * `"10 min"`, `"1 h 30 min"`. Redondea hacia arriba (la espera real es igual
 * o mayor a lo mostrado). Nunca lanza.
 */
export function formatRetryAfterMs(retryAfterMs: number): string {
  const totalSeconds = Math.ceil(retryAfterMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Mensaje de rate limit que informa cuánto falta, con la espera formateada. */
export function rateLimitMessage(retryAfterMs: number): string {
  return `Demasiados intentos. Probá de nuevo en ${formatRetryAfterMs(retryAfterMs)}.`;
}
