# T014 — Helpers de cookie de sesión

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Configuración centralizada de la cookie de sesión (un solo lugar para hardening).

## Alcance

- `src/server/auth/cookies.ts`:
  - `SESSION_COOKIE_NAME` constante.
  - `sessionCookieOptions(): { httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number }` (secure = NODE_ENV production).
- 30 días de expiración base.

## Criterios de aceptación

- [ ] Opciones incluyen httpAlways true y sameSite lax.
- [ ] secure=true solo en producción.

## Tests

- `cookies.test.ts`: flags según entorno.