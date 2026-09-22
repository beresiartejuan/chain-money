/**
 * Catálogo cerrado de monedas ISO 4217 soportadas por la app, con el
 * exponente decimal de cada una: la cantidad se guarda como enteros de la
 * menor denominación (`exponent` 2 → centavos, `exponent` 0 → unidades).
 *
 * El catálogo es cerrado: una moneda que no esté acá no se puede usar, ni
 * siquiera con un código ISO válido, hasta que se agregue explícitamente.
 */
export const CURRENCY_EXPONENTS = Object.freeze({
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  ARS: 2,
  BRL: 2,
  MXN: 2,
  UYU: 2,
  PEN: 2,
  BOB: 2,
  VES: 2,
  CLP: 0,
  JPY: 0,
  KRW: 0,
  COP: 0,
  PYG: 0,
} as const);

/** Unión de los códigos de moneda soportados (claves del catálogo). */
export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

/**
 * Indica si `code` es una moneda soportada.
 *
 * Decisión documentada: la validación es **case-sensitive**. Solo se aceptan
 * los códigos en mayúsculas del formato canónico ISO 4217; entradas como
 * `"usd"` o `"Usd"` se rechazan para no normalizar en silencio datos
 * guardados o recibidos.
 */
export function isSupportedCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCY_EXPONENTS, code);
}

/**
 * Devuelve el exponente decimal de `code`.
 *
 * Lanza un `Error` con mensaje claro si la moneda no está soportada.
 */
export function currencyExponent(code: string): number {
  if (!isSupportedCurrency(code)) {
    throw new Error(`Unsupported currency: "${code}"`);
  }

  return CURRENCY_EXPONENTS[code as CurrencyCode];
}
