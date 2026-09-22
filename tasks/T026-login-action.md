# T026 — Server action `login`

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T025

## Objetivo

Iniciar sesión con email + password.

## Alcance

- `login(input)` en `src/server/auth/actions.ts`: valida, busca user, `verifyPassword`, crea sesión, setea cookie.
- Si T029/T030 aún no están, dejar mensajes/limite provisionales marcados con TODO.

## Criterios de aceptación

- [ ] Login correcto crea sesión y cookie.
- [ ] Password incorrecto falla.
- [ ] Sesión en DB contiene solo el hash del token.

## Tests

- `login.test.ts`: happy path, password erróneo, email inexistente.