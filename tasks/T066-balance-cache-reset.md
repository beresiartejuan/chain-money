# T066 — Caché: aplicación de `reset` y deltas vacíos

- **Fase:** 7 · Sync
- **Estado:** ⬜
- **Depende de:** T065

## Objetivo

Casos borde de la caché que la UI va a ejercitar.

## Alcance

- Tests adicionales en `balance-cache.test.ts`:
  - reset como única tx del delta → balance 0,
  - reset con balance negativo previo en caché → 0,
  - delta vacío → estado idéntico,
  - persistencia de `cursor` y `transactionCount` tras cada apply.

## Criterios de aceptación

- [ ] Los 4 casos en verde.

## Tests

- Ampliación de `balance-cache.test.ts`.