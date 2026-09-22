# T068 — Resync completo ante cursor inválido

- **Fase:** 7 · Sync
- **Estado:** ⬜
- **Depende de:** T067

## Objetivo

Autocuración del caché corrupto.

## Alcance

- En `syncBox`: si `parseCursor` del estado guardado falla o el server responde error de cursor → descartar estado y hacer full resync paginado desde el inicio.
- El balance final debe coincidir con el server.

## Criterios de aceptación

- [ ] Estado corrupto → resync completo → balance correcto.
- [ ] No se pierden transacciones del historial local tras el resync.

## Tests

- `sync-recovery.test.ts`: cursor corrupto → full resync.