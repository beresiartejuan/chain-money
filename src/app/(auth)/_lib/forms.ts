import type { z } from "zod";

/**
 * Helpers puros compartidos por los formularios de auth: mapeo de errores a
 * mensajes por campo y validación del destino del query param `next`. Sin
 * dependencias de React/Next para poder testearlos directo.
 */

/**
 * Primer mensaje de error por campo a partir de un error de Zod. Los issues
 * sin campo (path vacío, p. ej. refines a nivel objeto) se ignoran: los
 * formularios solo muestran errores por campo.
 */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field === "" || field in fieldErrors) {
      continue;
    }
    fieldErrors[field] = issue.message;
  }
  return fieldErrors;
}

/**
 * Igual que `zodFieldErrors` pero a partir del `fieldErrors` que devuelven
 * las actions (`Record<string, string[]>`): toma el primer mensaje de cada
 * campo, que es el que muestra la UI.
 */
export function actionFieldErrors(
  fieldErrors: Record<string, string[]>,
): Record<string, string> {
  const single: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const first = messages[0];
    if (first !== undefined) {
      single[field] = first;
    }
  }
  return single;
}

/**
 * Validación del destino del query param `next` del login (T038; el middleware
 * lo setea en T040). Solo se aceptan rutas internas: empiezan con `/` y no son
 * protocol-relative (`//…`, que apunta a otro origen). Cualquier otro valor
 * cae en `fallback`, para no convertir el parámetro en un open redirect.
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (typeof raw !== "string" || !/^\//.test(raw) || raw.startsWith("//")) {
    return fallback;
  }
  return raw;
}
