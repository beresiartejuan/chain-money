# T005 — Umbrales de cobertura en Vitest

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Cobertura exigida: `lines/functions ≥ 80`, `branches ≥ 70` para `src/lib/**` y `src/server/**`.

## Alcance

- `coverage.thresholds` en `vitest.config.ts` (con `include` correcto).
- Script `test:coverage` en `package.json`.

## Criterios de aceptación

- [ ] `pnpm test:coverage` falla si la cobertura baja de los umbrales.
- [ ] Con el código inicial (pocos módulos) no rompe por archivos irrelevantes (include bien definido).

## Verificación

```bash
pnpm test:coverage
```