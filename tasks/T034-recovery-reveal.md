# T034 — `revealRecoveryPhrase` con rate limit

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T033, T028, T030

## Objetivo

El usuario autenticado puede volver a ver su frase (caso "me la guardé mal"), con límite y registro.

## Alcance

- `src/server/auth/recovery.ts`:
  - `revealRecoveryPhrase()`: requiere sesión (T028), desencripta con la key, devuelve la frase.
  - Rate limit estricto (p. ej. 3/hora por usuario, reusar T030).
  - Registro simple de auditoría (timestamp en log de server; MVP sin tabla).

## Criterios de aceptación

- [ ] Sin sesión → error (nunca devuelve frase).
- [ ] Con sesión → frase correcta (decifrable con la key).
- [ ] 4ta llamada en la hora es bloqueada.

## Tests

- `recovery-reveal.test.ts`: auth requerida, roundtrip, rate limit.