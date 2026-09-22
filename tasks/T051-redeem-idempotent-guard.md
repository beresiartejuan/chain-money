# T051 — Guard: canje doble/concurrente solo gana uno

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T050

## Objetivo

El "un solo uso" debe ser real bajo concurrencia.

## Alcance

- Envolver canje en transacción con re-check de status (y/o `UPDATE ... WHERE status = 'active'` como compare-and-set).
- Test concurrente: `Promise.all` de 2+ canjes del mismo token → exactamente 1 success, resto error, 1 solo `box_access` creado.

## Criterios de aceptación

- [ ] Test concurrente pasa: 1 solo éxito, 1 box_access.
- [ ] Sin race conditions (correr el test 5 veces seguidas).

## Tests

- `redeem-concurrent.test.ts`: carrera de canjes.