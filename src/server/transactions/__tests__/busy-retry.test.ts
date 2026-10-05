import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { createBox } from "@/server/boxes/service";
import { NotFoundError } from "@/server/errors";
import { createTransaction, resetBox } from "@/server/transactions/service";
import { insertUser, sumBalance } from "./helpers";

/**
 * Reintentos ante `SQLITE_BUSY` en `createTransaction` (withdraw) y
 * `resetBox` (T055–T059): ambos envuelven su escritura en `BEGIN IMMEDIATE`
 * y reintentan hasta `BUSY_RETRY_MAX_ATTEMPTS` ante contention del driver.
 * Lo mismo que `busy-retry.test.ts` de boxes: Proxy sobre la DB real que
 * falla las primeras N `transaction` con `code = "SQLITE_BUSY"` y delega el
 * resto, sin cambiar el resultado observable.
 *
 * Cubre además `isSqliteBusyError` recorriendo `error.cause` (el driver
 * envuelve el error original) y el `LimitReached`-análogo: un
 * `InsufficientFundsError` NO se reintenta aunque venga del wrapper.
 */

vi.mock("server-only", () => ({}));

function busyError(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY",
  });
}

describe("transactions — retry ante SQLITE_BUSY (T055–T059)", () => {
  const { db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
    process.env.TURSO_DATABASE_URL ??= "file:./probe-tx-busy.db";
  });

  /** Proxy: la 1ª llamada a `transaction` rechaza SQLITE_BUSY, el resto pasa. */
  function dbBusyOnce(realDb: typeof db) {
    let calls = 0;
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: () => Promise<unknown>) => {
            calls += 1;
            if (calls === 1) {
              return Promise.reject(busyError());
            }
            return target.transaction(callback);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /** Proxy: SQLITE_BUSY anidado en `cause` (así lo envuelve el driver). */
  function dbBusyNestedOnce(realDb: typeof db) {
    let calls = 0;
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: () => Promise<unknown>) => {
            calls += 1;
            if (calls === 1) {
              return Promise.reject(
                new Error("tx wrapper", { cause: busyError() }),
              );
            }
            return target.transaction(callback);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  it("withdraw: 1er SQLITE_BUSY, reintento inserta y respeta el balance", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Busy withdraw",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "100",
    });

    const flakyDb = dbBusyOnce(db);
    const tx = await createTransaction(flakyDb, owner.id, box.id, {
      type: "withdraw",
      amount: "40",
    });
    expect(tx.type).toBe("withdraw");
    expect(await sumBalance(db, box.id)).toBe(60_00);
  });

  it("withdraw: SQLITE_BUSY anidado en cause también dispara el retry", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Busy nested",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "50",
    });

    const flakyDb = dbBusyNestedOnce(db);
    const tx = await createTransaction(flakyDb, owner.id, box.id, {
      type: "withdraw",
      amount: "10",
    });
    expect(tx.id).toBeTruthy();
    expect(await sumBalance(db, box.id)).toBe(40_00);
  });

  it("withdraw: InsufficientFundsError no se reintenta (respuesta de dominio)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Busy funds",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

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
      createTransaction(countingDb, owner.id, box.id, {
        type: "withdraw",
        amount: "11",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("insufficient_funds");
      return true;
    });
    // La tx corrió 1 vez: InsufficientFunds sale directo, sin backoff.
    expect(calls).toBe(1);
  });

  it("deposit no toca transaction: no hay retry posible", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Busy deposit",
      currency: "USD",
    });

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

    const tx = await createTransaction(countingDb, owner.id, box.id, {
      type: "deposit",
      amount: "5",
    });
    expect(tx.type).toBe("deposit");
    expect(calls).toBe(0);
  });

  it("resetBox: 1er SQLITE_BUSY, reintento resetea igual", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Busy reset",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "30",
    });

    const flakyDb = dbBusyOnce(db);
    const result = await resetBox(flakyDb, owner.id, box.id);
    expect(result).toEqual({ ok: true, reset: true, balanceMinor: 0 });
    expect(await sumBalance(db, box.id)).toBe(0);
  });

  it("resetBox: box inexistente → NotFoundError sin reintentar", async () => {
    const owner = await insertUser(db);
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
      resetBox(countingDb, owner.id, "box-inexistente"),
    ).rejects.toBeInstanceOf(NotFoundError);
    // El gate de permisos corre antes de la tx: 0 llamadas.
    expect(calls).toBe(0);
  });

  it("error inesperado (ni busy ni dominio) se propaga sin reintentar — withdraw", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Exploding withdraw",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    let calls = 0;
    const explodingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return () => {
            calls += 1;
            return Promise.reject(new Error("connection reset by peer"));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      createTransaction(explodingDb, owner.id, box.id, {
        type: "withdraw",
        amount: "1",
      }),
    ).rejects.toThrowError("connection reset by peer");
    expect(calls).toBe(1); // sin retry: solo SQLITE_BUSY reintenta
  });

  it("error inesperado (ni busy ni dominio) se propaga sin reintentar — resetBox", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Exploding reset",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    let calls = 0;
    const explodingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return () => {
            calls += 1;
            return Promise.reject(new Error("connection reset by peer"));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(resetBox(explodingDb, owner.id, box.id)).rejects.toThrowError(
      "connection reset by peer",
    );
    expect(calls).toBe(1);
  });
});
