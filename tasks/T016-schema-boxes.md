# T016 — Schema: tabla `savings_boxes`

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T015, T006, T008

## Objetivo

Alcancías con dueño, moneda fija y UUIDv7.

## Alcance

- `savings_boxes`: `id` (text pk UUIDv7), `ownerId` (fk users), `name` (text not null), `currency` (text not null), `createdAt`/`updatedAt` (int ms).
- Índice en `ownerId`.
- Nota: el límite de 5 NO es constraint de DB (es lógica de acción, T042).

## Criterios de aceptación

- [ ] Migración con tabla, fk e índice.
- [ ] Insert de prueba con moneda arbitraria no valida catálogo (eso es de la capa de acción, no de DB).

## Verificación

```bash
pnpm db:generate && pnpm db:push
```