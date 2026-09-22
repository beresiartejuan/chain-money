# T069 — UI `/dashboard` con lista de alcancías

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T043

## Objetivo

Home del producto: todas las alcancías del usuario.

## Alcance

- `src/app/dashboard/page.tsx`:
  - usa `listBoxes`, agrupa propias/compartidas,
  - card por alcancía: nombre, código de moneda, balance (desde `boxId` → suma server-side simple; caché llega en T080), badge "compartida",
  - contador "N/5",
  - estados vacíos.

## Criterios de aceptación

- [ ] Lista correcta con balance coherente con las transacciones de seed.
- [ ] Diferenciación propia vs compartida visible.

## Verificación

- Manual con datos de prueba.