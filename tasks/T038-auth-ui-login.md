# T038 — UI `/login` + errores genéricos

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T026, T029

## Objetivo

Formulario de login con mensaje único de error.

## Alcance

- `src/app/(auth)/login/page.tsx` + form:
  - email + password, validación client,
  - error genérico "credenciales inválidas" (nunca distinguir email/password),
  - muestra error de rate limit si corresponde (espera),
  - links a `/register` y `/recover`.

## Criterios de aceptación

- [ ] Login feliz redirige a `/dashboard`.
- [ ] Error genérico visible en ambos casos de fallo.

## Verificación

- Manual o RTL básico.