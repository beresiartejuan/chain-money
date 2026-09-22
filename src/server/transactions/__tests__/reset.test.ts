import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { type Transaction, transactions } from "@/db/schema";
import { createBox } from "@/server/boxes/service";
import { NotFoundError, PermissionError } from "@/server/errors";
import {
  createTransaction,
  RESET_NOTE,
  resetBox,
} from "@/server/transactions/service";
import { insertAccess, insertUser, sumBalance } from "./helpers";

/**
 * T059 — `resetBox`: resetea el balance a 0 con UNA transacción `reset`,
 * dentro de una transacción de DB. El historial nunca se borra (el reset es
 * un evento más, con autor y timestamp), el balance se calcula con la misma
 * fórmula de T058, y el no-op con balance 0 (base de T060, idempotencia) no
 * inserta nada.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-box.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

describe("resetBox (T059)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("reset tras deposits y withdraws → balance total 0 con la tx reset en el historial", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "5.5",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "2.25",
    });
    // Balance previo: 1000 + 550 - 225 = 1325.
    await expect(sumBalance(db, box.id)).resolves.toBe(1325);

    const result = await resetBox(db, owner.id, box.id);

    expect(result.ok).toBe(true);
    expect(result.reset).toBe(true);
    expect(result.balanceMinor).toBe(0);

    // El balance TOTAL (todo el historial, incluida la tx reset) queda 0.
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(4);

    const resetTx = rows.find((row) => row.type === "reset") as
      | Transaction
      | undefined;
    expect(resetTx).toBeDefined();
    // La tx reset compensa el balance previo: amountMinor = -(1325).
    expect(resetTx?.amountMinor).toBe(-1325);
    expect(resetTx?.note).toBe(RESET_NOTE);
    expect(resetTx?.note).toBe("Reset de alcancía");
    expect(resetTx?.counterparty).toBeNull();
    expect(resetTx?.createdBy).toBe(owner.id);
  });

  it("la tx reset lleva amountMinor = -(balance previo) también con balance negativo (robustez, cf. T061)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset neg",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "2",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "2",
    });
    // Balance 0... y para forzar negativo, seed manual de un deposit
    // negativo directo (datos legacy, el service nunca lo genera).
    const { insertRawTransaction } = await import("./helpers");
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: -300,
      note: "legacy",
      createdBy: owner.id,
    });
    await expect(sumBalance(db, box.id)).resolves.toBe(-300);

    const result = await resetBox(db, owner.id, box.id);
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    const resetTx = rows.find((row) => row.type === "reset") as
      | Transaction
      | undefined;
    // -(balance previo) = -(-300) = 300, positivo: robusto.
    expect(resetTx?.amountMinor).toBe(300);
    expect(resetTx?.createdBy).toBe(owner.id);
  });

  it("balance ya en 0 → no inserta nada (no-op, base de T060)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset 0",
      currency: "USD",
    });

    const before = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(before).toHaveLength(0);

    const result = await resetBox(db, owner.id, box.id);

    expect(result).toEqual({ ok: true, reset: false, balanceMinor: 0 });

    const after = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(after).toHaveLength(0);
  });

  it("segundo reset seguido: el primero inserta, el segundo es no-op (sin ruido)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset x2",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "4",
    });

    const first = await resetBox(db, owner.id, box.id);
    expect(first.reset).toBe(true);

    const countAfterFirst = (
      await db.select().from(transactions).where(eq(transactions.boxId, box.id))
    ).length;
    expect(countAfterFirst).toBe(2); // deposit + reset

    const second = await resetBox(db, owner.id, box.id);
    expect(second.reset).toBe(false);
    expect(second.balanceMinor).toBe(0);

    const countAfterSecond = (
      await db.select().from(transactions).where(eq(transactions.boxId, box.id))
    ).length;
    expect(countAfterSecond).toBe(2); // sin filas nuevas
  });

  it("reset sobre box con reset previo: recalcula desde el historial completo", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset recursivo",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "8",
    });
    await resetBox(db, owner.id, box.id);

    // Tras el reset el balance es 0; un deposit nuevo hace el balance 3.
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "3",
    });
    const result = await resetBox(db, owner.id, box.id);
    expect(result.reset).toBe(true);
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    const secondReset = rows.filter((row) => row.type === "reset");
    expect(secondReset).toHaveLength(2);
    // El segundo reset compensa el balance previo (300), no el histórico.
    expect(secondReset[1]?.amountMinor).toBe(-300);
  });

  it("guest sin reset:box → PermissionError, sin insertar nada", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Shared",
      currency: "USD",
    });
    // Guest conocido pero solo con view: la box le es visible, el reset no.
    await insertAccess(db, box.id, guest.id, owner.id, '["view:transactions"]');
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "7",
    });

    await expect(resetBox(db, guest.id, box.id)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(PermissionError);
        expect((error as PermissionError).code).toBe("forbidden");
        return true;
      },
    );

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(1); // solo el deposit
    await expect(sumBalance(db, box.id)).resolves.toBe(700);
  });

  it("guest con reset:box → ok y la tx reset queda atribuida al guest", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Shared reset",
      currency: "USD",
    });
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["view:transactions","reset:box"]',
    );
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "9",
    });

    const result = await resetBox(db, guest.id, box.id);
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    const resetTx = rows.find((row) => row.type === "reset") as
      | Transaction
      | undefined;
    expect(resetTx?.createdBy).toBe(guest.id);
    expect(resetTx?.amountMinor).toBe(-900);
  });

  it("extraño sin relación → NotFoundError (nunca Forbidden)", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ajena",
      currency: "USD",
    });

    await expect(resetBox(db, stranger.id, box.id)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).code).toBe("not_found");
        return true;
      },
    );
  });

  it("box inexistente → NotFoundError (mismo code que el extraño)", async () => {
    const user = await insertUser(db);

    await expect(
      resetBox(db, user.id, "01999999-9999-7999-8999-999999999999"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
