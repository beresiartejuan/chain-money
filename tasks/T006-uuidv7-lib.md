# T006 — Helper UUIDv7 (`src/lib/ids.ts`)

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

IDs primarios del dominio generados como UUIDv7 (ordenables por tiempo).

## Alcance

- Instalar `uuid`.
- `src/lib/ids.ts`: `export function newId(): string` → `uuid.v7()`.
- Opcional: `assertUuidV7(value: string): boolean` (valida versión).

## Criterios de aceptación

- [ ] `newId()` produce UUID válido con versión 7.
- [ ] IDs generados consecutivamente no decrecen lexicográficamente.

## Tests

- `ids.test.ts`: validez de versión, orden temporal, 1000 ids sin colisiones.