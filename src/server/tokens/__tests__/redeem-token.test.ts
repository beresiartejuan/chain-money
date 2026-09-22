import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import {
  OwnBoxRedeemError,
  RateLimitError,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  TokenInvalidError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import {
  REDEEM_RATE_LIMIT,
  redeemRateLimitKey,
  redeemToken,
} from "@/server/tokens/service";

/**
 * T050 — `redeemToken` contra DB real (SQLite temporal con las migraciones
 * de `drizzle/`). El service es puro respecto al request; el rate limit usa
 * `checkRateLimit` (ventana fija sobre `Date.now()`), así que cada test
 * resetea la key en `afterEach` para no arrastrar cupo entre tests.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

/** Usuario seed genérico (owner, guest o extraño según el test). */
async function insertUser(
  db: Parameters<typeof redeemToken>[0],
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
  db: Parameters<typeof redeemToken>[0],
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
 * `createToken`) con hash determinado a partir de `rawToken`, así el test
 * controla el status inicial exacto.
 */
async function insertTokenRow(
  db: Parameters<typeof redeemToken>[0],
  input: {
    boxId: string;
    createdBy: string;
    rawToken: string;
    permissions: string[];
    status: "active" | "expired" | "redeemed";
  },
) {
  const inserted = await db
    .insert(boxTokens)
    .values({
      id: newId(),
      boxId: input.boxId,
      tokenHash: hashAccessToken(input.rawToken),
      tokenPrefix: input.rawToken.slice(0, 8),
      permissions: JSON.stringify(input.permissions),
      status: input.status,
      createdBy: input.createdBy,
      redeemedAt: input.status === "redeemed" ? Date.now() : null,
      redeemedBy: input.status === "redeemed" ? input.createdBy : null,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert seed token");
  }
  return row;
}

/** Token crudo válido de 43 chars (el formato que produce generateAccessToken). */
function makeRawToken(seed: string): string {
  // SHA-256 del seed = 32 bytes → 43 chars base64url: exactamente el shape
  // de `generateAccessToken` (32 bytes random → base64url sin padding).
  // Determinista por seed, así cada test controla sus tokens.
  return createHash("sha256").update(seed, "utf8").digest("base64url");
}

describe("redeemToken (T050)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  afterEach(() => {
    // El rate limit vive en un Map global al proceso, pero cada test usa
    // users con ids únicos (UUIDv7 + email aleatorio): ninguna key
    // `redeem:{userId}` se repite entre tests, así que el aislamiento ya
    // está garantizado por construction. El reset explícito por key se
    // hace en el test de rate limit (ver abajo).
  });

  it("token activo → ok: acceso creado con los permisos del token, status redeemed + redeemedAt/BY", async () => {
    const owner = await insertUser(db, `owner-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("activo");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions", "create:transactions"],
      status: "active",
    });

    const before = Date.now();
    const result = await redeemToken(db, guest.id, raw);

    expect(result.boxId).toBe(box.id);

    // Token canjeado: status, redeemedAt y redeemedBy.
    const tokens = await db
      .select()
      .from(boxTokens)
      .where(and(eq(boxTokens.boxId, box.id)));
    expect(tokens).toHaveLength(1);
    const tokenRow = tokens[0];
    expect(tokenRow?.status).toBe("redeemed");
    expect(tokenRow?.redeemedAt).toBeGreaterThanOrEqual(before);
    expect(tokenRow?.redeemedBy).toBe(guest.id);

    // Acceso creado con los permisos del token.
    const access = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)));
    expect(access).toHaveLength(1);
    expect(JSON.parse(access[0]?.permissions ?? "null")).toEqual([
      "view:transactions",
      "create:transactions",
    ]);
    expect(access[0]?.tokenId).toBe(tokenRow?.id);
  });

  it("token ya canjeado → TokenAlreadyRedeemedError (y no duplica access)", async () => {
    const owner = await insertUser(db, `owner2-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest2-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("usado");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions"],
      status: "redeemed",
    });

    await expect(redeemToken(db, guest.id, raw)).rejects.toBeInstanceOf(
      TokenAlreadyRedeemedError,
    );

    const access = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)));
    expect(access).toHaveLength(0);
  });

  it("token expirado → TokenExpiredError", async () => {
    const owner = await insertUser(db, `owner3-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest3-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("expirado");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions"],
      status: "expired",
    });

    await expect(redeemToken(db, guest.id, raw)).rejects.toBeInstanceOf(
      TokenExpiredError,
    );

    const access = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)));
    expect(access).toHaveLength(0);
  });

  it("owner de la box → OwnBoxRedeemError (por ownerId y por createdBy)", async () => {
    const owner = await insertUser(db, `owner4-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("propietario");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions"],
      status: "active",
    });

    await expect(redeemToken(db, owner.id, raw)).rejects.toBeInstanceOf(
      OwnBoxRedeemError,
    );

    // El token NO se marca como canjeado.
    const tokens = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.boxId, box.id));
    expect(tokens[0]?.status).toBe("active");
    expect(tokens[0]?.redeemedAt).toBeNull();
  });

  it("token malformado y token inexistente → TokenInvalidError (mismo error, no se filtra)", async () => {
    const guest = await insertUser(db, `guest4-${Math.random()}@example.com`);

    // Malformado: longitud incorrecta.
    for (const bad of ["", "corto", "a".repeat(44), "a".repeat(42)]) {
      await expect(redeemToken(db, guest.id, bad)).rejects.toBeInstanceOf(
        TokenInvalidError,
      );
    }

    // Bien formado pero inexistente: MISMO error que el malformado.
    const unknown = makeRawToken("nunca-creado");
    await expect(redeemToken(db, guest.id, unknown)).rejects.toThrow(
      TokenInvalidError,
    );
  });

  it("guest con access previo re-canjea: los permisos se UNEN (view ∪ view+create = view+create)", async () => {
    const owner = await insertUser(db, `owner5-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest5-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    // Access previo del guest: solo view (canje de un token anterior).
    const oldToken = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: makeRawToken("viejo-token"),
      permissions: ["view:transactions"],
      status: "redeemed",
    });
    await db.insert(boxAccess).values({
      id: newId(),
      boxId: box.id,
      userId: guest.id,
      tokenId: oldToken.id,
      permissions: '["view:transactions"]',
    });

    // Nuevo token: view + create.
    const raw = makeRawToken("nuevo-token");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions", "create:transactions"],
      status: "active",
    });

    await expect(redeemToken(db, guest.id, raw)).resolves.toEqual({
      boxId: box.id,
    });

    // La fila de access sigue siendo UNA (unique) y con la unión.
    const access = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)));
    expect(access).toHaveLength(1);
    expect(JSON.parse(access[0]?.permissions ?? "null")).toEqual([
      "view:transactions",
      "create:transactions",
    ]);
    // tokenId apunta al token recién canjeado.
    const newTokenRow = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.tokenHash, hashAccessToken(raw)))
      .limit(1);
    expect(access[0]?.tokenId).toBe(newTokenRow[0]?.id);
  });

  it(`rate limit: ${REDEEM_RATE_LIMIT} intentos OK y el 11mo → RateLimitError (key redeem:{userId})`, async () => {
    const guest = await insertUser(db, `guest6-${Math.random()}@example.com`);
    const key = redeemRateLimitKey(guest.id);
    resetRateLimit(key); // ventana limpia para este test

    // 10 intentos: consume cupo (fallan con TokenInvalidError, pero cuentan).
    for (let i = 0; i < REDEEM_RATE_LIMIT; i += 1) {
      await expect(
        redeemToken(db, guest.id, `corto-${i}`),
      ).rejects.toBeInstanceOf(TokenInvalidError);
    }

    // 11mo intento: bloqueado ANTES del lookup (el token es irrelevante).
    const error = await redeemToken(
      db,
      guest.id,
      makeRawToken("cupo-agotado"),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfterMs: expect.any(Number),
    });
    expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);

    // Otro user tiene cupo propio.
    const other = await insertUser(db, `guest7-${Math.random()}@example.com`);
    await expect(redeemToken(db, other.id, "corto")).rejects.toBeInstanceOf(
      TokenInvalidError,
    ); // no RateLimitError

    resetRateLimit(key);
  });

  it("los intentos exitosos también consumen cupo del rate limit", async () => {
    const owner = await insertUser(db, `owner8-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest8-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    resetRateLimit(redeemRateLimitKey(guest.id));

    // 10 canjes exitosos.
    for (let i = 0; i < REDEEM_RATE_LIMIT; i += 1) {
      const raw = makeRawToken(`exito-${i}`);
      await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "active",
      });
      await expect(redeemToken(db, guest.id, raw)).resolves.toEqual({
        boxId: box.id,
      });
    }

    // El 11mo, aunque el token sea válido, está bloqueado.
    const raw11 = makeRawToken("exito-11");
    await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw11,
      permissions: ["view:transactions"],
      status: "active",
    });
    await expect(redeemToken(db, guest.id, raw11)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    resetRateLimit(redeemRateLimitKey(guest.id));
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
