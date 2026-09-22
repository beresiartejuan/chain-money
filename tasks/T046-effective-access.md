# T046 — Resolución de acceso efectivo (owner/guest)

- **Fase:** 4 · Permisos
- **Estado:** ⬜
- **Depende de:** T017

## Objetivo

Un solo lugar que responda: ¿qué puede hacer este usuario en esta alcancía?

## Alcance

- `src/server/permissions/access.ts`:
  - Tipo `Permission = "view:transactions" | "create:transactions" | "reset:box"`.
  - `ALL_PERMISSIONS` + set por rol.
  - `resolveEffectiveAccess(userId, boxId): Promise<{ isOwner: boolean; boxExists: boolean; permissions: Set<Permission> }>` — owner → todos; sino unión de `box_access`.
- Módulo puro de combinación testable aparte: `combinePermissions(sets[])`.

## Criterios de aceptación

- [ ] Owner → todos los permisos sin necesitar box_access.
- [ ] Guest → unión de sus access.
- [ ] Extraño → boxExists true, permissions vacío (el 404 lo decide el caller).

## Tests

- `access.test.ts`: owner, guest único, unión, extraño.