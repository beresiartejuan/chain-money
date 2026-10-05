import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  parseTransactionAmount,
  type TransactionInput,
  transactionSchema,
} from "@/lib/validation/transaction";
import { ValidationError } from "@/server/errors";

/**
 * T056 — validación de montos/nota/contraparte. Sin DB: schemas puros. Los
 * casos cubren decimales según exponente, límites de longitud y tipos.
 */

/** Mensaje del primer issue del campo dado (o `undefined` si parsea ok). */
function fieldIssue(
  result: { success: false; error: z.ZodError } | { success: true },
  field: string,
): string | undefined {
  if (result.success) {
    return undefined;
  }
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("transactionSchema (exponent 2, ej. USD/EUR)", () => {
  const schema = transactionSchema(2);

  it("acepta un deposit válido y transforma el amount a minor units", () => {
    const result = schema.safeParse({
      type: "deposit",
      amount: "12.34",
      counterparty: "Ana",
      note: "Aporte de marzo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: TransactionInput = result.data;
      expect(data.type).toBe("deposit");
      expect(data.amount).toBe(1234);
      expect(data.counterparty).toBe("Ana");
      expect(data.note).toBe("Aporte de marzo");
    }
  });

  it("acepta un withdraw válido con solo el monto", () => {
    const result = schema.safeParse({ type: "withdraw", amount: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1000);
      expect(result.data.counterparty).toBeUndefined();
      expect(result.data.note).toBeUndefined();
    }
  });

  it('acepta "12.3" (menos decimales que el exponente) y rellena con ceros', () => {
    const result = schema.safeParse({ type: "deposit", amount: "12.3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1230);
    }
  });

  it('rechaza "12.345" (3 decimales > exponent 2) con issue en amount', () => {
    const result = schema.safeParse({ type: "deposit", amount: "12.345" });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "amount")).toMatch(/hasta 2 decimales/);
  });

  it("rechaza cero y negativos con issue en amount", () => {
    const zero = schema.safeParse({ type: "deposit", amount: "0" });
    expect(zero.success).toBe(false);
    expect(fieldIssue(zero, "amount")).toMatch(/mayor que cero/);

    for (const negative of ["-12.34", "-5"]) {
      const result = schema.safeParse({ type: "deposit", amount: negative });
      expect(result.success).toBe(false);
      expect(fieldIssue(result, "amount")).toMatch(/número positivo/);
    }
  });

  it("rechaza formatos no numéricos con issue en amount", () => {
    for (const bad of ["abc", "12,34", "12.34.56", "", "  ", "1e5"]) {
      const result = schema.safeParse({ type: "deposit", amount: bad });
      expect(result.success).toBe(false);
      expect(fieldIssue(result, "amount")).toBeDefined();
    }
  });

  it("rechaza type fuera del enum ('transfer', vacío, faltante)", () => {
    for (const bad of ["transfer", "reset", "", undefined]) {
      const result = schema.safeParse({ type: bad, amount: "12.34" });
      expect(result.success).toBe(false);
      expect(fieldIssue(result, "type")).toMatch(/deposit o withdraw/);
    }
  });

  it("rechaza note de 151 caracteres y acepta 150 (tras trim)", () => {
    const long = schema.safeParse({
      type: "deposit",
      amount: "1",
      note: "a".repeat(151),
    });
    expect(long.success).toBe(false);
    expect(fieldIssue(long, "note")).toMatch(/150 caracteres/);

    const ok = schema.safeParse({
      type: "deposit",
      amount: "1",
      note: "a".repeat(150),
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.note).toHaveLength(150);
    }
  });

  it("rechaza counterparty de 121 caracteres y acepta 120 (tras trim)", () => {
    const long = schema.safeParse({
      type: "deposit",
      amount: "1",
      counterparty: "a".repeat(121),
    });
    expect(long.success).toBe(false);
    expect(fieldIssue(long, "counterparty")).toMatch(/120 caracteres/);

    const ok = schema.safeParse({
      type: "deposit",
      amount: "1",
      counterparty: "a".repeat(120),
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.counterparty).toHaveLength(120);
    }
  });

  it("hace trim de counterparty y note antes de guardar", () => {
    const result = schema.safeParse({
      type: "deposit",
      amount: "1",
      counterparty: "  Ana  ",
      note: "  Nota con espacios  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.counterparty).toBe("Ana");
      expect(result.data.note).toBe("Nota con espacios");
    }
  });

  it("descarta llaves desconocidas (createdBy no influye en la atribución)", () => {
    const result = schema.safeParse({
      type: "deposit",
      amount: "1",
      createdBy: "attacker-id",
      createdAt: 12345,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: "deposit", amount: 100 });
    }
  });
});

describe("transactionSchema (exponent 0, ej. CLP/JPY)", () => {
  const schema = transactionSchema(0);

  it('acepta "12" (sin decimales) y lo deja como minor directo', () => {
    const result = schema.safeParse({ type: "deposit", amount: "12" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(12);
    }
  });

  it("rechaza montos que exceden el rago seguro con message amigable", () => {
    // parseAmountToMinorUnits lanza con BigInt > MAX_SAFE_INTEGER; el guard
    // lo convierte en "El monto es demasiado grande." (nunca un crash raro
    // de BigInt en la UI).
    const schema2 = transactionSchema(2);
    const result = schema2.safeParse({
      type: "deposit",
      amount: "99999999999999999", // 17 dígitos: minor > 2^53
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result as never, "amount")).toBe(
      "El monto es demasiado grande.",
    );
  });

  it('rechaza "12.5" (decimales con exponent 0) con issue en amount', () => {
    const result = schema.safeParse({ type: "deposit", amount: "12.5" });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "amount")).toMatch(/no admite decimales/);
  });

  it('rechaza "12.34" (2 decimales con exponent 0) con issue en amount', () => {
    const result = schema.safeParse({ type: "deposit", amount: "12.34" });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "amount")).toMatch(/no admite decimales/);
  });
});

describe("parseTransactionAmount", () => {
  it("devuelve el minor para un monto válido según el exponente", () => {
    expect(parseTransactionAmount("12.34", 2)).toBe(1234);
    expect(parseTransactionAmount("12", 2)).toBe(1200);
    expect(parseTransactionAmount("12", 0)).toBe(12);
  });

  it("lanza ValidationError con fieldErrors.amount ante entrada inválida", () => {
    for (const [input, exponent] of [
      ["12.345", 2],
      ["12.5", 0],
      ["0", 2],
      ["-3", 2],
      ["abc", 2],
      ["", 2],
    ] as const) {
      try {
        parseTransactionAmount(input, exponent);
        expect.unreachable(`Debía lanzar con ${JSON.stringify(input)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.code).toBe("validation");
        expect(ve.fieldErrors.amount).toBeDefined();
        expect(ve.fieldErrors.amount?.length).toBeGreaterThan(0);
      }
    }
  });
});
