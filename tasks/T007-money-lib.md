# T007 — Dinero en unidades menores (`src/lib/money.ts`)

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Montos como enteros en unidades menores (cents). Cero floats en el dominio del dinero.

## Alcance

- `parseAmountToMinorUnits(input: string, exponent: number): number` — valida decimales según exponente; rechaza negativos, cero, NaN, exceso de decimales.
- `formatFromMinorUnits(minor: number, exponent: number): string`.

## Criterios de aceptación

- [ ] `parseAmountToMinorUnits("12.34", 2) === 1234`.
- [ ] `parseAmountToMinorUnits("12.345", 2)` lanza error.
- [ ] `parseAmountToMinorUnits("0.00", 2)` y negativos lanzan error.
- [ ] `formatFromMinorUnits(1234, 2) === "12.34"`.

## Tests

- `money.test.ts`: casos válidos/inválidos, exponente 0, límite de decimales.