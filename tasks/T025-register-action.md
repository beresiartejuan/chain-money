# T025 — Server action `register`

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T015, T024

## Objetivo

Crear cuenta con password hasheado e iniciar sesión.

## Alcance

- `src/server/auth/actions.ts`:
  - `register(input)`: valida con `registerSchema`, chequea email único (error específico, sí se puede distinguir aquí), `hashPassword`, insert user, genera phrase (stub si T033 no está; integración en T033), crea sesión (token crudo en cookie, hash en DB).
- Devuelve `{ ok: true }` o errores de campo tipados.

## Criterios de aceptación

- [ ] Registro exitoso crea user + session en DB y setea cookie httpOnly.
- [ ] Email duplicado rechazado con error claro.
- [ ] Password plano nunca toca la DB.

## Tests

- `register.test.ts`: happy path, duplicado, validación inválida.