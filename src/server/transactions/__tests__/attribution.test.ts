import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { type Transaction, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createBox } from "@/server/boxes/service";
import { createTransaction } from "@/server/transactions/service";
import { insertUser } from "./helpers";

/**
 * T057 — atribución forzada: el cliente nunca puede mentir sobre quién hizo
 * la transacción ni cuándo. El service ignora `createdBy`/`createdAt` del
 * input (el schema de validación los strippea como llaves desconocidas) y
 * fija `createdBy` con el userId autenticado; `createdAt` sale del
 * `$defaultFn` del schema (server time). Acá se aserta el RESULTADO final
 * en la fila persistida, no el mecanismo: aunque el schema deje de
 * strippear, el insert reconstruye el objeto campo por campo y no tiene de
 * dónde tomar un `createdBy` del input.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-box.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

describe("createTransaction — atribución forzada (T057)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("input con createdBy ajeno + createdAt 0 → fila con el usuario autenticado y createdAt de server", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib",
      currency: "USD",
    });
    const attacker = await insertUser(db);

    const before = Date.now();
    const tx = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "12.34",
      // Spoofing: el input intenta atribuir la transacción a otro usuario y
      // backdatearla al epoch. El cast reproduce un payload crudo de cliente
      // (campos extra que el type estricto del input no declara).
      createdBy: attacker.id,
      createdAt: 0,
    } as Parameters<typeof createTransaction>[3]);
    const after = Date.now();

    // Resultado final del service (no del mecanismo): el autor es el usuario
    // autenticado y la fecha es de server, dentro de la ventana [before, after].
    expect(tx.createdBy).toBe(owner.id);
    expect(tx.createdBy).not.toBe(attacker.id);
    expect(tx.createdAt).toBeGreaterThanOrEqual(before);
    expect(tx.createdAt).toBeLessThanOrEqual(after);
    expect(tx.createdAt).not.toBe(0);

    // La fila PERSISTIDA dice lo mismo que la fila devuelta.
    const stored = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx.id))
      .limit(1);
    expect(stored).toHaveLength(1);
    const saved = stored[0] as Transaction;
    expect(saved.createdBy).toBe(owner.id);
    expect(saved.createdAt).toBeGreaterThanOrEqual(before);
    expect(saved.createdAt).toBeLessThanOrEqual(after);
  });

  it("withdraw con spoofing de createdBy: mismo resultado (el service nunca acepta esos campos)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib W",
      currency: "USD",
    });
    const attacker = await insertUser(db);

    // Seed de un deposit para que el withdraw (regla de T058) tenga balance.
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "5",
    });

    const tx = await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "1",
      createdBy: attacker.id,
      createdAt: 1234567890,
    } as Parameters<typeof createTransaction>[3]);

    expect(tx.createdBy).toBe(owner.id);
    expect(tx.createdAt).not.toBe(1234567890);

    const stored = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(stored).toHaveLength(2); // seed deposit + withdraw
    expect(stored[0]?.createdBy).toBe(owner.id);
    expect(stored[0]?.createdAt).toBeGreaterThan(1234567890);
  });

  it("guest con create: la atribución usa al guest autenticado aunque el input diga otra cosa", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const attacker = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib Guest",
      currency: "USD",
    });
    const { insertAccess } = await import("./helpers");
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["view:transactions","create:transactions"]',
    );

    const tx = await createTransaction(db, guest.id, box.id, {
      type: "deposit",
      amount: "5",
      createdBy: attacker.id,
      createdAt: 0,
    } as Parameters<typeof createTransaction>[3]);

    expect(tx.createdBy).toBe(guest.id);
    expect(tx.createdAt).not.toBe(0);
  });

  it("dos transacciones nunca comparten createdAt exacto ni cambian con relectura", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib Ts",
      currency: "USD",
    });

    const first = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "1",
    });
    const second = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "2",
    });

    // Cada insert recibe su propio server time (no hay backdate posible).
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt);

    // Relectura desde la DB: los campos de atribución son los mismos.
    const reread = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, first.id))
      .limit(1);
    expect(reread[0]?.createdBy).toBe(first.createdBy);
    expect(reread[0]?.createdAt).toBe(first.createdAt);
  });

  it("los ids siguen siendo server-side: un input con id ajeno no cambia el generado", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib Id",
      currency: "USD",
    });

    const tx = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "3",
      id: newId(),
    } as Parameters<typeof createTransaction>[3]);

    // El id devuelto es el que el service generó, no el del input (el objeto
    // insertado se reconstruye campo por campo en el service).
    const stored = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(tx.id);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
