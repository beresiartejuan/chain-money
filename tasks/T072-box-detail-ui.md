# T072 — Vista detalle de alcancía (header + balance)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T069, T044

## Objetivo

Página de detalle con datos base.

## Alcance

- `src/app/dashboard/boxes/[id]/page.tsx`:
  - usa `getBox` (con permisos efectivos),
  - header: nombre, moneda, balance (suma server-side de momento), badge compartida,
  - 404 page para extraños (usa el NotFoundError),
  - layout preparado para form/historial (T073/T074).

## Criterios de aceptación

- [ ] Owner/guest ven la vista; extraño → 404.
- [ ] Balance correcto con datos de prueba.

## Verificación

- Manual.