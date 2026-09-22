# T064 — Authz en endpoint incremental

- **Fase:** 7 · Sync
- **Estado:** ✅
- **Depende de:** T062, T047

## Objetivo

El endpoint respeta permisos como cualquier action.

## Alcance

- `assertPermission(view:transactions)` en el handler.
- Extraño → 404; guest solo-view → puede leer (200).

## Criterios de aceptación

- [x] Extraño 404, guest con view 200, sin sesión 401.

## Tests

- `incremental-authz.test.ts`: matriz de acceso (service-level) y
  `incremental-endpoint.test.ts` (HTTP con mocks de `next/headers` y de
  `@/server/auth/session`): extraño 404, guest con view 200, guest solo
  create 403, extraño 404, sin sesión 401, box inexistente 404.