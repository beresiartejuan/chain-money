# T060 — Reset idempotente con balance 0

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T059

## Objetivo

Reset sobre alcancía ya en 0 no crea ruido.

## Alcance

- En `resetBox`: si balance === 0 → devolver `{ ok: true, reset: false }` sin insertar nada.
- UI (T075) puede mostrar "ya está en cero".

## Criterios de aceptación

- [ ] Reset con balance 0 no crea transacción.
- [ ] Segundo reset seguido es no-op.

## Tests

- `reset-idempotent.test.ts`: no-op verificando count de filas.