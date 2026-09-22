# Desarrollo local

## Requisitos

- Node.js compatible con Next.js 16 / React 19.
- pnpm (`packageManager: pnpm@10.30.3`).

## Setup inicial

```bash
pnpm install

# Crear variables de entorno
pnpm exec cp .env.example .env
# Editar .env con TURSO_DATABASE_URL (p. ej. file:./local.db) y TURSO_AUTH_TOKEN
# (puede quedar vacío para file: locales).
#
# ENCRYPTION_KEY es opcional en desarrollo y requerida en producción
# (clave de 32 bytes en base64, para AES-256-GCM):
#   openssl rand -base64 32
```

## Comandos

| Comando | Descripción |
|---|---|
| `pnpm dev` | Levanta Next.js en modo desarrollo. |
| `pnpm build` | Build de producción. |
| `pnpm start` | Inicia servidor de producción. |
| `pnpm lint` | Ejecuta Biome check. |
| `pnpm format` | Formatea con Biome. |
| `pnpm test` | Corre la suite completa de Vitest (una pasada). |
| `pnpm test:watch` | Vitest en modo watch (típico durante desarrollo). |
| `pnpm test:coverage` | Cobertura V8 con umbrales (lines/functions ≥ 80, branches ≥ 70 sobre `src/lib` + `src/server`). |
| `pnpm db:generate` | Genera migraciones de Drizzle. |
| `pnpm db:migrate` | Aplica migraciones. |
| `pnpm db:push` | Push del schema a la DB. |
| `pnpm db:studio` | Abre Drizzle Studio. |

Para `db:*` en desarrollo usar override local para no tocar la DB remota:

```bash
TURSO_DATABASE_URL=file:./local.db pnpm db:migrate
```

Ver [`DATABASE.md`](./DATABASE.md) para variables, migraciones custom y triggers.

## Tests

- Framework: **Vitest** (`vitest.config.mts`: alias `@` → `src/`, entorno
  `node`, cobertura V8 con umbrales).
- Suite actual: **501 tests en 50 archivos**, todos unitarios/de integración:
  - `src/lib/**/__tests__/`: módulos puros (money, currency, cursor, ids,
    crypto, recovery, env, validación, caché de balance, sync).
  - `src/server/**/__tests__/`: services contra **DB real** (`file:`
    temporal vía `createTestDb` en `src/db/__tests__/helpers.ts`), actions,
    rate limits, auditoría anti-edición/borrado.
  - `src/db/__tests__/`: schema y triggers de inmutabilidad contra DB real.
- **Sin tests E2E de UI**: decisión del owner. Los tests de flujo planeados
  (T087–T091) quedaron excluidos; la verificación del producto se apoya en
  los tests de servicio/DB (que cubren los mismos flujos a nivel de lógica)
  más verificación manual de la UI.
- Convención de tests: los archivos viven en `__tests__/` junto al módulo
  que prueban; los helpers de dominio compartidos en `__tests__/helpers.ts`
  (p. ej. `createTestDb`). Ver [`DATABASE.md`](./DATABASE.md) para el detalle
  de la DB de test.

## Convenciones de código

### Service / action (patrón por dominio)

- **Service** (`src/server/<dominio>/service.ts`): lógica de negocio pura
  respecto al request. Recibe la **db como primer parámetro** y **no toca
  `next/headers`**: así es testeable con una DB real y reutilizable desde
  actions, Route Handlers o jobs.
- **Action** (`src/server/<dominio>/actions.ts`, `"use server"`): capa
  delgada. Resuelve la sesión (`requireCurrentUser`), valida con zod si
  corresponde, llama al service y **mapea los errores de dominio** a
  resultados con códigos estables (`AppError.code`) que la UI interpreta.
- Errores de dominio en `src/server/errors.ts`: la UI compara **códigos**,
  nunca mensajes.

### Permisos centralizados

Toda autorización pasa por `src/server/permissions/`:

- `access.ts`: `resolveEffectiveAccess` — único lugar que responde qué puede
  hacer un usuario sobre una alcancía (owner ⇒ todo; guest ⇒ permisos de su
  fila `box_access`).
- `assert.ts`: gates `assertPermission` / `requireBoxAccess` que lanzan los
  errores de dominio (`PermissionError`, `NotFoundError` con 404 oculto).

No resolver permisos ad-hoc dentro de un service: agregar el caso al
módulo de permisos.

### Rate limits

Fuente única en `src/server/rate-limits.ts` (tabla `RATE_LIMITS`, T083) +
primitiva `checkRateLimit` en `src/server/rate-limit.ts` (contador en
memoria). Valores vigentes:

| Punto | Límite | Ventana | Key |
|---|---|---|---|
| `login` | 5 intentos | 1 min | `login:{email}` |
| `recover` | 5 intentos | 10 min | `recover:{email}` |
| `reveal` (recovery phrase) | 3 intentos | 1 h | `reveal:{userId}` |
| `redeem` (canje de token) | 10 intentos | 1 min | `redeem:{userId}` |

El formato `keyPrefix:identifier` es parte del contrato (los tests
construyen keys con esos literales): no cambiarlo sin revisar los tests.

## Flujo típico

1. Definir o modificar tablas en `src/db/schema.ts`.
2. Ejecutar `pnpm db:push` para iterar rápido en local, o `pnpm db:generate` + `pnpm db:migrate` para un entorno con control de migraciones.
3. Implementar la lógica en el service del dominio (db por parámetro, sin `next/headers`) y la Server Action delgada encima.
4. Implementar la UI en `src/app/`.
5. `pnpm test` (o `pnpm test:watch` sobre el módulo tocado) y `pnpm lint` antes de commitear.