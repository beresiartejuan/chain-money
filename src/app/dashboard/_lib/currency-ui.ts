import { CURRENCY_EXPONENTS, type CurrencyCode } from "@/lib/currency";

/**
 * Nombres legibles (español rioplatense) para el catálogo cerrado de
 * monedas. Solo se usan en UI: el dominio sigue comparando códigos ISO
 * (`CURRENCY_EXPONENTS`). Un código del catálogo sin nombre acá cae en el
 * código mismo, de modo que agregar una moneda al catálogo nunca rompe el
 * select (muestra el código hasta que se le pone nombre).
 */
const CURRENCY_LABELS: Partial<Record<CurrencyCode, string>> = {
  USD: "Dólar estadounidense",
  EUR: "Euro",
  GBP: "Libra esterlina",
  CHF: "Franco suizo",
  CAD: "Dólar canadiense",
  AUD: "Dólar australiano",
  ARS: "Peso argentino",
  BRL: "Real brasileño",
  MXN: "Peso mexicano",
  UYU: "Peso uruguayo",
  PEN: "Sol peruano",
  BOB: "Boliviano",
  VES: "Bolívar venezolano",
  CLP: "Peso chileno",
  JPY: "Yen japonés",
  KRW: "Won surcoreano",
  COP: "Peso colombiano",
  PYG: "Guaraní paraguayo",
};

/** Opciones del select de moneda: códigos soportados con nombre legible. */
export function currencyOptions(): Array<{ value: string; label: string }> {
  return (Object.keys(CURRENCY_EXPONENTS) as CurrencyCode[]).map((code) => ({
    value: code,
    label: CURRENCY_LABELS[code] ?? code,
  }));
}
