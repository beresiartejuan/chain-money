# T045 — `renameBox` (solo owner)

- **Fase:** 3 · Alcancías
- **Estado:** ⬜
- **Depende de:** T044

## Objetivo

Única mutación permitida de la alcancía: el nombre, solo por el dueño.

## Alcance

- `renameBox(boxId, newName)`:
  - valida name 1–80,
  - **solo owner** (`isOwner` check, guests con cualquier permiso NO pueden renombrar),
  - actualiza `name` + `updatedAt`.

## Criterios de aceptación

- [ ] Owner renombra OK.
- [ ] Guest con todos los permisos NO puede renombrar (Forbidden explícito: es un guest conocido, no un extraño).
- [ ] Moneda e id nunca cambian.

## Tests

- `rename-box.test.ts`: owner ok, guest denegado, validación de nombre.