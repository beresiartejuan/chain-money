# T085 — Cookie hardening (httpOnly/sameSite/secure)

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T014

## Objetivo

Verificación final de flags de cookie en producción.

## Alcance

- Test que valida `sessionCookieOptions()`:
  - httpOnly siempre true,
  - sameSite lax,
  - secure true si NODE_ENV=production,
  - maxAge 30 días.
- Revisión manual: la cookie real en dev no tiene Secure (para probar en localhost) y en build de prod la tendría.

## Criterios de aceptación

- [ ] Test de opciones en verde.

## Tests

- Ampliación de `cookies.test.ts`.