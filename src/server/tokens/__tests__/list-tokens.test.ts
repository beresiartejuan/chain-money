import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import {
  boxAccess,
  boxTokens,
  type SavingsBox,
  savingsBoxes,
  users,
} from "@/db/schema";
import { hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import { NotFoundError, PermissionError } from "@/server/errors";
import { createToken, listTokens } from "@/server/tokens/service";

/**
 * T053 — `listTokens` contra DB real (SQLite temporal con las migraciones
 * de `drizzle/`). Reglas:
 * - **Solo owner** (extraño → 404, guest → 403).
 * - El payload NUNCA incluye el hash del token ni el token crudo: la única
 *   referencia es `tokenPrefix` (8 chars, no secreto).
 * - `redeemedBy` se resuelve al NOMBRE del usuario que canjeó (LEFT JOIN a
 *   `users`; null si el usuario ya no existe o no se canjeó).
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

/** Usuario seed genérico (owner, guest o extraño según el test). */
async function insertUser(
  db: Parameters<typeof listTokens>[0],
  email: string,
  name = "Seed",
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email,
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

async function insertBox(
  db: Parameters<typeof listTokens>[0],
  ownerId: string,
): Promise<SavingsBox> {
  const inserted = await db
    .insert(savingsBoxes)
    .values({
      id: newId(),
      ownerId,
      name: "Caja compartida",
      currency: "USD",
    })
    .returning();
  const box = inserted[0];
  if (!box) {
    throw new Error("Failed to insert seed box");
  }
  return box;
}

/**
 * Crea una fila de token directamente (seed de DB, sin pasar por
 * `createToken`) con el status exacto que pide cada test.
 */
async function insertTokenRow(
  db: Parameters<typeof listTokens>[0],
  input: {
    boxId: string;
    createdBy: string;
    status: "active" | "expired" | "redeemed";
    redeemedBy?: string | null;
    permissions?: string[];
  },
) {
  const inserted = await db
    .insert(boxTokens)
    .values({
      id: newId(),
      boxId: input.boxId,
      tokenHash: hashAccessToken(`${input.boxId}-${Math.random()}`),
      tokenPrefix: "seedpref",
      permissions: JSON.stringify(input.permissions ?? ["view:transactions"]),
      status: input.status,
      createdBy: input.createdBy,
      redeemedAt: input.status === "redeemed" ? Date.now() : null,
      redeemedBy:
        input.status === "redeemed"
          ? (input.redeemedBy ?? input.createdBy)
          : null,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert seed token");
  }
  return row;
}

/**
 * Recorre el payload completo buscando un SHA-256 hex de 64 chars: si algún
 * string del payload es un hash, el test falla (independiente de la key).
 */
function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => collectStrings(v));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((v) => collectStrings(v));
  }
  return [];
}

describe("listTokens (T053)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner ve la lista completa: prefix, permisos, status, createdAt, redeemedAt y redeemedBy con nombre", async () => {
    const owner = await insertUser(db, `owner-${Math.random()}@example.com`);
    const guest = await insertUser(
      db,
      `guest-${Math.random()}@example.com`,
      "Guest Canjeador",
    );
    const box = await insertBox(db, owner.id);

    // Token canjeado por el guest.
    const redeemedRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "redeemed",
      redeemedBy: guest.id,
      permissions: ["view:transactions", "create:transactions"],
    });
    await db.insert(boxAccess).values({
      id: newId(),
      boxId: box.id,
      userId: guest.id,
      tokenId: redeemedRow.id,
      permissions: '["view:transactions","create:transactions"]',
    });
    // Tokens en otros estados.
    const activeRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "active",
      permissions: ["reset:box"],
    });
    const expiredRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "expired",
      permissions: ["view:transactions"],
    });

    const tokens = await listTokens(db, owner.id, box.id);

    expect(tokens).toHaveLength(3);
    const byId = new Map(tokens.map((t) => [t.id, t]));

    const redeemed = byId.get(redeemedRow.id);
    expect(redeemed).toMatchObject({
      id: redeemedRow.id,
      tokenPrefix: "seedpref",
      permissions: ["view:transactions", "create:transactions"],
      status: "redeemed",
      redeemedByName: "Guest Canjeador",
    });
    expect(redeemed?.redeemedAt).not.toBeNull();
    expect(redeemed?.createdAt).toBeTypeOf("number");

    expect(byId.get(activeRow.id)).toMatchObject({
      status: "active",
      permissions: ["reset:box"],
      redeemedByName: null,
      redeemedAt: null,
    });
    expect(byId.get(expiredRow.id)?.status).toBe("expired");

    // Orden: más nuevos primero (createdAt desc).
    const createdAts = tokens.map((t) => t.createdAt);
    const sorted = [...createdAts].sort((a, b) => b - a);
    expect(createdAts).toEqual(sorted);

    // El nombre canjeado viene del LEFT JOIN a users: un token canjeado por
    // un usuario que ya no existe responde `redeemedByName: null` (sin
    // crash). Se simula liberando las FK del guest: su box_access y la
    // marca redeemedBy del token que lo apuntan.
    await db.delete(boxAccess).where(eq(boxAccess.userId, guest.id));
    await db
      .update(boxTokens)
      .set({ redeemedBy: null })
      .where(eq(boxTokens.id, redeemedRow.id));
    const afterUnlink = await listTokens(db, owner.id, box.id);
    expect(
      afterUnlink.find((t) => t.id === redeemedRow.id)?.redeemedByName,
    ).toBeNull();
    // El resto del payload no cambió.
    expect(afterUnlink.find((t) => t.id === activeRow.id)?.status).toBe(
      "active",
    );
  });

  it("guest (con box_access) → PermissionError", async () => {
    const owner = await insertUser(db, `owner2-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest2-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const tokenRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "redeemed",
      redeemedBy: guest.id,
    });
    await db.insert(boxAccess).values({
      id: newId(),
      boxId: box.id,
      userId: guest.id,
      tokenId: tokenRow.id,
      permissions: '["view:transactions"]',
    });

    await expect(listTokens(db, guest.id, box.id)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it("extraño (sin access) → NotFoundError (no se filtra la existencia de la box)", async () => {
    const owner = await insertUser(db, `owner3-${Math.random()}@example.com`);
    const stranger = await insertUser(
      db,
      `stranger3-${Math.random()}@example.com`,
    );
    const box = await insertBox(db, owner.id);
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "active",
    });

    await expect(listTokens(db, stranger.id, box.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("box inexistente → NotFoundError", async () => {
    const owner = await insertUser(db, `owner4-${Math.random()}@example.com`);

    await expect(listTokens(db, owner.id, newId())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("payload sin secretos: ninguna key/tokenHash y ningún string con shape de SHA-256 hex de 64 chars", async () => {
    const owner = await insertUser(db, `owner5-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest5-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    // Mezcla de tokens creados por service (hash real SHA-256) y seed.
    const created = await createToken(db, owner.id, box.id, [
      "view:transactions",
    ]);
    const seeded = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      status: "redeemed",
      redeemedBy: guest.id,
    });
    await db.insert(boxAccess).values({
      id: newId(),
      boxId: box.id,
      userId: guest.id,
      tokenId: seeded.id,
      permissions: '["view:transactions"]',
    });

    const tokens = await listTokens(db, owner.id, box.id);
    expect(tokens).toHaveLength(2);

    // 1) Ninguna key del payload es/hash: no aparecen tokenHash ni crudo.
    const keys = new Set<string>();
    for (const token of tokens) {
      for (const key of Object.keys(token)) {
        keys.add(key);
      }
    }
    for (const key of keys) {
      expect(key.toLowerCase()).not.toBe("tokenhash");
      expect(key.toLowerCase()).not.toBe("token");
    }

    // 2) Ningún string del payload tiene el shape de un hash SHA-256 (64
    //    hex) ni es el token crudo real. Los únicos strings que existen son
    //    ids, prefix, permisos, status y nombre — nada sensible.
    const allStrings = collectStrings(tokens);
    expect(allStrings.length).toBeGreaterThan(0);
    for (const value of allStrings) {
      expect(value).not.toMatch(/^[a-f0-9]{64}$/);
      expect(value).not.toBe(created.token);
    }
    // El prefix SI aparece (es el identificador no secreto pensado para UI).
    expect(allStrings).toContain(created.prefix);
    expect(allStrings).toContain(seeded.tokenPrefix);

    // 3) El hash real persistido tampoco se filtra por ningún campo.
    const stored = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, created.id))
      .limit(1);
    const realHash = stored[0]?.tokenHash;
    expect(realHash).toMatch(/^[a-f0-9]{64}$/); // sanidad del seed
    const serialized = JSON.stringify(tokens);
    expect(serialized).not.toContain(realHash);
    expect(serialized).not.toContain(created.token);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
