import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createBox } from "@/server/boxes/service";
import { LimitReachedError } from "@/server/errors";

/**
 * Reintentos ante `SQLITE_BUSY` en `createBox` (T041/T042): el service
 * envuelve el chequeo de límite + insert en `BEGIN IMMEDIATE`; si otra
 * transacción sostiene el lock, el driver lanza con `code = "SQLITE_BUSY"`
 * (o dentro de la cadena de `cause`) y el loop reintenta hasta
 * `BUSY_RETRY_MAX_ATTEMPTS` con backoff corto, hasta que la de dominio
 * `LimitReachedError` NO se reintenta.
 *
 * Reproducir contention real es frágil y lento; acá se simula con un Proxy
 * sobre la DB real: la 1ª llamada a `db.transaction` rechaza con
 * `SQLITE_BUSY` y las siguientes delegan al driver real. Así se cubren las
 * rutas de retry (`isSqliteBusyError` sobre el wrapper, `delay`, 2ª pasada,
 * `lastError`) sin cambiar el resultado observable: la box se crea igual.
 */

vi.mock("server-only", () => ({}));

/** Error que simula el SQLITE_BUSY del driver (con `code`, como libSQL). */
function busyError(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY",
  });
}

describe("createBox — retry ante SQLITE_BUSY (T041/T042)", () => {
  const { db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
    process.env.TURSO_DATABASE_URL ??= "file:./probe-busy.db";
  });

  async function insertSeedUser(): Promise<{ id: string }> {
    const inserted = await db
      .insert(users)
      .values({
        id: newId(),
        email: `busy-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
        name: "Seed",
      })
      .returning();
    const user = inserted[0];
    if (!user) throw new Error("Failed to insert seed user");
    return { id: user.id };
  }

  /** DB real envuelta en un Proxy que falla las primeras N transactions. */
  function dbBusyFirstN(realDb: typeof db, failTimes: number) {
    let calls = 0;
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: () => Promise<unknown>) => {
            calls += 1;
            if (calls <= failTimes) {
              return Promise.reject(busyError());
            }
            return target.transaction(callback);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  it("1er intento SQLITE_BUSY, 2º reintento crea la box", async () => {
    const user = await insertSeedUser();
    const flakyDb = dbBusyFirstN(db, 1);

    const box = await createBox(flakyDb, user.id, {
      name: "Contendida",
      currency: "USD",
    });
    expect(box.id).toBeTruthy();
    expect(box.name).toBe("Contendida");
  });

  it("2 SQLITE_BUSY seguidos: el 3er intento (último permitido) crea la box", async () => {
    const user = await insertSeedUser();
    const flakyDb = dbBusyFirstN(db, 2);

    const box = await createBox(flakyDb, user.id, {
      name: "Contendida 2",
      currency: "EUR",
    });
    expect(box.id).toBeTruthy();
  });

  it("BUSY en las 3 attempts → el último error (lastError) se propaga", async () => {
    const user = await insertSeedUser();
    const flakyDb = dbBusyFirstN(db, 3);

    await expect(
      createBox(flakyDb, user.id, { name: "Always busy", currency: "USD" }),
    ).rejects.toThrowError("database is locked");
  });

  it("LimitReachedError no se reintenta: sale directo aunque el wrapper vea la transaction", async () => {
    const user = await insertSeedUser();
    // Lleno el cupo (5) con la DB real; el 6º debe fallar por dominio aunque
    // ningún SQLITE_BUSY esté en juego.
    for (let i = 0; i < 5; i += 1) {
      await createBox(db, user.id, {
        name: `Llenado ${i}`,
        currency: "USD",
      });
    }
    let calls = 0;
    const countingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: () => Promise<unknown>) => {
            calls += 1;
            return target.transaction(callback);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      createBox(countingDb, user.id, { name: "Extra", currency: "USD" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(LimitReachedError);
      return true;
    });
    // La tx corrió (contó) exactamente 1 vez: sin reintentos por dominio.
    expect(calls).toBe(1);
  });
});
