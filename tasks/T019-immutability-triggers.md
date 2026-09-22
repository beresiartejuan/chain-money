# T019 — Triggers SQL de inmutabilidad en migración

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T018

## Objetivo

Que la base de datos rechace UPDATE/DELETE sobre `transactions`, sin depender de la API.

## Alcance

- En la migración (SQL custom de Drizzle):
  - Trigger `BEFORE UPDATE ON transactions` → `RAISE(ABORT, 'transactions are immutable')`.
  - Trigger `BEFORE DELETE ON transactions` → `RAISE(ABORT, 'transactions are immutable')`.
- Verificar que `drizzle-kit` no elimina los triggers en regeneraciones (si los elimina, moverlos a migración manual aparte y documentar el orden).

## Criterios de aceptación

- [ ] El SQL de la migración final contiene ambos triggers.
- [ ] `UPDATE transactions SET ...` directo falla con el mensaje del trigger.
- [ ] `DELETE FROM transactions` directo falla con el mensaje del trigger.

## Verificación

```bash
pnpm db:generate && pnpm db:push
grep -i trigger drizzle/*/migration.sql
```