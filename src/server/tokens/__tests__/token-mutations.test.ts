import { and, eq } from "drizzle-orm";
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
import {
  NotFoundError,
  PermissionError,
  TokenAlreadyRedeemedError,
} from "@/server/errors";
import { expireToken, revokeToken } from "@/server/tokens/service";

/**
 * T052 — `revokeToken` + `expireToken` contra DB real (SQLite temporal con
 * las migraciones de `drizzle/`). Reglas:
 * - Ambas son **solo owner** (extraño → 404, guest → 403).
 * - Token redeemed NO se puede revocar: `box_access.tokenId` es FK NOT NULL
 *   sin `ON DELETE` (la FK enforcement está activa, `PRAGMA foreign_keys`
 *   = 1), así que borrar la fila dejaría el acceso ya otorgado huérfano y
 *   violaría la FK. La decisión de producto (T092) es que el acceso
 *   canjeado persiste → ese caso devuelve `TokenAlreadyRedeemedError`.
 * - Token redeemed tampoco se puede expirar (mismo error).
 * - Expire es idempotente sobre tokens ya expirados.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

/** Usuario seed genérico (owner, guest o extraño según el test). */
async function insertUser(
  db: Parameters<typeof revokeToken>[0],
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
  db: Parameters<typeof revokeToken>[0],
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
 * `createToken`) con el status inicial exacto que pide cada test.
 */
async function insertTokenRow(
  db: Parameters<typeof revokeToken>[0],
  input: {
    boxId: string;
    createdBy: string;
    status: "active" | "expired" | "redeemed";
  },
) {
  const inserted = await db
    .insert(boxTokens)
    .values({
      id: newId(),
      boxId: input.boxId,
      // Hash único por fila (unique): el seed determinista + índice del loop.
      tokenHash: hashAccessToken(
        `${input.boxId}-${input.status}-${Math.random()}`,
      ),
      tokenPrefix: "seedpref",
      permissions: '["view:transactions"]',
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

describe("token mutations (T052)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  describe("revokeToken", () => {
    it("owner revoca token active: la fila desaparece de box_tokens", async () => {
      const owner = await insertUser(db, `owner-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      await expect(revokeToken(db, owner.id, tokenRow.id)).resolves.toEqual({
        id: tokenRow.id,
      });

      const left = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(left).toHaveLength(0);
    });

    it("owner revoca token expired: borrado OK (solo redeemed está bloqueado)", async () => {
      const owner = await insertUser(db, `owner2-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "expired",
      });

      await expect(revokeToken(db, owner.id, tokenRow.id)).resolves.toEqual({
        id: tokenRow.id,
      });

      const left = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(left).toHaveLength(0);
    });

    it("token redeemed NO se puede revocar: TokenAlreadyRedeemedError y la fila persiste (acceso canjeado intacto)", async () => {
      const owner = await insertUser(db, `owner3-${Math.random()}@example.com`);
      const guest = await insertUser(db, `guest3-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "redeemed",
      });

      // El guest canjeó ese token: su box_access apunta al token.
      await db.insert(boxAccess).values({
        id: newId(),
        boxId: box.id,
        userId: guest.id,
        tokenId: tokenRow.id,
        permissions: '["view:transactions"]',
      });

      await expect(
        revokeToken(db, owner.id, tokenRow.id),
      ).rejects.toBeInstanceOf(TokenAlreadyRedeemedError);

      // Ni el token ni el acceso canjeado se tocaron.
      const tokenLeft = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(tokenLeft).toHaveLength(1);
      const access = await db
        .select()
        .from(boxAccess)
        .where(
          and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)),
        );
      expect(access).toHaveLength(1);
      expect(access[0]?.tokenId).toBe(tokenRow.id);
    });

    it("guest (con box_access) → PermissionError; la fila no se borra", async () => {
      const owner = await insertUser(db, `owner4-${Math.random()}@example.com`);
      const guest = await insertUser(db, `guest4-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      // Access del guest apuntando a OTRO token (no al revocado): así el
      // borrado no chocaría con la FK si igualmente intentara borrar.
      const otherToken = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "redeemed",
      });
      await db.insert(boxAccess).values({
        id: newId(),
        boxId: box.id,
        userId: guest.id,
        tokenId: otherToken.id,
        permissions: '["view:transactions"]',
      });

      await expect(
        revokeToken(db, guest.id, tokenRow.id),
      ).rejects.toBeInstanceOf(PermissionError);

      const left = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(left).toHaveLength(1);
    });

    it("extraño (sin access) → NotFoundError; no se borra", async () => {
      const owner = await insertUser(db, `owner5-${Math.random()}@example.com`);
      const stranger = await insertUser(
        db,
        `stranger5-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      await expect(
        revokeToken(db, stranger.id, tokenRow.id),
      ).rejects.toBeInstanceOf(NotFoundError);

      const left = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(left).toHaveLength(1);
    });

    it("token inexistente → NotFoundError", async () => {
      const owner = await insertUser(db, `owner6-${Math.random()}@example.com`);

      await expect(revokeToken(db, owner.id, newId())).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("box inexistente (token huérfano) → NotFoundError", async () => {
      const owner = await insertUser(db, `owner7-${Math.random()}@example.com`);
      // Seed directo con boxId que no existe (FK lo impediría en un insert
      // limpio, así que se inserta la box y luego se borra).
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });
      await db.delete(savingsBoxes).where(eq(savingsBoxes.id, box.id));

      await expect(
        revokeToken(db, owner.id, tokenRow.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("expireToken", () => {
    it("owner expira token active: status expired, fila intacta", async () => {
      const owner = await insertUser(db, `owner8-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      const result = await expireToken(db, owner.id, tokenRow.id);
      expect(result.status).toBe("expired");
      expect(result.id).toBe(tokenRow.id);

      const after = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(after[0]?.status).toBe("expired");
      expect(after[0]?.redeemedAt).toBeNull(); // no se marcó canje
    });

    it("token redeemed no se puede expirar: TokenAlreadyRedeemedError y sigue redeemed", async () => {
      const owner = await insertUser(db, `owner9-${Math.random()}@example.com`);
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "redeemed",
      });

      await expect(
        expireToken(db, owner.id, tokenRow.id),
      ).rejects.toBeInstanceOf(TokenAlreadyRedeemedError);

      const after = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(after[0]?.status).toBe("redeemed"); // sin cambios
    });

    it("expire de token ya expirado es idempotente: OK, devuelve la fila sin cambios", async () => {
      const owner = await insertUser(
        db,
        `owner10-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "expired",
      });

      const result = await expireToken(db, owner.id, tokenRow.id);
      expect(result.status).toBe("expired");
      expect(result.id).toBe(tokenRow.id);
    });

    it("guest (con box_access) → PermissionError; el status no cambia", async () => {
      const owner = await insertUser(
        db,
        `owner10-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `guest10-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      const otherToken = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "redeemed",
      });
      await db.insert(boxAccess).values({
        id: newId(),
        boxId: box.id,
        userId: guest.id,
        tokenId: otherToken.id,
        permissions: '["view:transactions"]',
      });

      await expect(
        expireToken(db, guest.id, tokenRow.id),
      ).rejects.toBeInstanceOf(PermissionError);

      const after = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(after[0]?.status).toBe("active");
    });

    it("extraño (sin access) → NotFoundError", async () => {
      const owner = await insertUser(
        db,
        `owner11-${Math.random()}@example.com`,
      );
      const stranger = await insertUser(
        db,
        `stranger11-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        status: "active",
      });

      await expect(
        expireToken(db, stranger.id, tokenRow.id),
      ).rejects.toBeInstanceOf(NotFoundError);

      const after = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, tokenRow.id))
        .limit(1);
      expect(after[0]?.status).toBe("active");
    });

    it("token inexistente → NotFoundError", async () => {
      const owner = await insertUser(
        db,
        `owner12-${Math.random()}@example.com`,
      );

      await expect(expireToken(db, owner.id, newId())).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
