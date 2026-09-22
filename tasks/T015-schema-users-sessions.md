# T015 — Schema: tablas `users` + `sessions`

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T001, T010, T013

## Objetivo

Primeras tablas del dominio en `src/db/schema.ts`, reemplazando el placeholder.

## Alcance

- `users`: `id` (text pk, UUIDv7), `email` (text unique not null), `passwordHash` (text not null), `name` (text not null), `recoveryPhraseEncrypted` (text), `recoveryPhraseHash` (text), `createdAt`/`updatedAt` (int ms).
- `sessions`: `id` (text pk = hash del token), `userId` (fk users), `expiresAt` (int ms), `createdAt`.
- Índice en `sessions.userId`.

## Criterios de aceptación

- [ ] `pnpm db:generate` produce migración con ambas tablas e índices.
- [ ] `pnpm db:push` contra `file:./local.db` limpio aplica sin errores.
- [ ] Email único verificado en migración.

## Verificación

```bash
pnpm db:generate && pnpm db:push
```