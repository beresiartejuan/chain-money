# T076 — UI de gestión de tokens (crear/borrar/expirar)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T072, T049, T052, T053

## Objetivo

Panel "Compartir" del owner.

## Alcance

- Sección en la vista detalle (solo owner):
  - crear token con checkboxes de permisos (`view:transactions` siempre activo, `create:transactions` y `reset:box` opcionales),
  - lista de tokens: prefix, permisos, estado, fechas; acciones expirar (si active) y borrar,
  - confirmación para borrar/expirar.

## Criterios de aceptación

- [ ] Crear/expire/borrar funcionan y la lista refleja cambios.
- [ ] La sección no existe para guests.

## Verificación

- Manual.