# T027 — Server action `logout`

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T026

## Objetivo

Cerrar sesión de forma segura (server-side).

## Alcance

- `logout()`: lee cookie, borra fila de sesión en DB, expira la cookie.
- Idempotente: si no hay cookie/sesión, no falla.

## Criterios de aceptación

- [ ] Tras logout, la fila de sesión no existe en DB.
- [ ] Request posterior con la misma cookie no autentica.
- [ ] Logout sin sesión no lanza.

## Tests

- `logout.test.ts`: invalida, idempotente.