# T017 — Schema: tablas `box_tokens` + `box_access`

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T016, T013

## Objetivo

Tokens de un solo uso y el acceso que otorgan tras el canje.

## Alcance

- `box_tokens`: `id` (text pk), `boxId` (fk), `tokenHash` (text unique not null), `tokenPrefix` (text), `permissions` (text json array), `status` (text: active|expired|redeemed), `createdBy` (fk users), `createdAt`, `redeemedAt` (nullable), `redeemedBy` (fk, nullable). Índice `boxId`.
- `box_access`: `id` (text pk), `boxId` (fk), `userId` (fk), `tokenId` (fk box_tokens), `permissions` (text json), `createdAt`. **Unique `(boxId, userId)`**.

## Criterios de aceptación

- [ ] Migración con ambas tablas, uniques e índices.
- [ ] Insert duplicado de `tokenHash` falla.
- [ ] Insert duplicado de `(boxId, userId)` en box_access falla.

## Verificación

```bash
pnpm db:generate && pnpm db:push
```