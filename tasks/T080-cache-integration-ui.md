# T080 — Integrar caché incremental en la vista de alcancía

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T067, T072

## Objetivo

La vista usa el delta-sync en vez de recomputar todo.

## Alcance

- En la vista detalle:
  - al montar: `syncBox(boxId)` (balance e historial desde caché + delta),
  - tras crear transacción/reset: delta-sync en vez de full refresh,
  - balance del header sale del caché (con fallback server-side si no hay storage).

## Criterios de aceptación

- [ ] Segunda carga sin cambios no descarga transacciones (verificable en network log).
- [ ] Balance siempre coherente con el server.

## Verificación

- Manual + tests de T067 ya cubren la lógica.