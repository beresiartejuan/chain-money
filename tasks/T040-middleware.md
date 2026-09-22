# T040 — Middleware de rutas privadas

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T028

## Objetivo

Proteger `/dashboard/**` a nivel middleware.

## Alcance

- `src/middleware.ts`:
  - rutas privadas: `/dashboard/**` y `/redeem` (si no tiene sesión → redirect a `/login?next=...`),
  - rutas de auth (`/login`, `/register`, `/recover`) con sesión → redirect a `/dashboard`,
  - chequeo barato (solo presencia de cookie; la validación real la hace el server en cada action).

## Criterios de aceptación

- [ ] Visitante en `/dashboard` → `/login`.
- [ ] Autenticado en `/login` → `/dashboard`.
- [ ] El redirect `next` vuelve a la página original tras login.

## Verificación

- Manual o test de middleware con mocks.