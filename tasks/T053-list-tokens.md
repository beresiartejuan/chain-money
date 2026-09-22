# T053 — `listTokens` (solo owner, solo prefixes)

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T049

## Objetivo

El owner ve el estado de sus tokens sin exponer secretos.

## Alcance

- `listTokens(boxId)`: **solo owner**; devuelve `id`, `tokenPrefix`, `permissions`, `status`, `createdAt`, `redeemedAt`, `redeemedBy` (nombre del usuario si existe).
- Nunca devuelve hash ni crudo.

## Criterios de aceptación

- [ ] Owner ve lista completa con estados.
- [ ] Guest → PermissionError; extraño → NotFound.
- [ ] Respuesta sin hash ni valor crudo.

## Tests

- `list-tokens.test.ts`: owner ok, guest no, sin secretos en payload.