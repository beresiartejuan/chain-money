# T003 — Vitest + scripts de test

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** —

## Objetivo

Runner de tests funcionando con un smoke test.

## Alcance

- Instalar `vitest` (dev).
- Crear `vitest.config.ts` mínimo (entorno `node`).
- Scripts: `test`, `test:watch`.
- Smoke test `src/lib/__tests__/smoke.test.ts`.

## Criterios de aceptación

- [ ] `pnpm test` corre y pasa.
- [ ] Scripts presentes en `package.json`.

## Verificación

```bash
pnpm test
```