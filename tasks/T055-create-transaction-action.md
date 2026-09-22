# T055 — Server action `createTransaction`

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T018, T047

## Objetivo

Crear transacciones (deposit/withdraw) con validación y atribución.

## Alcance

- `src/server/transactions/actions.ts`:
  - `createTransaction(boxId, input)`: gate `assertPermission(create:transactions)`,
  - valida con schemas (T056), inserta con `createdBy` = usuario actual y `createdAt` = server time,
  - `newId()` para el id.

## Criterios de aceptación

- [ ] Crea transacción con autor correcto.
- [ ] Sin permiso → PermissionError; extraño → NotFound.

## Tests

- `create-transaction.test.ts`: happy deposit/withdraw, sin permiso.