# T083 — Rate limits consolidados (login/recovery/redeem)

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T030, T036, T050

## Objetivo

Revisar que todos los puntos sensibles tengan límite y que sean consistentes.

## Alcance

- Checklist y test:
  - login: `login:{email}` — 5/min,
  - recovery: `recover:{email}` — 5/10min,
  - reveal phrase: `reveal:{userId}` — 3/hora,
  - redeem: `redeem:{userId}` — 10/min,
  - documentar valores en un módulo `src/server/rate-limits.ts` (única fuente).

## Criterios de aceptación

- [ ] Los 4 límites activos y probados (al menos smoke test por punto).

## Tests

- `rate-limits.test.ts`: smoke de cada límite.