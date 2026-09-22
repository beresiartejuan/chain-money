# T086 — Test: login no filtra existencia de email

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T029

## Objetivo

Test automatizado de la igualdad de respuestas (además del test unitario de T029).

## Alcance

- Test de integración:
  - login con email inexistente vs email existente+password mal,
  - comparar payload completo y timing aproximado (tolerancia generosa, p. ej. < 100ms de diferencia media en 5 corridas).

## Criterios de aceptación

- [ ] Payloads idénticos; timing sin diferencia sistemática grande.

## Tests

- `login-timing.test.ts`.