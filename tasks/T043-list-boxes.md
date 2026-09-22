# T043 — `listBoxes` (propias + compartidas)

- **Fase:** 3 · Alcancías
- **Estado:** ⬜
- **Depende de:** T017, T041

## Objetivo

Listado con permisos efectivos por alcancía.

## Alcance

- `listBoxes()`:
  - propias: `savings_boxes WHERE ownerId = user` (flag `isOwner: true`, permisos = todos),
  - compartidas: join con `box_access` (permisos del access),
  - incluye `currency`, `name`, `createdAt`.

## Criterios de aceptación

- [ ] Usuario ve propias y compartidas diferenciadas con permisos correctos.
- [ ] Sin sesión → UnauthorizedError.

## Tests

- `list-boxes.test.ts`: propias, compartidas, mixtas, sin sesión.