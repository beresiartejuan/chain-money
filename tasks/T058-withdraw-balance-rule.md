# T058 — Regla `insufficient_funds` en withdrawals

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T055

## Objetivo

No permitir extraer más que el balance actual (decisión default del producto).

## Alcance

- En `createTransaction` (type withdraw), dentro de transacción de DB:
  - `SELECT SUM(amountMinor) FROM transactions WHERE boxId = ?` (deposit +, withdraw −, reset suma su valor — por construcción lleva a 0),
  - si `balance - amount < 0` → `InsufficientFundsError` (código `insufficient_funds`),
  - constante `ALLOW_NEGATIVE_BALANCE = false` en un módulo de config de dominio.

## Criterios de aceptación

- [ ] Withdraw mayor al balance rechazado con código `insufficient_funds`.
- [ ] Withdraw justo al balance OK (balance 0).
- [ ] Race: dos withdrawals simultáneos que juntos exceden el balance → solo uno pasa.

## Tests

- `withdraw-rule.test.ts`: rechazo, edge exacto, carrera.