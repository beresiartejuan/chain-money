# T024 — Schemas zod de auth (register/login/recover)

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T011

## Objetivo

Validación compartida client/server para auth.

## Alcance

- `src/lib/validation/auth.ts`:
  - `registerSchema`: email (email válido, max 254), password (política T011), name (1–80).
  - `loginSchema`: email + password (sin política, solo presence).
  - `recoverSchema`: email + phrase (formato 12 palabras con `-`) + newPassword (política).
- Exportar tipos inferidos.

## Criterios de aceptación

- [ ] Los 3 schemas parsean/rechazan correctamente.
- [ ] Mismo schema usable en server action y formulario cliente.

## Tests

- `auth-validation.test.ts`: válidos/inválidos por campo.