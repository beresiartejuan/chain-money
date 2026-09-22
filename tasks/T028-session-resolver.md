# T028 — Resolver de sesión actual

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T026

## Objetivo

Un único punto para obtener el usuario autenticado desde la cookie.

## Alcance

- `src/server/auth/session.ts`:
  - `getCurrentUser(): Promise<User | null>` — lee cookie, hash del token, busca sesión no expirada, devuelve user o null.
  - `requireCurrentUser(): Promise<User>` — lanza `UnauthorizedError` si no hay sesión.
- Cache por request (React `cache()`) para no pegar a la DB varias veces.

## Criterios de aceptación

- [ ] Cookie válida → usuario; cookie inválida/expirada → null.
- [ ] Sesión expirada NO autentica.

## Tests

- `session.test.ts`: válida, expirada, inexistente.