# T082 — Test de auditoría anti-edición/borrado

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T081, T003

## Objetivo

Que la auditoría de T081 sea un test que corre siempre, no un comando manual.

## Alcance

- `src/server/__tests__/immutability-audit.test.ts`:
  - importa el módulo de actions de transacciones,
  - verifica que no exporta `updateTransaction`/`deleteTransaction` (ni variantes),
  - (ya existe test DB-level en T022; este es el de superficie de API).

## Criterios de aceptación

- [ ] Test corre en `pnpm test` y pasa.

## Tests

- `immutability-audit.test.ts`.