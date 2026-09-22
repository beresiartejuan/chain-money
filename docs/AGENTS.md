# Reglas para agentes de código

## 1. Lee la documentación del proyecto antes de tocar código

- Contexto general: [`README.md`](./README.md).
- Producto: [`PRODUCT.md`](./PRODUCT.md).
- Arquitectura: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Base de datos: [`DATABASE.md`](./DATABASE.md).
- Flujo de desarrollo: [`DEVELOPMENT.md`](./DEVELOPMENT.md).

## 2. Next.js 16 — lee la guía local

Este proyecto usa **Next.js 16.x**. Las APIs, convenciones y estructura de archivos pueden diferir del Next.js clásico. Antes de escribir código de Next.js lee la guía relevante en `node_modules/next/dist/docs/` resuelta desde la raíz del proyecto.

## 3. Backend + frontend

- **Frontend**: páginas y componentes en `src/app/`, estilos con Tailwind CSS v4.
- **Backend**: Server Actions, Route Handlers y cualquier lógica de servidor en `src/`.
- **Base de datos**: solo desde el servidor. Nunca importar el cliente de Drizzle en componentes cliente ni en `"use client"`.

## 4. Base de datos

- Usar **Drizzle ORM** con **Turso (libSQL)**.
- Esquema: `src/db/schema.ts`.
- Cliente: `src/db/index.ts`.
- Configuración de migraciones: `drizzle.config.ts` en la raíz.
- Generar/aplicar migraciones con los scripts `db:*` definidos en `package.json`.
- No editar manualmente archivos generados en `drizzle/`.

## 5. Estilo y formato

- Usar **Biome** (`pnpm lint`, `pnpm format`).
- Preferir `function` nombradas y tipos explícitos.
- Seguir el estilo existente; no reescribir lógica de tests salvo para adaptar cambios de interfaz.

## 6. Variables de entorno

- Los secretos van en `.env` (ver `.env.example`).
- Nunca commitear archivos `.env*`.
- Si añades una variable nueva, documentarla en `.env.example` y en [`DATABASE.md`](./DATABASE.md) / [`DEVELOPMENT.md`](./DEVELOPMENT.md).

## 7. Mantener docs al día

Si cambias arquitectura, convenciones, dependencias, flujos o variables de entorno, actualiza el archivo correspondiente en `/docs` para que el siguiente agente tenga contexto actualizado.
