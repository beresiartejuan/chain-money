# T079 — UI refleja permisos (ocultar/deshabilitar)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T072, T046

## Objetivo

La UI respeta los permisos efectivos en toda la vista de alcancía.

## Alcance

- Mapeo permisos → UI:
  - sin `view:transactions`: no debería ocurrir (canje mínimo exige view), pero la vista degrada,
  - sin `create:transactions`: form oculto + banner "solo lectura",
  - sin `reset:box`: botón reset oculto,
  - no-owner: sin rename, sin panel de tokens.

## Criterios de aceptación

- [ ] Matriz de permisos verificada manualmente (owner / guest view / guest view+create / guest all).

## Verificación

- Manual con los 4 perfiles.