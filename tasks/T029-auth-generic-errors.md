# T029 — Errores genéricos en login (no filtrar email)

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T026

## Objetivo

Login responde exactamente igual si el email no existe o si el password es incorrecto.

## Alcance

- Mensaje/código único (`invalid_credentials`) para ambos casos.
- Misma cantidad de trabajo (evitar early-return obvio que filtre por timing; si email no existe, correr un verify dummy).

## Criterios de aceptación

- [ ] Respuesta idéntica en ambos casos (mensaje y código).
- [ ] Test compara las dos respuestas byte a byte.

## Tests

- `login-errors.test.ts`: igualdad de respuesta para email inexistente vs password erróneo.