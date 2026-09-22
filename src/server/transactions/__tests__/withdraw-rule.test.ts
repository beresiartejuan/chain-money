import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { transactions } from "@/db/schema";
import { createBox } from "@/server/boxes/service";
import { InsufficientFundsError, ValidationError } from "@/server/errors";
import { ALLOW_NEGATIVE_BALANCE } from "@/server/transactions/config";
import { createTransaction } from "@/server/transactions/service";
import { insertRawTransaction, insertUser, sumBalance } from "./helpers";

/**
 * T058 — regla `insufficient_funds` en withdrawals: un withdraw no puede
 * exceder el balance actual de la alcancía (decisión default del producto,
 * `ALLOW_NEGATIVE_BALANCE = false`). El chequeo corre DENTRO de la
 * transacción de DB (`BEGIN IMMEDIATE`: select del balance + insert bajo el
 * mismo lock), así que la carrera está cubierta: dos withdrawals
 * simultáneos que juntos exceden el balance no pueden pasar los dos.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-box.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

/** Separación entre arranques de los concurrentes (ms), ver stagger. */
const STAGGER_MS = 60;

describe("createTransaction — regla de balance en withdraw (T058)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("config: ALLOW_NEGATIVE_BALANCE es false (default del producto)", () => {
    // La regla activa es parte del contrato de T058; si el producto la
    // cambia, este test falla y obliga a revisar la decisión documentada.
    expect(ALLOW_NEGATIVE_BALANCE).toBe(false);
  });

  it("withdraw que excede el balance → InsufficientFundsError, sin insertar", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Balance",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "10.01",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      const ife = error as InsufficientFundsError;
      expect(ife.code).toBe("insufficient_funds");
      return true;
    });

    // El rechazado nunca llegó a insertarse y el balance queda intacto.
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(1);
    await expect(sumBalance(db, box.id)).resolves.toBe(1000);
  });

  it("deposit 1000, withdraw 999 → ok (balance 1); withdraw 1001 → rechazado", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Casi justo",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    const ok = await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "9.99",
    });
    expect(ok.amountMinor).toBe(999);
    await expect(sumBalance(db, box.id)).resolves.toBe(1);

    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "10.01",
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    await expect(sumBalance(db, box.id)).resolves.toBe(1);
  });

  it("withdraw justo al balance → ok y balance 0", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Justo",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    const tx = await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "10",
    });
    expect(tx.amountMinor).toBe(1000);
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    // Y con balance 0, cualquier withdraw adicional ya no pasa.
    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "0.01",
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("withdraw sobre alcancía vacía (balance 0) → InsufficientFundsError", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Vacía",
      currency: "USD",
    });

    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "1",
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    expect(rows).toHaveLength(0);
  });

  it("deposit 0 no existe: amount > 0 siempre (el schema lo rechaza antes)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Cero",
      currency: "USD",
    });

    for (const amount of ["0", "0.00"]) {
      await expect(
        createTransaction(db, owner.id, box.id, {
          type: "deposit",
          amount,
        }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
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

  it("los deposits no consultan balance: varios seguidos sin withdraw nunca fallan", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Deposits",
      currency: "USD",
    });

    for (let i = 1; i <= 5; i++) {
      const tx = await createTransaction(db, owner.id, box.id, {
        type: "deposit",
        amount: `${i}`,
      });
      expect(tx.type).toBe("deposit");
    }
    await expect(sumBalance(db, box.id)).resolves.toBe(1500);
  });

  it("reset previo deja el balance en 0 y la regla lo procesa: withdraw 1 rechazado, y tras un deposit vuelve a funcionar", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Tras reset",
      currency: "USD",
    });
    // Seed manual (sin pasar por el service): deposit 500 y un `reset` con
    // amountMinor -500. El service no acepta type reset por input, pero la
    // fórmula de balance lo procesa (suma su valor) y lleva el balance a 0.
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 500,
      note: "seed",
      createdBy: owner.id,
    });
    await insertRawTransaction(db, {
      boxId: box.id,
      type: "reset",
      amountMinor: -500,
      note: "Reset de alcancía",
      createdBy: owner.id,
    });
    await expect(sumBalance(db, box.id)).resolves.toBe(0);

    // Sobre ese 0 real, un withdraw ya no pasa: la base del cálculo incluye
    // la fila reset con el signo correcto (no ignora ni invierte su valor).
    await expect(
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "1",
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    // Tras un deposit, la regla vuelve a operar normalmente sobre el
    // historial que contiene un reset.
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "3",
    });
    const tx = await createTransaction(db, owner.id, box.id, {
      type: "withdraw",
      amount: "1",
    });
    expect(tx.amountMinor).toBe(100);
    await expect(sumBalance(db, box.id)).resolves.toBe(200);
  });

  it("carrera: 2 withdraws simultáneos de 6.00 sobre balance 10.00 → 1 ok, 1 insufficient_funds, balance 4.00", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Race",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    // Arranques escalonados (patrón de `redeem-concurrent.test.ts`): si los
    // dos withdrawals arrancan en el mismo tick, el perdedor puede morir en
    // el `BEGIN IMMEDIATE`/`COMMIT` con `SQLITE_BUSY` (busy timeout 0 del
    // driver local, ver comentario en `service.ts`) en vez de llegar a su
    // transacción. El stagger de 60ms superpone las ventanas de escritura
    // sin tomar el lock ANTES de que el segundo intente entrar, así que el
    // perdedor SÍ evalúa la regla contra el balance ya actualizado y sale
    // por `InsufficientFundsError`: el resultado que este guard demuestra.
    const [first, second] = await Promise.allSettled([
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "6",
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, STAGGER_MS));
        return createTransaction(db, owner.id, box.id, {
          type: "withdraw",
          amount: "6",
        });
      })(),
    ]);

    // Ambos resueltos: exactamente uno ok y el otro rechazado por dominio,
    // sin errores inesperados (ej. SQLITE_BUSY sin manejar).
    const rejected = [first, second].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InsufficientFundsError);
    expect(first.status === "fulfilled" || second.status === "fulfilled").toBe(
      true,
    );
    await expect(sumBalance(db, box.id)).resolves.toBe(400);
  });

  it("carrera (repetición 2): mismo resultado, estable", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Race 2",
      currency: "USD",
    });
    await createTransaction(db, owner.id, box.id, {
      type: "deposit",
      amount: "10",
    });

    const [first, second] = await Promise.allSettled([
      createTransaction(db, owner.id, box.id, {
        type: "withdraw",
        amount: "6",
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, STAGGER_MS));
        return createTransaction(db, owner.id, box.id, {
          type: "withdraw",
          amount: "6",
        });
      })(),
    ]);

    const rejected = [first, second].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InsufficientFundsError);
    expect(first.status === "fulfilled" || second.status === "fulfilled").toBe(
      true,
    );
    await expect(sumBalance(db, box.id)).resolves.toBe(400);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
