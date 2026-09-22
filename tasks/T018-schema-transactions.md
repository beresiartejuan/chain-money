# T018 — Schema: tabla `transactions`

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T016, T007

## Objetivo

El corazón del producto: transacciones inmutables con autor y metadata completa.

## Alcance

- `transactions`: `id` (text pk UUIDv7), `boxId` (fk savings_boxes), `type` (text: deposit|withdraw|reset), `amountMinor` (integer not null), `counterparty` (text, nullable), `note` (text not null), `createdBy` (fk users), `createdAt` (integer, unix ms).
- Índice compuesto `(boxId, createdAt, id)` para la API incremental.
- Sin columnas `updatedAt`/`deletedAt` (no aplican).

## Criterios de aceptación

- [ ] Migración con tabla e índice compuesto.
- [ ] Sin ON DELETE CASCADE en `boxId` (el historial no se borra; la fk queda restrictiva).

## Verificación

```bash
pnpm db:generate && pnpm db:push
```