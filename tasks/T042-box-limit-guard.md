# T042 — Guard atómico del límite de 5 alcancías

- **Fase:** 3 · Alcancías
- **Estado:** ⬜
- **Depende de:** T041

## Objetivo

Que la 6ta alcancía sea imposible incluso con requests simultáneos.

## Alcance

- `createBox` envuelto en transacción de DB:
  - `SELECT COUNT(*) FROM savings_boxes WHERE ownerId = ?` y si ≥ 5 → rollback con `LimitReachedError`,
  - todo dentro del mismo `db.transaction`.
- Nota: SQLite serializa writes; la transacción + count es suficiente en MVP.

## Criterios de aceptación

- [ ] Con 5 alcancías existentes, crear la 6ta falla con `LimitReachedError`.
- [ ] Test concurrente (Promise.all de N creates con 5 ya existentes) → a lo sumo 0 succeed.

## Tests

- `box-limit.test.ts`: límite, carrera concurrente.