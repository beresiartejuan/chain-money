# T037 — UI `/register` (muestra frase una vez)

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T025, T033

## Objetivo

Formulario de registro con el paso post-registro de la recovery phrase.

## Alcance

- `src/app/(auth)/register/page.tsx` + form component:
  - campos email/password/name, validación client con `registerSchema` (mensajes por campo),
  - al éxito: pantalla "guardá tu frase" con la frase, botón copiar, checkbox "la guardé" para continuar,
  - la frase NO se guarda en estado global ni localStorage; solo vive en el paso actual.
- Link a `/login`.

## Criterios de aceptación

- [ ] Flujo completo: registro → frase visible → confirmación → redirige a `/dashboard`.
- [ ] Errores de validación visibles por campo.
- [ ] La frase no aparece en ninguna otra página ni en storage.

## Verificación

- Manual (o RTL si está): registro feliz + error de campo.