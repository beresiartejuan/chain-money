# T009 — Cursores incrementales (`src/lib/cursor.ts`)

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Codificación/decodificación del cursor de sincronización `(createdAtMs, id)`.

## Alcance

- Tipo `Cursor { createdAtMs: number; id: string }`.
- `makeCursor(createdAtMs, id): string` (base64url).
- `parseCursor(raw: string): Cursor | null` (null si inválido/corrupto).
- `compareTuples(a: Cursor, b: Cursor): number` para orden estable.

## Criterios de aceptación

- [ ] Roundtrip make→parse es identidad.
- [ ] `parseCursor("garbage")` → null (nunca lanza).
- [ ] `compareTuples` ordena por fecha y desempata por id.

## Tests

- `cursor.test.ts`: roundtrip, orden, desempate, inputs inválidos.