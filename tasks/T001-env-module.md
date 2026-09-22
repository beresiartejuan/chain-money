# T001 — Módulo de env validado con zod

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** —

## Objetivo

`src/lib/env.ts` con variables de entorno validadas al importar.

## Alcance

- Instalar `zod`.
- Crear `src/lib/env.ts` con schema zod:
  - `TURSO_DATABASE_URL`: string no vacío (requerida).
  - `TURSO_AUTH_TOKEN`: opcional.
  - `ENCRYPTION_KEY`: opcional en dev, requerida si `NODE_ENV === "production"`.
- Exportar `env` tipado (frozen). Error claro nombrando la variable faltante.

## Criterios de aceptación

- [ ] Importar el módulo sin `TURSO_DATABASE_URL` lanza error que menciona la variable.
- [ ] `env.tursoDatabaseUrl` es string tipado (no `string | undefined`).
- [ ] En producción sin `ENCRYPTION_KEY` falla; en dev no.

## Verificación

```bash
pnpm test -- src/lib/__tests__/env.test.ts
pnpm lint && pnpm build
```

## Tests

- `src/lib/__tests__/env.test.ts`
  - accepts a valid environment
  - rejects missing TURSO_DATABASE_URL
  - rejects empty ENCRYPTION_KEY in production
  - allows missing ENCRYPTION_KEY in development