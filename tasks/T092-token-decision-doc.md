# T092 — Decisión documentada: token expirado vs acceso canjeado

- **Fase:** 9 · Cierre
- **Estado:** ⬜
- **Depende de:** T090

## Objetivo

Cerrar la pregunta de diseño y dejarla en el producto.

## Alcance

- Confirmar con el owner (una línea de respuesta alcanza): ¿expirar/borrar un token revoca el acceso ya canjeado o solo previene canjes futuros?
- Default actual: **acceso ya canjeado persiste** (el token controla el canje).
- Actualizar `docs/PRODUCT.md` (sección tokens) con la decisión final y el historial de decisiones.

## Criterios de aceptación

- [ ] Decisión registrada en `docs/PRODUCT.md`.
- [ ] Implementación coincide con la decisión (si cambia, ajustar T052/T090).

## Verificación

- Inspección de docs + tests.