# T089 — Tests de flujo: transacciones inmutables + reset

- **Fase:** 9 · Cierre
- **Estado:** ❌ (cancelada — E2E excluidos por decisión del owner; la cobertura vive en tests de servicio/DB y verificación manual de UI)
- **Depende de:** T075

## Objetivo

E2E del corazón del producto.

## Alcance

- `flows/transactions.test.ts`:
  - deposit/withdraw con atribución,
  - withdraw > balance rechazado,
  - reset → balance 0 → reset de nuevo no-op,
  - intento de UPDATE/DELETE crudo → error de trigger,
  - historial completo intacto tras reset.

## Criterios de aceptación

- [ ] Flujo completo en verde.

## Tests

- `flows/transactions.test.ts`.