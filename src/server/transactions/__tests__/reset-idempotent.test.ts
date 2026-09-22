import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { transactions } from "@/db/schema";
import { createBox } from "@/server/boxes/service";
import { createTransaction, resetBox } from "@/server/transactions/service";
import { insertUser, sumBalance } from "./helpers";

/**
 * T060 — idempotencia del reset sobre balance 0: `resetBox` NO inserta
 * ninguna transacción cuando el balance ya es 0 (devuelve
 * `{ ok, reset: false, balanceMinor: 0 }`), así que resets repetidos no
 * generan ruido en el historial.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `reset.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

/** Cuenta las filas de transacciones de la box `boxId`. */
async function countTransactions(
  db: Parameters<typeof createBox>[0],
  boxId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.boxId, boxId));
  return rows.length;
}

describe("resetBox idempotente con balance 0 (T060)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("box nueva (balance 0) → reset NO inserta (count 0 antes y después), reset: false", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset idem 0",
      currency: "USD",
    });

    const before = await countTransactions(db, box.id);
    expect(before).toBe(0);

    const result = await resetBox(db, owner.id, box.id);

    expect(result).toEqual({ ok: true, reset: false, balanceMinor: 0 });
    expect(await countTransactions(db, box.id)).toBe(before);
    // El balance total sigue en 0 (nada cambió).
    await expect(sumBalance(db, box.id)).resolves.toBe(0);
  });

  it("deposit 500 → reset inserta (reset: true) → segundo reset NO inserta (count estable), reset: false", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset idem doble",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "5",
    }); // 500 minor units

    const first = await resetBox(db, owner.id, box.id);
    expect(first).toEqual({ ok: true, reset: true, balanceMinor: 0 });
    // El primer reset inserta: deposit + reset = 2 filas.
    const countAfterFirst = await countTransactions(db, box.id);
    expect(countAfterFirst).toBe(2);

    // Segundo reset sobre balance 0: no-op.
    const second = await resetBox(db, owner.id, box.id);
    expect(second).toEqual({ ok: true, reset: false, balanceMinor: 0 });
    // El historial queda estable: ninguna fila nueva.
    expect(await countTransactions(db, box.id)).toBe(countAfterFirst);
    // Y el balance total sigue 0.
    await expect(sumBalance(db, box.id)).resolves.toBe(0);
  });

  it("tercer reset consecutivo: sigue sin insertar (idempotencia estable)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Reset idem x3",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "2",
    });
    await resetBox(db, owner.id, box.id);
    const countAfterFirst = await countTransactions(db, box.id);
    expect(countAfterFirst).toBe(2); // deposit + reset

    await resetBox(db, owner.id, box.id);
    await resetBox(db, owner.id, box.id);

    expect(await countTransactions(db, box.id)).toBe(countAfterFirst);
    await expect(sumBalance(db, box.id)).resolves.toBe(0);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
