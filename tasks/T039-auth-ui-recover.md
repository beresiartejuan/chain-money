# T039 — UI `/recover`

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T035, T036

## Objetivo

Flujo de recuperación sin email.

## Alcance

- `src/app/(auth)/recover/page.tsx` + form:
  - email, frase (textarea con hint de formato), nuevo password,
  - errores: genérico credenciales, rate limit con espera,
  - al éxito: redirige a `/login` con mensaje de confirmación.

## Criterios de aceptación

- [ ] Recuperación correcta permite login con el nuevo password.
- [ ] Frase incorrecta muestra error genérico.

## Verificación

- Manual o test RTL básico.