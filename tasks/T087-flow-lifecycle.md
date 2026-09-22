# T087 — Tests de flujo: lifecycle (register→recovery→login)

- **Fase:** 9 · Cierre
- **Estado:** ❌ (cancelada — E2E excluidos por decisión del owner; la cobertura vive en tests de servicio/DB y verificación manual de UI)
- **Depende de:** T039

## Objetivo

E2E de la vida de una cuenta contra DB real.

## Alcance

- `src/server/__tests__/flows/lifecycle.test.ts` (DB file temporal):
  - register → sesión activa → logout,
  - recovery con frase → password nuevo → login ok,
  - sesiones viejas muertas,
  - login con password viejo falla.

## Criterios de aceptación

- [ ] Flujo completo en verde con DB real.

## Tests

- `flows/lifecycle.test.ts`.