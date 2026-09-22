# T035 — Flujo `recoverAccount` (reset password + matar sesiones)

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T033

## Objetivo

Recuperar cuenta sin email: email + frase + nuevo password.

## Alcance

- `recoverAccount(input)` en `src/server/auth/recovery.ts`:
  - valida con `recoverSchema` (T024),
  - busca user por email; **si no existe, mismo error genérico** (no filtrar),
  - compara SHA-256 de la frase normalizada con `recoveryPhraseHash` (constant-time),
  - actualiza `passwordHash` con el nuevo password,
  - **borra todas las sesiones** del usuario,
  - opcional: regenerar frase (decisión: no; la frase no cambia en recovery).

## Criterios de aceptación

- [ ] Frase correcta + nuevo password → login con el nuevo password funciona.
- [ ] Todas las sesiones previas quedan inválidas.
- [ ] Email inexistente o frase incorrecta → mismo error genérico.

## Tests

- `recovery-flow.test.ts`: reset ok, sesiones muertas, error genérico.