# T049 — Server action `createToken`

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T017, T047

## Objetivo

Crear tokens de un solo uso con permisos configurables.

## Alcance

- `src/server/tokens/actions.ts`:
  - `createToken(boxId, permissions[])`: **solo owner** (guest → PermissionError; extraño → NotFound),
  - valida permisos ⊆ `ALL_PERMISSIONS`, y mínimo 1 (sugerido: siempre incluye `view:transactions`),
  - `generateAccessToken` (T013) → guarda hash + prefix + status active + createdBy,
  - devuelve el valor crudo **una sola vez**.

## Criterios de aceptación

- [ ] Solo hash en DB; crudo devuelto una vez.
- [ ] Guest no puede crear; extraño recibe NotFound.
- [ ] Permisos fuera del set rechazados.

## Tests

- `create-token.test.ts`: owner ok, guest denegado, permisos inválidos, solo hash en DB.