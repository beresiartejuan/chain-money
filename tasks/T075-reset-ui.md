# T075 — Botón Reset con confirmación (solo con permiso)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T072, T059

## Objetivo

Reset consciente: confirmación explícita del balance que se anula.

## Alcance

- Botón "Reset" (solo con `reset:box`):
  - modal de confirmación mostrando balance actual que va a anularse ("van a quedar en 0"),
  - al confirmar llama `resetBox`, refresca,
  - si ya está en 0: muestra "ya está en cero" (idempotente T060).

## Criterios de aceptación

- [ ] Reset con confirmación deja balance 0 y agrega la transacción al historial.
- [ ] Sin permiso el botón no existe.
- [ ] Balance 0 → mensaje no-op.

## Verificación

- Manual.