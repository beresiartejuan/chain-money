# T063 — Orden estable `(createdAt, id)` + paginación

- **Fase:** 7 · Sync
- **Estado:** ✅
- **Depende de:** T062

## Objetivo

Que el delta nunca pierda ni duplique transacciones.

## Alcance

- Orden por tupla (no solo fecha): dos tx con mismo `createdAt` se ordenan por id.
- Test con tx de mismo timestamp (insertadas en orden conocido) verificando orden determinista.
- `limit` respetado y validado (min 1, max 100).

## Criterios de aceptación

- [x] Mismo timestamp → desempata por id.
- [x] Delta continuo entre páginas sin gaps ni duplicados (test de walk completo por cursores).

## Tests

- `incremental-ordering.test.ts`: desempate, walk completo.
- Implementado como `incremental.test.ts` (mismo dir `__tests__` de
  transactions): desempate por id, borde de empate con cursor, walk de 25
  txs en 3 páginas (10/10/5) sin gaps ni duplicados, y `limit` validado
  (0/101/-1 → ValidationError; el handler lo mapea a 400).