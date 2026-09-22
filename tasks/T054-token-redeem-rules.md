# T054 — Reglas de canje (hash, status, owner no canjea propio)

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T050

## Objetivo

Consolidar en un test la matriz completa de reglas de canje.

## Alcance

- Test de tabla de casos:
  - token crudo válido → canjea,
  - token alterado (1 char) → no encuentra (inválido),
  - status redeemed/expired → rechazo,
  - owner canjeando propio → rechazo,
  - sin sesión → Unauthorized,
  - rate limit activo → bloqueo.

## Criterios de aceptación

- [ ] Matriz completa en verde (parametrized test).

## Tests

- `redeem-rules.test.ts`: 6 casos parametrizados.