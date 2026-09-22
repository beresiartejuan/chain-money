# T065 — Módulo puro de caché de balance

- **Fase:** 7 · Sync
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Lógica de balance incremental, 100% testable sin DB ni UI.

## Alcance

- `src/lib/client/balance-cache.ts`:
  - `BalanceState { cursor: string | null; balanceMinor: number; transactionCount: number; updatedAt: number }`.
  - `emptyState(): BalanceState`.
  - `applyTransactions(state, txs): BalanceState` — deposit suma, withdraw resta, reset suma su amountMinor (por construcción lleva a 0),
  - `nextCursor(state, response)`.

## Criterios de aceptación

- [ ] Secuencia deposit+withdraw+reset produce el balance esperado.
- [ ] Deltas vacíos no cambian el estado (mismo objeto permitido).
- [ ] Orden de aplicación no afecta el resultado final (conmutativo para el total).

## Tests

- `balance-cache.test.ts`: secuencia completa, delta vacío, conmutatividad.