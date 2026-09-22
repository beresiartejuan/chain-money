/**
 * Constantes compartidas de nombres de alcancía.
 *
 * Vive en `src/lib` (no en `src/server`) para que tanto el servidor como los
 * Client Components (formularios de crear/renombrar en el dashboard) puedan
 * importarla sin arrastrar el módulo de base de datos (server-only).
 */

export const BOX_NAME_MIN_LENGTH = 1;
export const BOX_NAME_MAX_LENGTH = 80;
