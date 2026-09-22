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
import { isUuidV7, newId } from "@/lib/ids";
import {
  NotFoundError,
  PermissionError,
  ValidationError,
} from "@/server/errors";
import { ALL_PERMISSIONS } from "@/server/permissions/access";
import { createToken } from "@/server/tokens/service";

/**
 * T049 — `createToken` contra DB real (SQLite temporal con las migraciones
 * de `drizzle/`). El service es puro respecto al request: recibe la db y el
 * userId, así que se testa directo; la capa de sesión vive en
 * `actions.ts`/`session.ts` y no se cubre acá.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

/** Usuario seed genérico (owner, guest o extraño según el test). */
async function insertUser(
  db: Parameters<typeof createToken>[0],
  email: string,
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email,
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

async function insertBox(
  db: Parameters<typeof createToken>[0],
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

describe("createToken (T049)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner OK: devuelve token crudo UNA vez; en DB solo hash (≠ crudo) + prefix de 8 chars + status active", async () => {
    const owner = await insertUser(db, `owner-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    const result = await createToken(db, owner.id, box.id, [
      "view:transactions",
    ]);

    // Token crudo presente exactamente en el resultado, y con formato
    // base64url de 43 chars (32 bytes).
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.prefix).toBe(result.token.slice(0, 8));
    expect(result.prefix).toHaveLength(8);
    expect(isUuidV7(result.id)).toBe(true);
    expect(result.permissions).toEqual(["view:transactions"]);

    // En DB: solo el hash, que NO es el token crudo, y no hay ninguna
    // columna que guarde el valor en claro.
    const stored = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, result.id))
      .limit(1);
    expect(stored).toHaveLength(1);
    const saved = stored[0] as typeof boxTokens.$inferSelect | undefined;
    expect(saved).toBeDefined();
    expect(saved?.tokenHash).not.toBe(result.token);
    expect(saved?.tokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(saved?.tokenPrefix).toBe(result.prefix);
    expect(saved?.boxId).toBe(box.id);
    expect(saved?.status).toBe("active");
    expect(saved?.createdBy).toBe(owner.id);
    expect(saved?.redeemedAt).toBeNull();
    expect(saved?.redeemedBy).toBeNull();
    expect(JSON.parse(saved?.permissions ?? "null")).toEqual([
      "view:transactions",
    ]);
  });

  it("guest (con box_access) → PermissionError; no inserta token", async () => {
    const owner = await insertUser(db, `owner2-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    // El guest tiene un access vigente (simula que ya canjeó un token
    // antes): para respetar la FK de `tokenId`, creamos la fila de token
    // con el owner (esto no pasa por `createToken`, es seed directo).
    const tokenRow = await db
      .insert(boxTokens)
      .values({
        id: newId(),
        boxId: box.id,
        tokenHash: `seedhash-${Math.random()}`,
        tokenPrefix: "seedpref",
        permissions: '["view:transactions"]',
        status: "redeemed",
        createdBy: owner.id,
        redeemedAt: Date.now(),
        redeemedBy: guest.id,
      })
      .returning();
    const seedToken = tokenRow[0];
    if (!seedToken) {
      throw new Error("Failed to insert seed token");
    }

    await db.insert(boxAccess).values({
      id: newId(),
      boxId: box.id,
      userId: guest.id,
      tokenId: seedToken.id,
      permissions: '["view:transactions"]',
    });

    await expect(
      createToken(db, guest.id, box.id, ["view:transactions"]),
    ).rejects.toBeInstanceOf(PermissionError);

    const tokens = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.boxId, box.id));
    expect(tokens).toHaveLength(1); // solo el seed, el guest no pudo crear
  });

  it("extraño (sin access) → NotFoundError (no se filtra la existencia de la box)", async () => {
    const owner = await insertUser(db, `owner3-${Math.random()}@example.com`);
    const stranger = await insertUser(
      db,
      `stranger-${Math.random()}@example.com`,
    );
    const box = await insertBox(db, owner.id);

    await expect(
      createToken(db, stranger.id, box.id, ["view:transactions"]),
    ).rejects.toBeInstanceOf(NotFoundError);

    const tokens = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.boxId, box.id));
    expect(tokens).toHaveLength(0);
  });

  it("box inexistente → NotFoundError", async () => {
    const owner = await insertUser(db, `owner4-${Math.random()}@example.com`);

    await expect(
      createToken(db, owner.id, newId(), ["view:transactions"]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("permisos inválidos → ValidationError: array vacío", async () => {
    const owner = await insertUser(db, `owner5-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    await expect(createToken(db, owner.id, box.id, [])).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.fieldErrors.permissions).toBeDefined();
        return true;
      },
    );
  });

  it("permisos inválidos → ValidationError: desconocido 'admin:all' (y no inserta nada)", async () => {
    const owner = await insertUser(db, `owner6-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    await expect(
      createToken(db, owner.id, box.id, ["view:transactions", "admin:all"]),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fieldErrors.permissions).toBeDefined();
      return true;
    });

    const tokens = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.boxId, box.id));
    expect(tokens).toHaveLength(0);
  });

  it("dedup: permisos repetidos se persisten una sola vez, en orden canónico", async () => {
    const owner = await insertUser(db, `owner7-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    const result = await createToken(db, owner.id, box.id, [
      "create:transactions",
      "view:transactions",
      "create:transactions",
    ]);

    // Orden canónico: el orden de ALL_PERMISSIONS, no el de llegada.
    expect(result.permissions).toEqual([
      "view:transactions",
      "create:transactions",
    ]);

    const stored = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, result.id))
      .limit(1);
    const saved = stored[0] as typeof boxTokens.$inferSelect | undefined;
    expect(JSON.parse(saved?.permissions ?? "null")).toEqual([
      "view:transactions",
      "create:transactions",
    ]);
  });

  it("acepta cualquier permiso del catálogo, incluido 'reset:box' solo (no se fuerza view)", async () => {
    const owner = await insertUser(db, `owner8-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    const result = await createToken(db, owner.id, box.id, ["reset:box"]);
    expect(result.permissions).toEqual(["reset:box"]);

    // Y el catálogo completo también es válido.
    const full = await createToken(db, owner.id, box.id, [...ALL_PERMISSIONS]);
    expect(full.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it("dos tokens del mismo owner tienen hashes distintos (tokens únicos)", async () => {
    const owner = await insertUser(db, `owner9-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    const first = await createToken(db, owner.id, box.id, [
      "view:transactions",
    ]);
    const second = await createToken(db, owner.id, box.id, [
      "view:transactions",
    ]);

    expect(first.token).not.toBe(second.token);
    const stored = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.boxId, box.id));
    expect(stored).toHaveLength(2);
    expect(stored[0]?.tokenHash).not.toBe(stored[1]?.tokenHash);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
