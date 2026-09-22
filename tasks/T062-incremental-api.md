# T062 — Endpoint incremental por fecha o ID

- **Fase:** 7 · Sync
- **Estado:** ✅
- **Depende de:** T055, T009

## Objetivo

La API que permite pedir solo lo que falta.

## Alcance

- Route Handler `GET /api/boxes/[boxId]/transactions`:
  - query: `sinceDate` (ISO ms) **o** `sinceTransactionId`, opcional `limit` (default 50, max 100),
  - `sinceDate`: `createdAt > sinceDate` (exclusivo, documentado),
  - `sinceTransactionId`: busca la tx, usa su `(createdAt, id)` como cursor; tx de otra alcancía → 404,
  - respuesta: `{ transactions, nextCursor, hasMore }` con cursor de T009,
  - sin `since*` → desde el inicio (paginado).

## Criterios de aceptación

- [x] `sinceDate` filtra exclusivo y ordena por `(createdAt, id)`.
- [x] `sinceTransactionId` funciona y 404 para tx de otra alcancía.
- [x] `hasMore`/`nextCursor` correctos.

## Tests

- `incremental-endpoint.test.ts`: fecha, id, 404 cross-box, paginación.
- `incremental.test.ts`: service-level (exclusividad, ancla, limit+1, cursor
  inválido → ValidationError).