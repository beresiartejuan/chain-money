/**
 * Dinero como enteros en unidades menores (ej. cents).
 * Cero floats en el dominio del dinero.
 */

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Convierte un monto decimal (ej. "12.34") a unidades menores (1234).
 *
 * Reglas:
 * - Solo strings decimales positivas (sin signo).
 * - Rechaza cero, NaN, strings no numéricas.
 * - Rechaza más decimales que `exponent`.
 * - "12" sin decimales también es válido (se rellena con ceros).
 */
export function parseAmountToMinorUnits(
  input: string,
  exponent: number,
): number {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(
      `Exponent must be a non-negative integer, got: ${exponent}`,
    );
  }
  if (!DECIMAL_PATTERN.test(input)) {
    throw new Error(`Invalid amount format: ${JSON.stringify(input)}`);
  }

  const [intPart, decPart = ""] = input.split(".");

  if (decPart.length > exponent) {
    throw new Error(
      `Amount ${input} has more than ${exponent} decimal(s) for exponent ${exponent}`,
    );
  }

  const intDigits = intPart.replace(/^0+(?=\d)/, "");
  const paddedDecimals = decPart.padEnd(exponent, "0");
  const raw = BigInt(`${intDigits}${paddedDecimals}`);

  if (raw === BigInt(0)) {
    throw new Error(`Amount must be greater than zero, got: ${input}`);
  }
  if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Amount ${input} exceeds the safe integer range`);
  }

  return Number(raw);
}

/**
 * Convierte unidades menores (1234) a string decimal (12.34).
 */
export function formatFromMinorUnits(minor: number, exponent: number): string {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new Error(
      `Minor units must be a non-negative integer, got: ${minor}`,
    );
  }
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(
      `Exponent must be a non-negative integer, got: ${exponent}`,
    );
  }

  if (exponent === 0) {
    return String(minor);
  }

  const s = String(minor).padStart(exponent + 1, "0");
  const cut = s.length - exponent;
  return `${s.slice(0, cut)}.${s.slice(cut)}`;
}
