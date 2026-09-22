# T021 — Test de schema (tablas + uniques)

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T020

## Objetivo

Test de integración contra DB `file:` temporal que fija el contrato del schema.

## Alcance

- Helper de DB de test (crea `file:` temporal, aplica migraciones, limpia al terminar).
- `src/db/__tests__/schema.test.ts`:
  - crea todas las tablas,
  - email único lanza,
  - tokenHash único lanza,
  - (boxId, userId) único lanza,
  - fk de transactions hacia savings_boxes funciona.

## Criterios de aceptación

- [ ] El test corre con `pnpm test` y pasa.
- [ ] Cada test usa su propia DB temporal (aislamiento).

## Verificación

```bash
pnpm test -- src/db/__tests__/schema.test.ts
```