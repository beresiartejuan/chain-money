# chain-money — Documentación del proyecto

Este directorio `/docs` contiene todo el contexto necesario para trabajar en el proyecto. **Antes de escribir código**, lee la guía de agentes y la arquitectura.

## Qué es esto

`chain-money` es una aplicación web con **backend + frontend** construida sobre Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 y Biome.

La capa de datos usa **Drizzle ORM** sobre **Turso (libSQL)**. Ver [`DATABASE.md`](./DATABASE.md).

## Índice

- [`AGENTS.md`](./AGENTS.md) — Reglas y convenciones para agentes de código.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Arquitectura general (frontend/backend).
- [`DATABASE.md`](./DATABASE.md) — Setup y operaciones de base de datos.
- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — Flujo de desarrollo local.
- [`PRODUCT.md`](./PRODUCT.md) — Definición del producto.
- [`../tasks/README.md`](../tasks/README.md) — Plan de tareas para construir el producto.

## Quick start

```bash
# Instalar dependencias
pnpm install

# Configurar variables de entorno
cp .env.example .env
# Llenar TURSO_DATABASE_URL y TURSO_AUTH_TOKEN

# Aplicar esquema a la base de datos
pnpm db:push

# Levantar servidor de desarrollo
pnpm dev
```

## Convenciones básicas

- Gestor de paquetes: **pnpm**.
- Formateo/lint: **Biome** (`pnpm lint`, `pnpm format`).
- Import paths: usa `@/*` para referirse a `./src/*`.
- No commitear archivos de entorno (`.env*`).
- Toda la base de datos vive en `src/db/`: schema, cliente y consultas servidor.
