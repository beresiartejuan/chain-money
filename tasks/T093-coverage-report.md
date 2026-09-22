# T093 — Coverage report y umbrales verdes

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T005, T087–T091

## Objetivo

Cobertura ≥ 80% en `src/lib` y `src/server` con la suite completa.

## Alcance

- Correr `pnpm test:coverage`.
- Cerrar gaps en módulos de dominio (prioridad: money, cursor, permissions, transactions, tokens).
- Exclusiones justificadas (configs, types-only) documentadas en `vitest.config.ts`.

## Criterios de aceptación

- [ ] `pnpm test:coverage` verde con umbrales configurados.

## Verificación

```bash
pnpm test:coverage
```