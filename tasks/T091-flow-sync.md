# T091 — Tests de flujo: sync delta exacto

- **Fase:** 9 · Cierre
- **Estado:** ❌ (cancelada — E2E excluidos por decisión del owner; la cobertura vive en tests de servicio/DB y verificación manual de UI)
- **Depende de:** T080

## Objetivo

E2E de la sincronización incremental.

## Alcance

- `flows/sync.test.ts`:
  - A sincroniza (estado inicial),
  - B agrega 3 transacciones,
  - A resincroniza → descarga exactamente 3, balance coherente,
  - reset de B → A resincroniza → balance 0 en cliente.

## Criterios de aceptación

- [ ] Delta exacto y balance coherente end-to-end.

## Tests

- `flows/sync.test.ts`.