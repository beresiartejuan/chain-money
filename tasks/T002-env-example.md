# T002 — Documentar variables en `.env.example` y docs

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T001

## Objetivo

`.env.example` y docs reflejan todas las variables del módulo de env.

## Alcance

- `.env.example`: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ENCRYPTION_KEY` con instrucciones de generación (`openssl rand -base64 32`) y ejemplo local (`file:./local.db`).
- Actualizar `docs/DATABASE.md` (sección variables) y `docs/DEVELOPMENT.md` (setup inicial).

## Criterios de aceptación

- [ ] `.env.example` lista las 3 variables con comentarios de cómo generarlas.
- [ ] Docs mencionan `ENCRYPTION_KEY` y su origen.

## Verificación

- Inspección directa + `pnpm lint`.