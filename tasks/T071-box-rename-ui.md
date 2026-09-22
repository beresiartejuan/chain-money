# T071 — Renombrar alcancía en UI (solo owner)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T069, T045

## Objetivo

Edición de nombre solo para dueños.

## Alcance

- Acción "renombrar" en la card (solo si `isOwner`),
- modal con validación 1–80,
- guest no ve la acción.

## Criterios de aceptación

- [ ] Owner renombra y la lista refleja el cambio.
- [ ] Guest no ve la opción.

## Verificación

- Manual con usuario owner y guest.