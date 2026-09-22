# T057 — Atribución forzada de autor y `createdAt` de server

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T055

## Objetivo

El cliente nunca puede mentir sobre quién hizo la transacción ni cuándo.

## Alcance

- En `createTransaction`: ignorar/explotar si el input incluye `createdBy` o `createdAt` (el schema de validación los remueve/strips), fijar server-side.
- Test: pasar `createdBy` ajeno en el input → la fila se crea con el usuario autenticado.

## Criterios de aceptación

- [ ] `createdBy` siempre = usuario autenticado.
- [ ] `createdAt` siempre = server time.

## Tests

- `attribution.test.ts`: intento de spoofing de createdBy/createdAt ignorado.