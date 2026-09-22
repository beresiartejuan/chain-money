# T020 — Tipos inferidos de Drizzle exportados

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T019

## Objetivo

Tipos de dominio derivados del schema (única fuente de verdad).

## Alcance

- En `src/db/schema.ts` exportar: `User`, `NewUser`, `Session`, `SavingsBox`, `BoxToken`, `BoxAccess`, `Transaction`, `NewTransaction`, `TransactionType`, `BoxTokenStatus` (con `$inferSelect`/`$inferInsert`).
- `TransactionType` como unión tipada (`deposit | withdraw | reset`).

## Criterios de aceptación

- [ ] `pnpm build` pasa con los tipos exportados.
- [ ] Ningún otro archivo define tipos duplicados de estas entidades.

## Verificación

```bash
pnpm build
```