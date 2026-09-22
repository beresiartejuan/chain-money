# T094 — Actualizar `/docs` con arquitectura real

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T087–T091

## Objetivo

Docs que reflejen lo construido.

## Alcance

- `ARCHITECTURE.md`: árbol real de `src/` (lib, server, app), flujo de datos (actions → db, sync incremental, caché).
- `DATABASE.md`: esquema final, triggers, regeneración de migraciones.
- `DEVELOPMENT.md`: comandos finales (`test`, `test:watch`, `test:coverage`).
- `PRODUCT.md`: decisiones finales integradas (T092), sin preguntas abiertas.

## Criterios de aceptación

- [ ] Ninguna sección desactualizada respecto al código.

## Verificación

- Lectura cruzada docs vs código.