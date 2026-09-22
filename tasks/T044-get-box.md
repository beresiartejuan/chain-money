# T044 — `getBox` con 404 oculto

- **Fase:** 3 · Alcancías
- **Estado:** ⬜
- **Depende de:** T043, T047

## Objetivo

Detalle de alcancía sin filtrar existencia a terceros.

## Alcance

- `getBox(boxId)`:
  - usa `assertPermission(view:transactions)` (T047) o, si T047 aún no existe, resolveEffectiveAccess manual,
  - si no hay relación → `NotFoundError` (nunca Forbidden a extraños),
  - devuelve box + permisos efectivos del caller.

## Criterios de aceptación

- [ ] Owner y guest con acceso la ven.
- [ ] Extraño → NotFound (no Forbidden).
- [ ] Incluye permisos efectivos en la respuesta.

## Tests

- `get-box.test.ts`: owner, guest, extraño, inexistente.