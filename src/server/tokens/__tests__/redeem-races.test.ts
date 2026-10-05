import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { boxTokens, type SavingsBox, savingsBoxes, users } from "@/db/schema";
import { hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import {
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  TokenInvalidError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import { createToken, redeemToken } from "@/server/tokens/service";

/**
 * Rutas de carrera y de datos inconsistente de `redeemToken` (T050/T051)
 * que la suite principal no alcanza (requieren que el mundo cambie entre el
 * read inicial y el `BEGIN IMMEDIATE`):
 *
 * - Re-check dentro del lock: el token pasó de `active` a `expired`/
 *   `redeemed` justo antes del lock → `statusError` mapea cada status.
 * - Fila borrada en la carrera → `TokenInvalidError` (nunca 500).
 * - CAS vacío (alguien canjeó entre re-check y update, con el lock ya
 *   tomado) → `TokenAlreadyRedeemedError` (última línea de defensa).
 * - Token huérfano (box borrada) → `TokenInvalidError` sin filtrar nada.
 *
 * Se simulan con un Proxy de DB real cuya `transaction` muta la fila del
 * token ANTES de delegar en la transacción real, exactamente la ventana que
 * el service intenta cubrir.
 */

vi.mock("server-only", () => ({}));

describe("redeemToken — carreras y datos inconsistente (T050/T051)", () => {
  const { db, migrateOnce } = createTestDb();
  let owner: { id: string };
  let guest: { id: string };
  let box: SavingsBox;

  beforeAll(async () => {
    await migrateOnce();
    process.env.TURSO_DATABASE_URL ??= "file:./probe-race.db";

    const ownerRow = await db
      .insert(users)
      .values({
        id: newId(),
        email: "race-owner@example.com",
        passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
        name: "Owner",
      })
      .returning();
    const guestRow = await db
      .insert(users)
      .values({
        id: newId(),
        email: "race-guest@example.com",
        passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
        name: "Guest",
      })
      .returning();
    owner = ownerRow[0] as { id: string };
    guest = guestRow[0] as { id: string };

    const boxRow = await db
      .insert(savingsBoxes)
      .values({
        id: newId(),
        ownerId: owner.id,
        name: "Box de carreras",
        currency: "USD",
      })
      .returning();
    box = boxRow[0] as SavingsBox;
  });

  /** Proxy: muta el token via callback ANTES de abrir la tx real. */
  /** Proxy: muta la fila del token ANTES de abrir la tx real (sin uso del id: la mutación lo resuelve la callback). */
  function dbThatMutatesTokenBeforeLock(
    realDb: typeof db,
    mutate: () => Promise<void>,
  ) {
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: () => Promise<unknown>) => {
            return mutate().then(() => target.transaction(callback));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /** Crea un token active real y devuelve su raw + id. */
  async function createActiveToken(): Promise<{ raw: string; id: string }> {
    const { token, id } = await createToken(db, owner.id, box.id, [
      "view:transactions",
    ]);
    resetRateLimit(`redeem:${guest.id}`);
    return { raw: token, id };
  }

  it("token expirado entre el read y el lock → TokenExpiredError", async () => {
    const { raw, id } = await createActiveToken();
    const flakyDb = dbThatMutatesTokenBeforeLock(db, async () => {
      await db
        .update(boxTokens)
        .set({ status: "expired" })
        .where(eq(boxTokens.id, id));
    });

    await expect(redeemToken(flakyDb, guest.id, raw)).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });

  it("token canjeado entre el read y el lock → TokenAlreadyRedeemedError", async () => {
    const { raw, id } = await createActiveToken();
    const flakyDb = dbThatMutatesTokenBeforeLock(db, async () => {
      await db
        .update(boxTokens)
        .set({
          status: "redeemed",
          redeemedAt: Date.now(),
          redeemedBy: guest.id,
        })
        .where(eq(boxTokens.id, id));
    });

    await expect(redeemToken(flakyDb, guest.id, raw)).rejects.toBeInstanceOf(
      TokenAlreadyRedeemedError,
    );
  });

  it("fila borrada entre el read y el lock → TokenInvalidError (nunca 500)", async () => {
    const { raw, id } = await createActiveToken();
    const flakyDb = dbThatMutatesTokenBeforeLock(db, async () => {
      await db.delete(boxTokens).where(eq(boxTokens.id, id));
    });

    await expect(redeemToken(flakyDb, guest.id, raw)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it("CAS vacío (re-check ve active, el update no matchea) → TokenAlreadyRedeemedError", async () => {
    // Ventana exacta del CAS: el re-check DENTRO de la tx ve el token
    // `active`, pero entre ese select y el update otro request lo canjea.
    // Con el lock real es inalcanzable (defensa en profundidad, comentada
    // como tal en el service); acá se fuerza usando una tx real pero
    // envuelta: ANTES de correr el callback del service, un "canje
    // fantasma" marca el token redeemed; el re-check del service debe ver
    // active (le devolvemos una fila congelada) y su CAS entonces no
    // matchea → TokenAlreadyRedeemedError.
    const raw = "a".repeat(43);
    await db.insert(boxTokens).values({
      id: newId(),
      boxId: box.id,
      tokenHash: hashAccessToken(raw),
      tokenPrefix: "aaaaaaaa",
      permissions: '["view:transactions"]',
      status: "active",
      createdBy: owner.id,
    });
    resetRateLimit(`redeem:${guest.id}`);

    const sabotagedDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: (tx: unknown) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              // El service aún no corrió su re-check: "otro request"
              // canjea el token acá, dentro de la misma tx (una fila
              // visible para el update CAS, pero el service ya leyó...).
              // Para reproducir el CAS vacío exacto, el re-check del
              // service debe ver `active`: interceptamos sus selects de
              // box_tokens para devolverle una fila congelada en active,
              // mientras la fila real ya está redeemed.
              const txDb = tx as unknown as typeof db;
              const ghostRedeem = txDb
                .update(boxTokens)
                .set({
                  status: "redeemed",
                  redeemedAt: Date.now(),
                  redeemedBy: guest.id,
                })
                .where(eq(boxTokens.tokenHash, hashAccessToken(raw)));
              await ghostRedeem;

              const frozenTx = new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "select") {
                    return (...selectArgs: unknown[]) => {
                      const builder = Reflect.apply(
                        txTarget.select,
                        txTarget,
                        selectArgs,
                      ) as {
                        from: (t: unknown) => {
                          where: (w: unknown) => {
                            limit: (n: number) => Promise<unknown[]>;
                          };
                        };
                      };
                      return {
                        ...builder,
                        from: (table: unknown) => {
                          const inner = builder.from(table);
                          return {
                            ...inner,
                            where: (cond: unknown) => {
                              const innerWhere = inner.where(cond);
                              return {
                                ...innerWhere,
                                limit: async (n: number) => {
                                  const rows = await innerWhere.limit(n);
                                  // Congelo cualquier fila del token en
                                  // `active` para el re-check del service.
                                  return rows.map((row) =>
                                    row !== null &&
                                    typeof row === "object" &&
                                    "status" in row &&
                                    (row as { status?: string }).status ===
                                      "redeemed" &&
                                    "tokenHash" in row
                                      ? {
                                          ...(row as Record<string, unknown>),
                                          status: "active",
                                        }
                                      : row,
                                  );
                                },
                              };
                            },
                          };
                        },
                      };
                    };
                  }
                  return Reflect.get(txTarget, txProp, txReceiver);
                },
              });
              return callback(frozenTx);
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      redeemToken(sabotagedDb, guest.id, raw),
    ).rejects.toBeInstanceOf(TokenAlreadyRedeemedError);
  });

  it("token huérfano (box borrada) → TokenInvalidError", async () => {
    const orphanBox = await db
      .insert(savingsBoxes)
      .values({
        id: newId(),
        ownerId: owner.id,
        name: "Box efímera",
        currency: "USD",
      })
      .returning();
    const orphanBoxId = (orphanBox[0] as SavingsBox).id;

    const { token } = await createToken(db, owner.id, orphanBoxId, [
      "view:transactions",
    ]);
    resetRateLimit(`redeem:${guest.id}`);

    // Borro la box: el token queda apuntando a una box inexistente.
    await db.delete(savingsBoxes).where(eq(savingsBoxes.id, orphanBoxId));

    await expect(redeemToken(db, guest.id, token)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });
});
