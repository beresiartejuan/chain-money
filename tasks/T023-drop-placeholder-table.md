# T023 — Migración: eliminar tabla placeholder `users_table`

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T015

## Objetivo

Limpiar el schema inicial de create-next-app/drizzle-guide.

## Alcance

- La migración que crea `users` debe incluir `DROP TABLE IF EXISTS users_table`.
- `src/db/schema.ts` sin ninguna referencia a `users_table`.
- `docs/DATABASE.md` actualizado si mencionaba el placeholder.

## Criterios de aceptación

- [ ] `pnpm db:push` sobre la DB local existente (con users_table) la elimina.
- [ ] `grep -r users_table src/` sin resultados.

## Verificación

```bash
pnpm db:push
grep -r "users_table" src/ || echo "clean"
```