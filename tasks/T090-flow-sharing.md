# T090 — Tests de flujo: compartir (token → canje → atribución)

- **Fase:** 9 · Cierre
- **Estado:** ❌ (cancelada — E2E excluidos por decisión del owner; la cobertura vive en tests de servicio/DB y verificación manual de UI)
- **Depende de:** T078

## Objetivo

E2E del caso de uso de compartir.

## Alcance

- `flows/sharing.test.ts`:
  - owner crea token con `view+create`,
  - usuario B canjea → ve la alcancía → crea transacción (atribuida a B, no a owner),
  - B sin `reset:box` no puede resetear,
  - owner expira/borra token → B mantiene acceso ya canjeado (decisión T092),
  - canje doble concurrente → 1 solo éxito.

## Criterios de aceptación

- [ ] Flujo completo en verde, atribución correcta.

## Tests

- `flows/sharing.test.ts`.