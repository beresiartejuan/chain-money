import { z } from "zod";
import { parseAmountToMinorUnits } from "@/lib/money";
import { ValidationError } from "@/server/errors";

/**
 * Validación compartida de inputs de transacción (T056): la usa el service
 * de `createTransaction` (T055) y la usará el form de la alcancía (T073).
 * Los mensajes están en español y cada issue apunta al campo que lo originó.
 */

/** Longitud máxima de la contraparte (se valida sobre el valor con trim). */
export const COUNTERPARTY_MAX_LENGTH = 120;

/** Longitud máxima de la nota (se valida sobre el valor con trim). */
export const NOTE_MAX_LENGTH = 150;

/**
 * Formato aceptado para el monto: dígitos con punto decimal opcional.
 * Replica el patrón de `@/lib/money` para poder clasificar el rechazo con
 * mensajes propios por campo antes de delegar la conversión.
 */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/** Resultado interno del parseo estricto del monto. */
type AmountParseResult =
  | { ok: true; minor: number }
  | { ok: false; message: string };

/**
 * Parsea el monto con mensajes de error por campo en español. Chequea
 * formato, decimales según el exponente y cero con lógica propia (sin
 * acoplarse a los mensajes internos de `@/lib/money`) y delega la conversión
 * final a `parseAmountToMinorUnits`. Tras esos chequeos, el único error
 * restante posible es exceder el rango safe-integer.
 */
function parseAmountStrict(input: string, exponent: number): AmountParseResult {
  if (!DECIMAL_PATTERN.test(input)) {
    return {
      ok: false,
      message: "El monto debe ser un número positivo, por ejemplo 12.34.",
    };
  }

  const dotIndex = input.indexOf(".");
  const decimals = dotIndex === -1 ? 0 : input.length - dotIndex - 1;
  if (decimals > exponent) {
    return {
      ok: false,
      message:
        exponent === 0
          ? "La moneda no admite decimales: ingresá un monto entero."
          : `El monto puede tener hasta ${exponent} decimales para esta moneda.`,
    };
  }

  if (Number(input) === 0) {
    return { ok: false, message: "El monto debe ser mayor que cero." };
  }

  try {
    return { ok: true, minor: parseAmountToMinorUnits(input, exponent) };
  } catch {
    return { ok: false, message: "El monto es demasiado grande." };
  }
}

/**
 * Convierte un monto decimal (ej. "12.34") a unidades menores para el
 * exponente dado. Es la misma validación que aplica `transactionSchema`
 * sobre el campo `amount`, pero como función directa: lanza
 * `ValidationError` con `fieldErrors.amount` si la entrada no es aceptable
 * (formato, decimales de más, cero o negativo).
 */
export function parseTransactionAmount(
  input: string,
  exponent: number,
): number {
  const result = parseAmountStrict(input, exponent);
  if (!result.ok) {
    throw new ValidationError({ amount: [result.message] });
  }
  return result.minor;
}

/**
 * Schema del campo `amount`: entra un string decimal y sale el monto en
 * unidades menores (`"12.34"` con exponent 2 → `1234`). La validación usa
 * `.superRefine()` (mismo patrón que la política de password en
 * `@/lib/validation/auth.ts`) para emitir el mensaje exacto por campo, y el
 * `.transform()` devuelve el minor.
 */
function amountSchema(currencyExponent: number) {
  return z
    .string({ error: "El monto es obligatorio." })
    .min(1, { error: "El monto es obligatorio." })
    .superRefine((value: string, ctx: z.core.$RefinementCtx<string>) => {
      const result = parseAmountStrict(value, currencyExponent);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.message });
      }
    })
    .transform((value: string) => {
      const result = parseAmountStrict(value, currencyExponent);
      if (!result.ok) {
        // Inalcanzable: superRefine validó con la misma función; el guard
        // evita acoplar el transform a ese detalle.
        throw new Error("Amount transform ran after failed validation");
      }
      return result.minor;
    });
}

/**
 * Schema de un movimiento (deposit/withdraw) para una moneda con el
 * exponente decimal dado. Factory a propósito: el exponente depende de la
 * alcancía (`currencyExponent(box.currency)`), así que el caller arma su
 * schema por moneda.
 *
 * - `type`: solo deposit o withdraw (reset no es un input de usuario).
 * - `amount`: string decimal → minor units (ver `parseTransactionAmount`).
 * - `counterparty`: opcional, ≤ 120 tras trim.
 * - `note`: opcional, ≤ 150 tras trim.
 * - Llaves desconocidas se descartan (strip), así que un input con
 *   `createdBy` u otros campos extra no influye en la atribución.
 */
export function transactionSchema(currencyExponent: number) {
  return z.object({
    type: z.enum(["deposit", "withdraw"], {
      error: "El tipo de movimiento debe ser deposit o withdraw.",
    }),
    amount: amountSchema(currencyExponent),
    counterparty: z
      .string({ error: "La contraparte debe ser texto." })
      .trim()
      .max(COUNTERPARTY_MAX_LENGTH, {
        error: `La contraparte no puede tener más de ${COUNTERPARTY_MAX_LENGTH} caracteres.`,
      })
      .optional(),
    note: z
      .string({ error: "La nota debe ser texto." })
      .trim()
      .max(NOTE_MAX_LENGTH, {
        error: `La nota no puede tener más de ${NOTE_MAX_LENGTH} caracteres.`,
      })
      .optional(),
  });
}

/** Input ya validado y transformado (amount en minor units). */
export type TransactionInput = z.infer<ReturnType<typeof transactionSchema>>;
