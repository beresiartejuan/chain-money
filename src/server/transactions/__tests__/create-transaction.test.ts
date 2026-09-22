import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import {
  boxAccess,
  boxTokens,
  type Transaction,
  transactions,
  users,
} from "@/db/schema";
import { isUuidV7, newId } from "@/lib/ids";
import { createBox } from "@/server/boxes/service";
import {
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import { createTransaction } from "@/server/transactions/service";

/**
 * T055 — creación de transacciones contra DB real (SQLite temporal con las
 * migraciones de `drizzle/`). El service es puro respecto al request: recibe
 * la db y el userId, así que se testa directo; la capa de sesión vive en
 * `actions.ts`/`session.ts` y no se cubre acá.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-box.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

const VALID_DEPOSIT = { type: "deposit", amount: "12.34" } as const;

/**
 * Usuario seed con email único. Devuelve el user insertado para que cada
 * test trabaje contra SU propio owner (sin compartir estado entre tests).
 */
async function insertUser(
  db: Parameters<typeof createTransaction>[0],
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: `seed-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
      name: "Seed",
    })
    .returning();
  const user = inserted[0];
  if (!user) {
    throw new Error("Failed to insert seed user");
  }
  return { id: user.id };
}

/** Fila de `box_tokens` (FK obligatoria de `box_access`). */
async function insertToken(
  db: Parameters<typeof createTransaction>[0],
  boxId: string,
  ownerId: string,
  permissions: string,
): Promise<{ id: string }> {
  const id = newId();
  await db.insert(boxTokens).values({
    id,
    boxId,
    tokenHash: `token-hash-${id}`,
    tokenPrefix: id.slice(0, 8),
    permissions,
    status: "redeemed",
    createdBy: ownerId,
  });
  return { id };
}

/** Fila de `box_access` sobre `boxId` para `userId` (via token del owner). */
async function insertAccess(
  db: Parameters<typeof createTransaction>[0],
  boxId: string,
  userId: string,
  ownerId: string,
  permissions: string,
): Promise<void> {
  const token = await insertToken(db, boxId, ownerId, permissions);
  await db.insert(boxAccess).values({
    id: newId(),
    boxId,
    userId,
    tokenId: token.id,
    permissions,
  });
}

describe("createTransaction (T055)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("happy path deposit: inserta con minor units, autor y createdAt del server", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Vacaciones",
      currency: "USD",
    });

    const before = Date.now();
    const tx = await createTransaction(db, owner.id, box.id, {
      ...VALID_DEPOSIT,
    });

    expect(isUuidV7(tx.id)).toBe(true);
    expect(tx.boxId).toBe(box.id);
    expect(tx.type).toBe("deposit");
    expect(tx.amountMinor).toBe(1234);
    expect(tx.counterparty).toBeNull();
    expect(tx.note).toBe("");
    expect(tx.createdBy).toBe(owner.id);
    expect(tx.createdAt).toBeGreaterThanOrEqual(before);

    const stored = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx.id))
      .limit(1);
    expect(stored).toHaveLength(1);
    const saved = stored[0] as Transaction;
    expect(saved.amountMinor).toBe(1234);
    expect(saved.createdBy).toBe(owner.id);
  });

  it("happy path withdraw con counterparty y note (trim incluido)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Gastos",
      currency: "EUR",
    });
    // La regla de balance de T058 exige balance suficiente para withdraw.
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    const tx = await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "5",
      counterparty: "  Kiosco Pepe  ",
      note: "  Salida del viernes  ",
    });

    expect(tx.type).toBe("withdraw");
    expect(tx.amountMinor).toBe(500);
    expect(tx.counterparty).toBe("Kiosco Pepe");
    expect(tx.note).toBe("Salida del viernes");
    expect(tx.createdBy).toBe(owner.id);
  });

  it("respeta el exponente de la moneda de la box (CLP, exponent 0)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Pesos",
      currency: "CLP",
    });

    const tx = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "12",
    });
    expect(tx.amountMinor).toBe(12);

    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "deposit",
        amount: "12.5",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fieldErrors.amount).toBeDefined();
      return true;
    });
  });

  it("guest con view solamente → PermissionError (forbidden), sin insertar", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Shared",
      currency: "USD",
    });
    await insertAccess(db, box.id, guest.id, owner.id, '["view:transactions"]');

    await expect(
      createTransaction(db, guest.id, box.id, { ...VALID_DEPOSIT }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PermissionError);
      expect((error as PermissionError).code).toBe("forbidden");
      return true;
    });

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(0);
  });

  it("guest con create → OK y atribución al guest", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Shared",
      currency: "USD",
    });
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["view:transactions","create:transactions"]',
    );

    const tx = await createTransaction(db, guest.id, box.id, {
      ...VALID_DEPOSIT,
      note: "Aporte del guest",
    });

    expect(tx.createdBy).toBe(guest.id);
    expect(tx.note).toBe("Aporte del guest");
  });

  it("extraño sin relación → NotFoundError (nunca Forbidden)", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ajena",
      currency: "USD",
    });

    await expect(
      createTransaction(db, stranger.id, box.id, { ...VALID_DEPOSIT }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("not_found");
      return true;
    });
  });

  it("box inexistente → NotFoundError (mismo code que el extraño)", async () => {
    const user = await insertUser(db);

    await expect(
      createTransaction(db, user.id, newId(), { ...VALID_DEPOSIT }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("amount inválido → ValidationError con fieldErrors.amount, sin insertar", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Valid",
      currency: "USD",
    });

    for (const amount of ["12.345", "0", "-3", "abc", ""]) {
      await expect(
        createTransaction(db, owner.id, box.id, { type: "deposit", amount }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.code).toBe("validation");
        expect(ve.fieldErrors.amount).toBeDefined();
        return true;
      });
    }

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(0);
  });

  it("note de 151 chars → ValidationError con fieldErrors.note", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Notes",
      currency: "USD",
    });

    await expect(
      createTransaction(db, owner.id, box.id, {
        ...VALID_DEPOSIT,
        note: "a".repeat(151),
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fieldErrors.note).toBeDefined();
      expect(ve.fieldErrors.amount).toBeUndefined();
      return true;
    });
  });

  it("type inválido ('transfer', 'reset') → ValidationError con fieldErrors.type", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Types",
      currency: "USD",
    });

    for (const type of ["transfer", "reset"]) {
      await expect(
        createTransaction(db, owner.id, box.id, { type, amount: "1" }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.fieldErrors.type).toBeDefined();
        return true;
      });
    }
  });

  it("atribución forzada: input con createdBy extra se ignora (createdBy = userId)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Attrib",
      currency: "USD",
    });

    const attacker = await insertUser(db);
    const tx = await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "1",
      createdBy: attacker.id,
      createdAt: 0,
    } as Parameters<typeof createTransaction>[3]);

    expect(tx.createdBy).toBe(owner.id);
    expect(tx.createdAt).toBeGreaterThanOrEqual(0);
    expect(tx.createdAt).not.toBe(0);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
