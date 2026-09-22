# T047 — `assertPermission` + errores tipados

- **Fase:** 4 · Permisos
- **Estado:** ⬜
- **Depende de:** T046

## Objetivo

Gate único de autorización para TODAS las acciones de dominio.

## Alcance

- `src/server/permissions/assert.ts`:
  - `assertPermission(userId, boxId, permission)`: si no existe la alcancía → `NotFoundError`; si existe pero sin permiso → `PermissionError` (tipado, con código estable `forbidden`),
  - `requireCurrentUser` integrado o wrapper `assertAccess(permission)`.
- Errores con códigos estables para la UI: `not_found`, `forbidden`, `unauthorized`.

## Criterios de aceptación

- [ ] Extraño → NotFound; guest sin permiso → PermissionError.
- [ ] Los códigos de error son estables y documentados.

## Tests

- `assert.test.ts`: not found vs forbidden, owner pasa, guest pasa con permiso.