# T096 — Verificación final: lint + test + build en verde

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T083–T095

## Objetivo

Estado entregable del repo.

## Alcance

- Comando único: `pnpm lint && pnpm test && pnpm test:coverage && pnpm build` → verde.
- `tasks/README.md` con todas las tareas ✅ (o ❌ las canceladas con justificación).
- Sin dependencias sin usar (revisar `package.json`).

## Criterios de aceptación

- [ ] Comando completo en verde.
- [ ] Tabla de tareas actualizada.

## Verificación

```bash
pnpm lint && pnpm test && pnpm test:coverage && pnpm build
```