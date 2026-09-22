# T061 — Reset con balance negativo

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T059

## Objetivo

Balance negativo también vuelve a 0 correctamente.

## Alcance

- Con `ALLOW_NEGATIVE_BALANCE = false` esto no debería ocurrir por la regla T058; pero el reset debe ser robusto: si el balance es negativo (por datos legacy o config), la transacción `reset` tiene `amountMinor = -balance` (positivo) y lleva a 0.
- Test de robustez insertando balance negativo directamente en DB.

## Criterios de aceptación

- [ ] Reset sobre balance negativo deja balance 0.
- [ ] La transacción reset tiene amountMinor positivo en ese caso.

## Tests

- `reset-negative.test.ts`: robustez.