# T084 — Hardening de errores (sin leaks, códigos estables)

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T048

## Objetivo

Respuestas de error consistentes y sin filtrar internos.

## Alcance

- Módulo `src/server/errors.ts` (o consolidar el existente):
  - códigos estables: `unauthorized`, `not_found`, `forbidden`, `validation`, `limit_reached`, `insufficient_funds`, `rate_limited`,
  - mapping a respuestas UI (status/código/mensaje),
  - catch-all de server actions que loguea internamente pero devuelve genérico (`internal_error`) sin stack.

## Criterios de aceptación

- [ ] Ninguna respuesta incluye stack traces o detalles de DB.
- [ ] Todos los códigos usados por la UI existen en el módulo.

## Tests

- `errors.test.ts`: mapping código → respuesta; catch-all no filtra.