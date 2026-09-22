# T056 — Validación de montos/nota/contraparte

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T055, T007, T008

## Objetivo

Validación estricta y compartida de inputs de transacción.

## Alcance

- `src/lib/validation/transaction.ts`:
  - `transactionSchema(currencyExponent)`: type enum, amount string → minor units (T007), counterparty ≤ 120 opcional, note ≤ 150 (opcional o requerido — decisión: opcional),
  - errores por campo.
- Usado en `createTransaction` y en el form (T073).

## Criterios de aceptación

- [ ] Monto incompatible con exponente de la moneda rechazado.
- [ ] Nota > 150 rechazada con mensaje de longitud.

## Tests

- `transaction-validation.test.ts`: decimales, límites, tipos.