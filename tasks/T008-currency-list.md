# T008 — Lista de monedas y exponentes ISO 4217

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Catálogo cerrado de monedas soportadas con su exponente decimal.

## Alcance

- En `src/lib/money.ts` (o `src/lib/currency.ts`):
  - `CURRENCY_EXPONENTS` (USD=2, EUR=2, ARS=2, BRL=2, MXN=2, CLP=0, JPY=0, KRW=0, COP=0, UYU=2, PEN=2, BOB=2, PYG=0, VES=2, GBP=2, CHF=2, CAD=2, AUD=2...).
  - `isSupportedCurrency(code: string): boolean`.
  - `currencyExponent(code: string): number` (lanza si no soportada).

## Criterios de aceptación

- [ ] `isSupportedCurrency("USD") === true`, `isSupportedCurrency("usd")` decide y documenta (sugerido: false, case-sensitive).
- [ ] Monedas de exponente 0 rechazan decimales en parse.

## Tests

- `currency.test.ts`: soportadas, no soportadas, exponentes correctos.