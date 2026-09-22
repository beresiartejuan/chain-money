import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { type SavingsBox, savingsBoxes, users } from "@/db/schema";
import { isUuidV7, newId } from "@/lib/ids";
import { createBox, MAX_BOXES_PER_USER } from "@/server/boxes/service";
import { LimitReachedError, ValidationError } from "@/server/errors";

/**
 * T041/T042 — creación de alcancías contra DB real (SQLite temporal con las
 * migraciones de `drizzle/`). El service es puro respecto al request: recibe
 * la db y el userId, así que se testa directo; la capa de sesión vive en
 * `actions.ts`/`session.ts` y no se cubre acá.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `src/server/auth/__tests__/service.test.ts`). Vitest hoistea `vi.mock`
// al tope del archivo.
vi.mock("server-only", () => ({}));

const VALID_INPUT = { name: "Vacaciones 2027", currency: "USD" };

/**
 * Usuario seed: owner de las alcancías de test. Devuelve el user insertado
 * para que cada test trabaje contra SU propio owner (sin compartir estado
 * entre tests).
 */
async function insertUser(
  db: Parameters<typeof createBox>[0],
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: `seed-${Date.now()}-${Math.random()}@example.com`,
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

async function countBoxes(
  db: Parameters<typeof createBox>[0],
  ownerId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(savingsBoxes)
    .where(eq(savingsBoxes.ownerId, ownerId));
  return rows.length;
}

describe("createBox (T041/T042)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("happy path: crea box con UUIDv7, moneda guardada y timestamps", async () => {
    const owner = await insertUser(db);

    const before = Date.now();
    const box = await createBox(db, owner.id, { ...VALID_INPUT });

    expect(isUuidV7(box.id)).toBe(true);
    expect(box.ownerId).toBe(owner.id);
    expect(box.name).toBe(VALID_INPUT.name);
    expect(box.currency).toBe("USD");
    expect(box.createdAt).toBeGreaterThanOrEqual(before);
    expect(box.updatedAt).toBeGreaterThanOrEqual(before);

    const stored = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.id, box.id))
      .limit(1);
    expect(stored).toHaveLength(1);
    const saved = stored[0] as SavingsBox;
    expect(saved.currency).toBe("USD");
    expect(saved.name).toBe(VALID_INPUT.name);
  });

  it("hace trim del nombre antes de guardar", async () => {
    const owner = await insertUser(db);

    const box = await createBox(db, owner.id, {
      name: "  Viaje  ",
      currency: "EUR",
    });
    expect(box.name).toBe("Viaje");
  });

  it("rechaza nombre vacío y solo espacios con ValidationError por campo", async () => {
    const owner = await insertUser(db);

    for (const name of ["", "   "]) {
      await expect(
        createBox(db, owner.id, { name, currency: "USD" }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.code).toBe("validation");
        expect(ve.fieldErrors.name).toBeDefined();
        expect(ve.fieldErrors.currency).toBeUndefined();
        return true;
      });
    }
  });

  it("rechaza nombre de 81+ chars; 80 exacto pasa", async () => {
    const owner = await insertUser(db);

    await expect(
      createBox(db, owner.id, {
        name: "a".repeat(81),
        currency: "USD",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.code).toBe("validation");
      expect(ve.fieldErrors.name).toBeDefined();
      expect(ve.fieldErrors.currency).toBeUndefined();
      return true;
    });

    const box = await createBox(db, owner.id, {
      name: "a".repeat(80),
      currency: "USD",
    });
    expect(box.name).toHaveLength(80);
  });

  it("rechaza moneda no soportada ('XYZ', lowercase 'usd') con fieldErrors", async () => {
    const owner = await insertUser(db);

    for (const currency of ["XYZ", "usd"]) {
      await expect(
        createBox(db, owner.id, { name: "Caja", currency }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        const ve = error as ValidationError;
        expect(ve.code).toBe("validation");
        expect(ve.fieldErrors.currency).toBeDefined();
        expect(ve.fieldErrors.name).toBeUndefined();
        return true;
      });
    }
  });

  it("valida ambos campos a la vez (acumula fieldErrors)", async () => {
    const owner = await insertUser(db);

    await expect(
      createBox(db, owner.id, { name: "", currency: "XYZ" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.fieldErrors.name).toBeDefined();
      expect(ve.fieldErrors.currency).toBeDefined();
      return true;
    });
  });

  it("no inserta nada si la validación falla", async () => {
    const owner = await insertUser(db);

    await expect(
      createBox(db, owner.id, { name: "", currency: "USD" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(countBoxes(db, owner.id)).resolves.toBe(0);
  });

  it("rechaza userId inexistente con error claro (sin insertar)", async () => {
    const fakeUserId = newId();
    await expect(createBox(db, fakeUserId, { ...VALID_INPUT })).rejects.toThrow(
      /no existe el usuario/i,
    );
    const rows = await db
      .select()
      .from(savingsBoxes)
      .where(eq(savingsBoxes.ownerId, fakeUserId));
    expect(rows).toHaveLength(0);
  });

  it("respeta el límite: 5 OK y la 6ta lanza LimitReachedError (code limit_reached)", async () => {
    const owner = await insertUser(db);

    for (let i = 0; i < MAX_BOXES_PER_USER; i++) {
      await createBox(db, owner.id, {
        name: `Box ${i}`,
        currency: "USD",
      });
    }

    await expect(
      createBox(db, owner.id, { name: "La 6ta", currency: "USD" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(LimitReachedError);
      const lre = error as LimitReachedError;
      expect(lre.code).toBe("limit_reached");
      return true;
    });
    await expect(countBoxes(db, owner.id)).resolves.toBe(MAX_BOXES_PER_USER);
  });

  it("el límite es por usuario: otro user con 0 boxes puede crear", async () => {
    const first = await insertUser(db);
    const second = await insertUser(db);

    for (let i = 0; i < MAX_BOXES_PER_USER; i++) {
      await createBox(db, first.id, { name: `Box ${i}`, currency: "USD" });
    }
    const box = await createBox(db, second.id, {
      name: "Del otro user",
      currency: "USD",
    });
    expect(box.ownerId).toBe(second.id);
    await expect(countBoxes(db, second.id)).resolves.toBe(1);
  });

  it("carrera concurrente: 10 creates simultáneos → exactamente 5 succeed, 5 LimitReachedError, total 5 en DB", async () => {
    const owner = await insertUser(db);

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createBox(db, owner.id, {
          name: `Race ${i}`,
          currency: "USD",
        }),
      ),
    );

    const succeeded = attempts.filter(
      (r): r is PromiseFulfilledResult<SavingsBox> => r.status === "fulfilled",
    );
    const limitReached = attempts.filter(
      (r): r is PromiseRejectedResult =>
        r.status === "rejected" && r.reason instanceof LimitReachedError,
    );
    // Sin errores inesperados: solo éxitos o LimitReachedError.
    expect(succeeded.length + limitReached.length).toBe(10);

    expect(succeeded.length).toBe(MAX_BOXES_PER_USER);
    expect(limitReached.length).toBe(10 - MAX_BOXES_PER_USER);

    await expect(countBoxes(db, owner.id)).resolves.toBe(MAX_BOXES_PER_USER);
  });

  it("carrera concurrente con 5 existentes: 0 succeed, todo LimitReachedError, sin over-limit", async () => {
    const owner = await insertUser(db);

    for (let i = 0; i < MAX_BOXES_PER_USER; i++) {
      await createBox(db, owner.id, {
        name: `Pre ${i}`,
        currency: "USD",
      });
    }

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        createBox(db, owner.id, {
          name: `Over ${i}`,
          currency: "USD",
        }),
      ),
    );

    for (const attempt of attempts) {
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(LimitReachedError);
      }
    }
    await expect(countBoxes(db, owner.id)).resolves.toBe(MAX_BOXES_PER_USER);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
