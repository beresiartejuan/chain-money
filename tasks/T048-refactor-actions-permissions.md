# T048 — Refactor: acciones usan `assertPermission`

- **Fase:** 4 · Permisos
- **Estado:** ⬜
- **Depende de:** T047, T041–T045

## Objetivo

Ninguna acción de dominio decide permisos por su cuenta.

## Alcance

- Auditar y refactorizar: `getBox`, `renameBox`, (T051+ las futuras) para usar `assertPermission`/`resolveEffectiveAccess`.
- Grep de control: cada action de dominio contiene exactamente una llamada de gate.

## Criterios de aceptación

- [ ] `grep -n "resolveEffectiveAccess\|assertPermission" src/server` muestra el gate en cada action.
- [ ] Tests previos siguen en verde.

## Verificación

```bash
pnpm test
grep -rn "assertPermission" src/server | wc -l
```