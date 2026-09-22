# T004 — Alias `@` en Vitest + exclusiones de cobertura

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Que los tests resuelvan `@/...` igual que la app, y que cobertura excluya artefactos.

## Alcance

- `resolve.alias` en `vitest.config.ts` apuntando `@` → `./src`.
- Excluir `drizzle/`, `node_modules`, `.next`, configs de la cobertura.

## Criterios de aceptación

- [ ] Un test que importa `@/lib/ids` (o cualquier módulo) resuelve el alias.
- [ ] Cobertura no cuenta archivos de `drizzle/`.

## Verificación

```bash
pnpm test
pnpm test:coverage
```