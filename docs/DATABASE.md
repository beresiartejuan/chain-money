# Base de datos — Drizzle ORM + Turso

Stack recomendado en la guía oficial de Drizzle para [Turso new database](https://orm.drizzle.team/docs/get-started/turso-new).

## Dependencias

```bash
pnpm add drizzle-orm@rc @libsql/client dotenv server-only
pnpm add -D drizzle-kit@rc tsx
```

> Nota: `drizzle-orm@rc` y `drizzle-kit@rc` son la versión recomendada por la guía oficial en el momento del setup.

## Archivos

| Archivo | Propósito |
|---|---|
| `src/db/schema.ts` | Definición de tablas con `drizzle-orm/sqlite-core`. |
| `src/db/index.ts` | Cliente de Drizzle expuesto para el servidor. |
| `drizzle.config.ts` | Configuración de Drizzle Kit (schema, out, dialect, credenciales). |
| `.env.example` | Plantilla de variables de entorno. |
| `.env` | Variables reales (generado a mano, no commitear). |

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `TURSO_DATABASE_URL` | Siempre | URL de conexión: `libsql://...` (Turso Cloud) o `file:...` (local). |
| `TURSO_AUTH_TOKEN` | Solo URLs remotas | Token de Turso Cloud. Opcional (puede quedar vacío) para `file:` locales. |
| `ENCRYPTION_KEY` | Producción | Clave de 32 bytes en base64 para AES-256-GCM. Opcional en desarrollo. |

Generar `ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

> Tratarla como irreemplazable: cambiarla hace ilegibles las frases de recuperación ya cifradas.

Turso Cloud:

```env
TURSO_DATABASE_URL=libsql://<db-name>-<org>.turso.io
TURSO_AUTH_TOKEN=<token>
ENCRYPTION_KEY=<clave generada>
```

Bases locales de desarrollo (`TURSO_AUTH_TOKEN` puede quedar vacío):

```env
TURSO_DATABASE_URL=file:./local.db
TURSO_AUTH_TOKEN=
```

Estas variables se validan al importar `src/lib/env.ts` (zod, export `env`). En producción sin `ENCRYPTION_KEY` el módulo lanza un error nombrando la variable faltante.

### Override local para dev y tests

Para iterar en local sin tocar la DB remota, anteponer el override al
comando (los scripts de `package.json` no fijan la URL):

```bash
TURSO_DATABASE_URL=file:./local.db pnpm db:migrate
TURSO_DATABASE_URL=file:./local.db pnpm db:push
```

Los tests de dominio/DB no leen `.env`: usan DBs `file:` temporales creadas
por el helper `createTestDb` (`src/db/__tests__/helpers.ts`), aisladas por
test y borradas al terminar (ver [Tests de esquema](#tests-de-esquema-db-real)).

## Cliente

```ts
import "server-only";
import "dotenv/config";
import { drizzle } from "drizzle-orm/libsql";

const databaseUrl = process.env.TURSO_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing TURSO_DATABASE_URL environment variable");
}

export const db = drizzle({
  connection: {
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
```

El import `server-only` fuerza un error de build si el cliente se importa accidentalmente en un componente de cliente.

## Esquema

La definición real vive en `src/db/schema.ts` (con tipos inferidos exportados
en el mismo archivo). Tablas finales (6):

- `users`: `id` (text PK, UUIDv7 generado por la app), `email` (text unique not null), `passwordHash`, `name`, `recoveryPhraseEncrypted` (nullable), `recoveryPhraseHash` (nullable), `createdAt`/`updatedAt` (int, unix ms).
- `sessions`: `id` (text PK, hash SHA-256 del token de sesión, nunca el token en claro), `userId` (FK → `users.id`, ON DELETE CASCADE), `expiresAt` (int ms), `createdAt`. Índice en `userId`.
- `savings_boxes`: `id` (text PK, UUIDv7), `ownerId` (FK → `users.id`, ON DELETE CASCADE), `name`, `currency` (fija por alcancía), `createdAt`/`updatedAt`. Índice en `ownerId`. El límite de 5 alcancías por usuario es lógica de acción, no constraint de DB.
- `box_tokens`: `id` (text PK), `boxId` (FK → `savings_boxes.id`, ON DELETE CASCADE), `tokenHash` (unique; solo se persiste el hash, nunca el token crudo), `tokenPrefix` (8 chars, identificador no secreto para UI/logs), `permissions` (JSON string[]), `status` (`active` | `expired` | `redeemed`), `createdBy` (FK → `users.id`), `createdAt`, `redeemedAt` (nullable), `redeemedBy` (FK nullable → `users.id`). Índice en `boxId`.
- `box_access`: acceso otorgado tras canjear un token. `id` (text PK), `boxId` (FK → `savings_boxes.id`, ON DELETE CASCADE), `userId` (FK → `users.id`, ON DELETE CASCADE), `tokenId` (FK **NOT NULL sin ON DELETE** → `box_tokens.id`), `permissions` (JSON string[]), `createdAt`. Unique en `(boxId, userId)`: un usuario tiene como máximo un acceso por alcancía; un nuevo canje **actualiza** permisos (unión de permisos) y apunta `tokenId` al token recién canjeado en lugar de crear otra fila. La FK a `box_tokens` es deliberadamente restrictiva: no se puede borrar un token canjeado sin romper la trazabilidad (ver [`PRODUCT.md`](./PRODUCT.md), decisión de tokens).
- `transactions`: `id` (text PK, UUIDv7), `boxId` (FK **restrictiva, sin ON DELETE** → `savings_boxes.id`: borrar una alcancía no borra su historial), `type` (`deposit` | `withdraw` | `reset`), `amountMinor` (int, unidades menores de la moneda; `0` en `reset`), `counterparty` (nullable), `note` (text, máx. 150 chars), `createdBy` (FK → `users.id`), `createdAt`. Índice en `(boxId, createdAt, id)` que sostiene el orden del delta incremental. Tabla **inmutable**: triggers rechazan UPDATE/DELETE (ver abajo) y no tiene `updatedAt`.

Las columnas `createdAt`/`updatedAt` usan `$defaultFn` de Drizzle (default a nivel ORM, no de DB): la base no tiene `DEFAULT` y la app asigna `Date.now()`.

## Triggers de inmutabilidad (SQL custom)

Los triggers viven en la migración custom
`drizzle/20260918234547_immutability_triggers/migration.sql` (generada con
`drizzle-kit generate --custom`):

```sql
CREATE TRIGGER IF NOT EXISTS transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;
```

- Corren **después** de la migración `20260918233703_lean_lilandra` (que crea
  `transactions`): el orden de aplicación es el orden lexicográfico de las
  carpetas de `drizzle/`, y `20260918234547_…` > `20260918233703_…`.
- La primera sentencia del archivo es un `SELECT 1;` de relleno: el migrator
  de Drizzle divide el archivo por `--> statement-breakpoint` y la línea de
  comentario que `--custom` deja como cabecera, sola, hace fallar a
  `drizzle-kit migrate` con `SQLITE_UNKNOWN_0: not an error` (SQLite no
  puede ejecutar un statement que es solo un comentario).
- **Quirk de libsql (hallazgo de T022, fijado por test)**: un UPDATE/DELETE
  cuyo `WHERE` no matchea ninguna fila **no dispara el trigger BEFORE**
  (SQLite/libsql salta el cuerpo del trigger cuando no hay filas que
  tocar): la sentencia termina OK con `rowsAffected = 0` y el `RAISE` nunca
  se evalúa. La inmutabilidad por trigger solo protege contra sentencias
  que matchean filas existentes. La app nunca intenta UPDATE/DELETE de
  transacciones (test de auditoría anti-edición/borrado en
  `src/server/__tests__/immutability-audit.test.ts`), así que el caso
  0-filas no ocurre en la práctica.
- `pnpm db:generate` NO los elimina: drizzle-kit no conoce los triggers
  (no están en ningún snapshot), así que nunca genera `DROP TRIGGER`; con el
  schema sin cambios reporta "No schema changes, nothing to migrate" y
  `pnpm db:push` tampoco los toca.
- **Cómo regenerar migraciones sin perder los triggers**: crear las
  migraciones nuevas siempre con `pnpm db:generate` normal (la migración
  custom queda intacta porque su snapshot es la hoja y no hay DDL de
  triggers en el schema) o, si hace falta una migración custom nueva, con
  `pnpm drizzle-kit generate --custom --name <nombre>`; en ambos casos el
  tag (timestamp) de la carpeta nueva queda mayor que el de la migración de
  triggers, así que los triggers se siguen aplicando al final. Verificar
  después con `grep -ri trigger drizzle/*/migration.sql`.
- **Importante**: los archivos de `drizzle/` son generados, pero la
  migración custom se edita a mano (solo su `migration.sql`; el
  `snapshot.json` es la copia de la hoja que dejó `--custom`). `IF NOT
  EXISTS` hace que re-aplicarla sobre una DB que ya los tenga no falle.

> ⚠️ Nunca apuntar `db:*` a la DB remota en desarrollo: usar siempre
> override local (`TURSO_DATABASE_URL=file:./local.db pnpm db:migrate`).

## Migraciones

Scripts definidos en `package.json`:

```bash
pnpm db:generate   # Genera archivos SQL de migración
pnpm db:migrate    # Aplica migraciones pendientes
pnpm db:push       # Aplica cambios directamente (útil en iteración local)
pnpm db:studio     # UI de Drizzle Studio
```

Las migraciones viven en `drizzle/<timestamp>_<nombre>/` con `migration.sql`
+ `snapshot.json`. El orden de aplicación es lexicográfico por nombre de
carpeta (timestamp primero). Ver [Triggers de inmutabilidad](#triggers-de-inmutabilidad-sql-custom)
para el flujo de migraciones custom.

## Reglas

- No importar `src/db/index.ts` ni `drizzle-orm` en componentes `"use client"`.
- Usar transacciones para modificaciones de múltiples pasos.
- Indexar claves foráneas y columnas consultadas frecuentemente.
- Los archivos de `drizzle/` son generados: no editarlos a mano (excepción:
  el `migration.sql` de una migración custom creada con
  `drizzle-kit generate --custom`, ver
  [Triggers de inmutabilidad](#triggers-de-inmutabilidad-sql-custom)).

## Tests de esquema (DB real)

`src/db/__tests__/schema-db.test.ts` aplica las migraciones a una DB
`file:` temporal (helper `createTestDb` en `src/db/__tests__/helpers.ts`:
`mkdtemp` en el dir temporal del SO + `drizzle-orm/libsql/migrator`) y fija
el contrato: todas las tablas se crean, los uniques de `email`,
`tokenHash` y `(boxId, userId)` fallan al duplicar, la FK de
`transactions → savings_boxes` es restrictiva y los triggers de
inmutabilidad quedan registrados. La DB se borra en `afterAll`.

El mismo helper alimenta `src/db/__tests__/immutability.test.ts`, que fija
el contrato de los triggers contra una DB real: el INSERT funciona (control
positivo), un UPDATE y un DELETE crudos fallan con el mensaje del trigger
(`transactions are immutable`), la fila queda intacta, y se documenta el
quirk de libsql del caso 0-filas (ver arriba).
