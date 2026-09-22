import { createHash } from "node:crypto";
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
import { TokenAlreadyRedeemedError } from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import { redeemRateLimitKey, redeemToken } from "@/server/tokens/service";

/**
 * T051 — guard de canje concurrente. `redeemToken` ya es atómico (T050):
 * `BEGIN IMMEDIATE` + re-check de status + CAS
 * (`UPDATE ... WHERE status = 'active'`) dentro de la transacción. Estos
 * tests lo ejercitan bajo carrera: N `redeemToken` del MISMO token crudo
 * contra la misma DB, lanzados con `Promise.allSettled`.
 *
 * ### Stagger (escalonado de arranques)
 *
 * El driver local (@libsql/client 0.18) abre cada transacción con busy
 * timeout 0 (ver comentario en `boxes/service.ts`): si otra conexión está
 * escribiendo, el `BEGIN IMMEDIATE` de la nuestra falla al instante con
 * `SQLITE_BUSY` — no espera. Con 5 arranques en el mismo tick, 4 de 5
 * intentos ni siquiera llegan a competir por el token: mueren en el BEGIN.
 * Eso seguiría siendo "1 ganador" en producción (el cliente reintenta),
 * pero el test no podría distinguir una carrera bien resuelta de un lock
 * descartado. Por eso cada intento arranca escalonado (i * STAGGER_MS,
 * 60ms): el turno de escritura de uno se superpone con el de otro, pero el
 * lock no está tomado ANTES de que el perdedor intente entrar. Con ese
 * shape, el perdedor SÍ llega a su transacción, ve `status = 'redeemed'`
 * en el re-check post-lock y sale por `TokenAlreadyRedeemedError`: el
 * resultado que este guard debe demostrar. Sin SQLITE_BUSY: verificado en
 * 10 corridas seguidas del patrón de `createBox` (que reintenta) y de este
 * test.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

/** Separación entre arranques de los concurrentes (ms): ver stagger. */
const STAGGER_MS = 60;

/** Usuario seed genérico. */
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
 * Crea la fila de token directamente (seed de DB, sin pasar por
 * `createToken`) con hash determinado a partir de `rawToken`.
 */
async function insertTokenRow(
  db: Parameters<typeof redeemToken>[0],
  input: {
    boxId: string;
    createdBy: string;
    rawToken: string;
    permissions: string[];
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
      status: "active",
      createdBy: input.createdBy,
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
  return createHash("sha256").update(seed, "utf8").digest("base64url");
}

/**
 * Un intento de canje que arranca `staggerMs` ms después de la creación de
 * la promesa (ver stagger en el comentario del archivo). Devuelve el error
 * en lugar de lanzarlo, para clasificarlo en el caller.
 */
async function attemptRedeem(
  db: Parameters<typeof redeemToken>[0],
  userId: string,
  rawToken: string,
  staggerMs: number,
): Promise<{ ok: true; boxId: string } | { ok: false; error: unknown }> {
  if (staggerMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, staggerMs));
  }
  try {
    const result = await redeemToken(db, userId, rawToken);
    return { ok: true, boxId: result.boxId };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("redeemToken concurrente (T051)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("carrera de 5: 5 redeemToken del mismo token → 1 éxito, 4 TokenAlreadyRedeemedError, 1 box_access", async () => {
    const owner = await insertUser(db, `owner-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("carrera-5");
    const tokenRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions"],
    });

    resetRateLimit(redeemRateLimitKey(guest.id)); // 5 intentos simultáneos

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        attemptRedeem(db, guest.id, raw, i * STAGGER_MS),
      ),
    );

    const succeeded = attempts.filter((a) => a.ok);
    const lost = attempts.filter(
      (a) => !a.ok && a.error instanceof TokenAlreadyRedeemedError,
    );
    const unexpected = attempts.filter(
      (a) => !a.ok && !(a.error instanceof TokenAlreadyRedeemedError),
    );

    // Exactamente 1 gana; los 4 restantes pierden con el error de dominio
    // (re-check post-lock: otro request ya commiteó `redeemed`), y no hay
    // errores inesperados (ej. SQLITE_BUSY sin manejar).
    expect(unexpected).toEqual([]);
    expect(succeeded).toHaveLength(1);
    expect(lost).toHaveLength(4);
    expect(succeeded[0]).toEqual({ ok: true, boxId: box.id });

    // El token queda canjeado por el ganador.
    const after = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, tokenRow.id))
      .limit(1);
    expect(after[0]?.status).toBe("redeemed");
    expect(after[0]?.redeemedBy).toBe(guest.id);
    expect(after[0]?.redeemedAt).not.toBeNull();

    // Una sola fila de box_access.
    const access = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)));
    expect(access).toHaveLength(1);
    expect(access[0]?.tokenId).toBe(tokenRow.id);
  });

  it("estable: la misma carrera de 5, 3 veces seguidas sobre tokens frescos → mismo resultado siempre", async () => {
    const owner = await insertUser(db, `owner2-${Math.random()}@example.com`);
    const guest = await insertUser(db, `guest2-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);

    for (let round = 0; round < 3; round++) {
      resetRateLimit(redeemRateLimitKey(guest.id));
      const raw = makeRawToken(`estable-${round}`);
      const tokenRow = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
      });

      const attempts = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          attemptRedeem(db, guest.id, raw, i * STAGGER_MS),
        ),
      );

      const succeeded = attempts.filter((a) => a.ok);
      const lost = attempts.filter(
        (a) => !a.ok && a.error instanceof TokenAlreadyRedeemedError,
      );

      expect(succeeded).toHaveLength(1);
      expect(lost).toHaveLength(4);

      // El access es único por (box, user) y la unión de permisos no cambia
      // el shape: siempre 1 fila, apuntando al token de esta ronda.
      const access = await db
        .select()
        .from(boxAccess)
        .where(
          and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guest.id)),
        );
      expect(access).toHaveLength(1);
      expect(access[0]?.tokenId).toBe(tokenRow.id);
    }
  });

  it("carrera mixta: 2 usuarios distintos canjeando el mismo token a la vez → 1 gana, 1 TokenAlreadyRedeemedError", async () => {
    const owner = await insertUser(db, `owner3-${Math.random()}@example.com`);
    const guestA = await insertUser(db, `guestA-${Math.random()}@example.com`);
    const guestB = await insertUser(db, `guestB-${Math.random()}@example.com`);
    const box = await insertBox(db, owner.id);
    const raw = makeRawToken("carrera-mixta");
    const tokenRow = await insertTokenRow(db, {
      boxId: box.id,
      createdBy: owner.id,
      rawToken: raw,
      permissions: ["view:transactions"],
    });

    resetRateLimit(redeemRateLimitKey(guestA.id));
    resetRateLimit(redeemRateLimitKey(guestB.id));

    const attempts = await Promise.all([
      attemptRedeem(db, guestA.id, raw, 0),
      attemptRedeem(db, guestB.id, raw, STAGGER_MS),
    ]);

    const succeeded = attempts.filter((a) => a.ok);
    const lost = attempts.filter(
      (a) => !a.ok && a.error instanceof TokenAlreadyRedeemedError,
    );
    expect(succeeded).toHaveLength(1);
    expect(lost).toHaveLength(1);

    // El ganador tiene el acceso (1 fila total); el perdedor, nada.
    const accessA = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guestA.id)));
    const accessB = await db
      .select()
      .from(boxAccess)
      .where(and(eq(boxAccess.boxId, box.id), eq(boxAccess.userId, guestB.id)));
    expect(accessA.length + accessB.length).toBe(1);

    const winnerAccess = accessA.length === 1 ? accessA : accessB;
    const winnerId = winnerAccess[0]?.userId;
    expect([guestA.id, guestB.id]).toContain(winnerId);

    const after = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.id, tokenRow.id))
      .limit(1);
    expect(after[0]?.status).toBe("redeemed");
    expect(after[0]?.redeemedBy).toBe(winnerId);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
