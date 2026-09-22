import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { type Transaction, transactions } from "@/db/schema";
import { createBox } from "@/server/boxes/service";
import {
  createTransaction,
  RESET_NOTE,
  resetBox,
} from "@/server/transactions/service";
import { insertRawTransaction, insertUser, sumBalance } from "./helpers";

/**
 * T061 — robustez del reset ante balance negativo. Con
 * `ALLOW_NEGATIVE_BALANCE = false` la regla de `createTransaction` (T058)
 * impide que un withdraw deje el balance bajo cero, pero `resetBox` debe ser
 * robusto ante datos legacy: se siembra el balance negativo INSERTANDO
 * DIRECTO en la tabla (bypassing el service), y el reset tiene que
 * compensarlo con UNA transacción `reset` cuyo `amountMinor = -balance`
 * (positivo en este caso) que lleva el balance total a 0.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `reset.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

describe("resetBox con balance negativo (T061)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("deposit 300 + withdraw 800 (insertado directo) → balance -500 → reset lo lleva a 0 con amountMinor +500", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset negativo",
      currency: "USD",
    });

    // Deposit por el service (300 minor units).
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 300,
      note: "deposit legacy",
      createdBy: owner.id,
    });
    // Withdraw directo por ORM (bypassing el service y su regla de balance):
    // 300 - 800 = -500. El service jamás produce este estado.
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "withdraw",
      amountMinor: 800,
      note: "withdraw legacy",
      createdBy: owner.id,
    });
    await expect(sumBalance(db, box.id)).resolves.toBe(-500);

    const result = await resetBox(db, owner.id, box.id);

    // El reset compensa el balance negativo: balanceMinor vuelve a 0.
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(3); // deposit + withdraw legacy + reset

    const resetTx = rows.find((row) => row.type === "reset") as
      | Transaction
      | undefined;
    expect(resetTx).toBeDefined();
    // -(balance previo) = -(-500) = +500: positivo, robusto.
    expect(resetTx?.amountMinor).toBe(500);
    expect(resetTx?.type).toBe("reset");
    expect(resetTx?.note).toBe(RESET_NOTE);
    expect(resetTx?.createdBy).toBe(owner.id);

    // La fórmula del balance (SUM CASE) deja el total en 0.
    await expect(sumBalance(db, box.id)).resolves.toBe(0);
  });

  it("balance negativo sin deposits previos (solo withdraw legacy directo) → reset también lo compensa", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset negativo puro",
      currency: "USD",
    });

    await insertRawTransaction(db, {
      boxId: box.id,
      type: "withdraw",
      amountMinor: 250,
      note: "legacy puro",
      createdBy: owner.id,
    });
    await expect(sumBalance(db, box.id)).resolves.toBe(-250);

    const result = await resetBox(db, owner.id, box.id);
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    const resetTx = rows.find((row) => row.type === "reset") as
      | Transaction
      | undefined;
    expect(resetTx?.amountMinor).toBe(250);
    await expect(sumBalance(db, box.id)).resolves.toBe(0);
  });

  it("reset tras balance negativo: el historial queda intacto y un deposit posterior vuelve a operar normal", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset negativo continuo",
      currency: "USD",
    });
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 100,
      note: "deposit legacy",
      createdBy: owner.id,
    });
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "withdraw",
      amountMinor: 400,
      note: "withdraw legacy",
      createdBy: owner.id,
    });
    // Balance: -300.
    const result = await resetBox(db, owner.id, box.id);
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    // El historial quedó intacto: 2 legacy + 1 reset, nada borrado.
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(3);

    // La box vuelve a un estado consistente: el service sigue operando con
    // la regla de balance normal. Un withdraw que excede → rechazado; con
    // deposit previo → permitido.
    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "1",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("insufficient_funds");
      return true;
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "4",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "1.5",
    });
    await expect(sumBalance(db, box.id)).resolves.toBe(250);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
