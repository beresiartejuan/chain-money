# T041 — Server action `createBox`

- **Fase:** 3 · Alcancías
- **Estado:** ⬜
- **Depende de:** T016, T028

## Objetivo

Crear alcancía con UUIDv7, moneda fija y nombre válido.

## Alcance

- `src/server/boxes/actions.ts`:
  - `createBox(input)`: `requireCurrentUser`, valida name (1–80) y `isSupportedCurrency` (T008), `newId()`, insert.
  - Errores tipados: `ValidationError`, `LimitReachedError` (stub hasta T042).

## Criterios de aceptación

- [ ] Crea alcancía con id UUIDv7 y moneda guardada.
- [ ] Moneda no soportada rechazada con error claro.
- [ ] Requiere sesión (sin sesión → UnauthorizedError).

## Tests

- `create-box.test.ts`: happy, moneda inválida, sin sesión.