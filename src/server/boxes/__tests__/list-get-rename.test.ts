import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import {
  boxAccess,
  boxTokens,
  type SavingsBox,
  savingsBoxes,
  transactions,
  users,
} from "@/db/schema";
import { isUuidV7, newId } from "@/lib/ids";
import {
  createBox,
  getBox,
  listBoxes,
  renameBox,
} from "@/server/boxes/service";
import {
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import { parsePermissionsJson as parsePermissions } from "@/server/permissions/access";

/**
 * T043/T044/T045 — listado, detalle con 404 oculto y renombre (solo owner)
 * contra DB real (SQLite temporal con las migraciones de `drizzle/`). El
 * service es puro respecto al request: recibe la db y el userId, así que se
 * testa directo; la capa de sesión vive en `actions.ts` y no se cubre acá.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-box.test.ts` y `service.test.ts` de auth). Vitest hoistea
// `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

/** Usuario seed con email único. */
async function insertUser(
  db: Parameters<typeof createBox>[0],
  name = "Seed",
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: `seed-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
      name,
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
  db: Parameters<typeof createBox>[0],
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
  db: Parameters<typeof createBox>[0],
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

/** Transacción directa (sin service) para seedear balances en tests. */
async function insertTransaction(
  db: Parameters<typeof createBox>[0],
  boxId: string,
  userId: string,
  type: "deposit" | "withdraw" | "reset",
  amountMinor: number,
): Promise<void> {
  await db.insert(transactions).values({
    id: newId(),
    boxId,
    type,
    amountMinor,
    note: "seed",
    createdBy: userId,
  });
}

describe("parsePermissions (helper compartido)", () => {
  it("parsea un JSON array de permisos válidos", () => {
    expect(
      parsePermissions('["view:transactions","create:transactions"]'),
    ).toEqual(["view:transactions", "create:transactions"]);
  });

  it("filtra valores desconocidos (no rompe el union Permission)", () => {
    expect(parsePermissions('["view:transactions","hack:all"]')).toEqual([
      "view:transactions",
    ]);
  });

  it("devuelve [] para JSON inválido o no-array (datos corruptos)", () => {
    expect(parsePermissions("not-json")).toEqual([]);
    expect(parsePermissions('{"perm":"view:transactions"}')).toEqual([]);
    expect(parsePermissions("null")).toEqual([]);
  });
});

describe("listBoxes (T043)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("separa own de shared y adjunta los permisos del access", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);

    const ownBox = await createBox(db, owner.id, {
      name: "Propia",
      currency: "USD",
    });
    const sharedBox = await createBox(db, guest.id, {
      name: "Compartida",
      currency: "EUR",
    });
    await insertAccess(
      db,
      sharedBox.id,
      owner.id,
      guest.id,
      '["view:transactions"]',
    );

    const result = await listBoxes(db, owner.id);

    expect(result.own).toHaveLength(1);
    expect(result.own[0]?.box.id).toBe(ownBox.id);

    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]?.box.id).toBe(sharedBox.id);
    expect(result.shared[0]?.box.ownerId).toBe(guest.id);
    expect(result.shared[0]?.permissions).toEqual(["view:transactions"]);
  });

  it("permisos del access múltiples se parsean completos", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);

    const box = await createBox(db, owner.id, {
      name: "Multi",
      currency: "USD",
    });
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["view:transactions","create:transactions","reset:box"]',
    );

    const result = await listBoxes(db, guest.id);
    expect(result.own).toHaveLength(0);
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]?.permissions).toEqual([
      "view:transactions",
      "create:transactions",
      "reset:box",
    ]);
  });

  it("usuario sin boxes → dos listas vacías", async () => {
    const lonely = await insertUser(db);

    const result = await listBoxes(db, lonely.id);
    expect(result.own).toEqual([]);
    expect(result.shared).toEqual([]);
  });

  it("orden: own y shared por createdAt DESC (más nueva primero)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);

    // Insert directo con createdAt explícitos: determinista, sin depender
    // de que Date.now() avance entre llamadas.
    const t0 = Date.now();
    const [first, second, shared] = await db
      .insert(savingsBoxes)
      .values([
        {
          id: newId(),
          ownerId: owner.id,
          name: "Primera",
          currency: "USD",
          createdAt: t0,
          updatedAt: t0,
        },
        {
          id: newId(),
          ownerId: owner.id,
          name: "Segunda",
          currency: "USD",
          createdAt: t0 + 1,
          updatedAt: t0 + 1,
        },
        {
          id: newId(),
          ownerId: guest.id,
          name: "Shared",
          currency: "USD",
          createdAt: t0 + 2,
          updatedAt: t0 + 2,
        },
      ])
      .returning();
    if (!first || !second || !shared) {
      throw new Error("boxes seed no insertadas");
    }
    await insertAccess(
      db,
      shared.id,
      owner.id,
      guest.id,
      '["view:transactions"]',
    );

    const result = await listBoxes(db, owner.id);
    expect(result.own.map((entry) => entry.box.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(result.shared.map((s) => s.box.id)).toEqual([shared.id]);
  });

  it("el orden de shared usa el createdAt del access, no el de la box", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);

    const t0 = Date.now();
    const [boxA, boxB] = await db
      .insert(savingsBoxes)
      .values([
        {
          id: newId(),
          ownerId: guest.id,
          name: "A",
          currency: "USD",
          createdAt: t0 + 100,
          updatedAt: t0 + 100,
        },
        {
          id: newId(),
          ownerId: guest.id,
          name: "B",
          currency: "USD",
          createdAt: t0 + 50,
          updatedAt: t0 + 50,
        },
      ])
      .returning();
    if (!boxA || !boxB) {
      throw new Error("boxes seed no insertadas");
    }
    // Access de B más nuevo que el de A, aunque la box A sea más nueva:
    // el orden de shared debe seguir al access.
    await insertAccess(
      db,
      boxA.id,
      owner.id,
      guest.id,
      '["view:transactions"]',
    );
    const [accessA] = await db
      .select()
      .from(boxAccess)
      .where(eq(boxAccess.boxId, boxA.id))
      .limit(1);
    await insertAccess(
      db,
      boxB.id,
      owner.id,
      guest.id,
      '["view:transactions"]',
    );
    const [accessB] = await db
      .select()
      .from(boxAccess)
      .where(eq(boxAccess.boxId, boxB.id))
      .limit(1);
    if (!accessA || !accessB) {
      throw new Error("access seeds no insertados");
    }
    await db
      .update(boxAccess)
      .set({ createdAt: accessA.createdAt + 10 })
      .where(eq(boxAccess.id, accessB.id));

    const result = await listBoxes(db, owner.id);
    expect(result.shared.map((s) => s.box.id)).toEqual([boxB.id, boxA.id]);
  });

  it("balanceMinor: 0 sin transacciones y deposit - withdraw con historial", async () => {
    const owner = await insertUser(db);
    const empty = await createBox(db, owner.id, {
      name: "Vacia",
      currency: "USD",
    });
    const withTxs = await createBox(db, owner.id, {
      name: "Con movs",
      currency: "USD",
    });
    await insertTransaction(db, withTxs.id, owner.id, "deposit", 1000);
    await insertTransaction(db, withTxs.id, owner.id, "withdraw", 400);

    const result = await listBoxes(db, owner.id);

    const emptyEntry = result.own.find((entry) => entry.box.id === empty.id);
    const txsEntry = result.own.find((entry) => entry.box.id === withTxs.id);
    expect(emptyEntry?.balanceMinor).toBe(0);
    expect(txsEntry?.balanceMinor).toBe(600);
  });

  it("balanceMinor de una compartida sale de los movimientos de la box (no del guest)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Compartida con saldo",
      currency: "ARS",
    });
    await insertAccess(db, box.id, guest.id, owner.id, '["view:transactions"]');
    await insertTransaction(db, box.id, owner.id, "deposit", 2500);

    const result = await listBoxes(db, guest.id);
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]?.balanceMinor).toBe(2500);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});

describe("getBox (T044)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner: isOwner true y permisos totales", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, { name: "Mía", currency: "USD" });

    const info = await getBox(db, owner.id, box.id);
    expect(info.isOwner).toBe(true);
    expect(info.permissions).toEqual([
      "view:transactions",
      "create:transactions",
      "reset:box",
    ]);
    expect(info.box.id).toBe(box.id);
  });

  it("balanceMinor: 0 sin transacciones y coherente con deposit/withdraw/reset", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Saldo",
      currency: "USD",
    });

    const empty = await getBox(db, owner.id, box.id);
    expect(empty.balanceMinor).toBe(0);

    await insertTransaction(db, box.id, owner.id, "deposit", 1000);
    await insertTransaction(db, box.id, owner.id, "withdraw", 400);
    const partial = await getBox(db, owner.id, box.id);
    expect(partial.balanceMinor).toBe(600);

    // reset compensa con amountMinor = -(balance previo): vuelve a 0.
    await insertTransaction(db, box.id, owner.id, "reset", -600);
    const afterReset = await getBox(db, owner.id, box.id);
    expect(afterReset.balanceMinor).toBe(0);
  });

  it("guest con access: isOwner false y permisos del access", async () => {
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

    const info = await getBox(db, guest.id, box.id);
    expect(info.isOwner).toBe(false);
    expect(info.permissions).toEqual([
      "view:transactions",
      "create:transactions",
    ]);
  });

  it("extraño sin relación → NotFoundError (nunca Forbidden)", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ajena",
      currency: "USD",
    });

    await expect(getBox(db, stranger.id, box.id)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).code).toBe("not_found");
        return true;
      },
    );
  });

  it("box inexistente → NotFoundError (mismo code que el extraño)", async () => {
    const user = await insertUser(db);
    const fakeId = newId();

    await expect(getBox(db, user.id, fakeId)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).code).toBe("not_found");
        return true;
      },
    );
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});

describe("renameBox (T045)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner renombra OK: persiste name + updatedAt, id/currency intactos", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Viejo nombre",
      currency: "ARS",
    });
    const before = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.id, box.id))
      .limit(1);
    const savedBefore = before[0] as SavingsBox;

    const renamed = await renameBox(db, owner.id, box.id, "Nuevo nombre");

    expect(renamed.name).toBe("Nuevo nombre");
    expect(renamed.id).toBe(box.id);
    expect(renamed.currency).toBe("ARS");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(savedBefore.updatedAt);
    expect(renamed.createdAt).toBe(savedBefore.createdAt);

    const after = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.id, box.id))
      .limit(1);
    const savedAfter = after[0] as SavingsBox;
    expect(savedAfter.name).toBe("Nuevo nombre");
    expect(savedAfter.currency).toBe("ARS");
    expect(savedAfter.id).toBe(box.id);
    expect(savedAfter.updatedAt).toBeGreaterThanOrEqual(savedBefore.updatedAt);
  });

  it("hace trim del nombre antes de validar y guardar", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, { name: "X", currency: "USD" });

    const renamed = await renameBox(db, owner.id, box.id, "  Con espacios  ");
    expect(renamed.name).toBe("Con espacios");
  });

  it("guest con TODOS los permisos NO puede renombrar → PermissionError (forbidden)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ajena",
      currency: "USD",
    });
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["view:transactions","create:transactions","reset:box"]',
    );

    await expect(renameBox(db, guest.id, box.id, "Hackeada")).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(PermissionError);
        expect((error as PermissionError).code).toBe("forbidden");
        return true;
      },
    );

    // El nombre no cambió.
    const after = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.id, box.id))
      .limit(1);
    expect((after[0] as SavingsBox).name).toBe("Ajena");
  });

  it("extraño sin relación → NotFoundError (no Forbidden)", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ajena",
      currency: "USD",
    });

    await expect(
      renameBox(db, stranger.id, box.id, "Mía ahora"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("not_found");
      return true;
    });
  });

  it("box inexistente → NotFoundError", async () => {
    const user = await insertUser(db);
    await expect(
      renameBox(db, user.id, newId(), "Nada"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("nombre inválido ('' y 81 chars) → ValidationError por campo, sin tocar la box", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Original",
      currency: "USD",
    });

    for (const newName of ["", "   ", "a".repeat(81)]) {
      await expect(renameBox(db, owner.id, box.id, newName)).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(ValidationError);
          const ve = error as ValidationError;
          expect(ve.code).toBe("validation");
          expect(ve.fieldErrors.name).toBeDefined();
          return true;
        },
      );
    }

    const after = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.id, box.id))
      .limit(1);
    expect((after[0] as SavingsBox).name).toBe("Original");
  });

  it("80 chars exactos pasa (límite superior válido)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, { name: "X", currency: "USD" });

    const renamed = await renameBox(db, owner.id, box.id, "a".repeat(80));
    expect(renamed.name).toHaveLength(80);
  });

  it("isUuidV7 se mantiene: el id nunca cambia con el rename", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, { name: "Ids", currency: "USD" });
    expect(isUuidV7(box.id)).toBe(true);

    const renamed = await renameBox(db, owner.id, box.id, "Otros");
    expect(isUuidV7(renamed.id)).toBe(true);
    expect(renamed.id).toBe(box.id);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
