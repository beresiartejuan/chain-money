# T067 — `syncBox` con storage inyectable

- **Fase:** 7 · Sync
- **Estado:** ⬜
- **Depende de:** T065, T062

## Objetivo

Orquestador de sincronización: pide el delta, aplica y persiste.

## Alcance

- `src/lib/client/sync.ts`:
  - `createBoxSync({ storage, fetchPage })` — dependencias inyectables (storage adapter para localStorage, fetchPage para la API),
  - `syncBox(boxId)`: lee estado guardado → pide desde cursor → aplica → persiste; si `hasMore`, pagina hasta terminar,
  - devuelve `{ transactions: number; balanceMinor }`.

## Criterios de aceptación

- [ ] Segunda sync sin cambios → 0 transacciones descargadas (fetchPage no llamado o con respuesta vacía).
- [ ] Con N nuevas → descarga exactamente N.
- [ ] Estado persistido sobrevive "reload" (nueva instancia con mismo storage).

## Tests

- `sync.test.ts`: delta exacto, persistencia, paginación completa.