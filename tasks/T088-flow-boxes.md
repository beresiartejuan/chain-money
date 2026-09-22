# T088 — Tests de flujo: boxes (5 límite, rename, list)

- **Fase:** 9 · Cierre
- **Estado:** ❌ (cancelada — E2E excluidos por decisión del owner; la cobertura vive en tests de servicio/DB y verificación manual de UI)
- **Depende de:** T071

## Objetivo

E2E del ciclo de alcancías.

## Alcance

- `flows/boxes.test.ts`:
  - crear 5 → 6ta rechazada,
  - rename owner ok / guest denegado,
  - list refleja propias + compartidas,
  - moneda inmutable desde creación.

## Criterios de aceptación

- [ ] Flujo completo en verde.

## Tests

- `flows/boxes.test.ts`.