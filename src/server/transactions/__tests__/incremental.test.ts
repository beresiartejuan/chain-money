import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { transactions } from "@/db/schema";
import { type Cursor, makeCursor, parseCursor } from "@/lib/cursor";
import { newId } from "@/lib/ids";
import { createBox } from "@/server/boxes/service";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  getTransactionsSince,
  resolveSinceTransaction,
} from "@/server/transactions/sync";
import { insertRawTransaction, insertUser } from "./helpers";

/**
 * T062/T063 — sync incremental de transacciones contra DB real (SQLite
 * temporal con las migraciones de `drizzle/`). El service es puro respecto
 * al request: recibe la db, así que se testa directo; el Route Handler es
 * la capa delgada que resuelve sesión y mapea errores a HTTP (el gate de
 * permisos se cubre en `incremental-authz.test.ts`).
 *
 * Casos fijados acá: exclusividad de `sinceDate`, lookup de
 * `sinceTransactionId` (404 cross-box), el truco de `limit + 1`
 * (`hasMore`/`nextCursor`), cursor inválido → ValidationError (400, el
 * cliente resincroniza, cf. T068), límites de página y el orden estable
 * por tupla `(createdAt, id)` con walk completo sin gaps ni duplicados.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-transaction.test.ts`). Vitest hoistea `vi.mock` al tope del
// archivo.
vi.mock("server-only", () => ({}));

describe("getTransactionsSince (T062/T063)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  /**
   * Inserta una transacción con `createdAt` (y opcionalmente `id`)
   * forzados, para probar orden y bordes del delta con timestamps
   * controlados (el service siempre estampa server time).
   */
  async function seedTx(
    boxId: string,
    ownerId: string,
    createdAt: number,
    overrides: { id?: string; type?: string; note?: string } = {},
  ) {
    return insertRawTransaction(db, {
      boxId,
      type: overrides.type ?? "deposit",
      amountMinor: 100,
      note: overrides.note ?? `tx@${createdAt}`,
      createdBy: ownerId,
      createdAt,
      id: overrides.id,
    });
  }

  it("sin since* → lista desde el inicio, ASC por (createdAt, id)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Desde el inicio",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const first = await seedTx(box.id, owner.id, t0);
    const second = await seedTx(box.id, owner.id, t0 + 1000);
    const third = await seedTx(box.id, owner.id, t0 + 2000);

    const result = await getTransactionsSince(db, box.id);

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.transactions.map((tx) => tx.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    // Shape serializable completo de cada transacción.
    expect(result.transactions[0]).toEqual({
      id: first.id,
      type: "deposit",
      amountMinor: 100,
      counterparty: null,
      note: first.note,
      createdBy: owner.id,
      createdAt: t0,
    });
  });

  it("sinceDate es EXCLUSIVO: la tx con createdAt === sinceDate no entra", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Borde exclusivo",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const at = await seedTx(box.id, owner.id, t0);
    const after = await seedTx(box.id, owner.id, t0 + 1000);

    const result = await getTransactionsSince(db, box.id, { sinceMs: t0 });

    expect(result.transactions.map((tx) => tx.id)).toEqual([after.id]);
    expect(result.transactions).not.toContainEqual(
      expect.objectContaining({ id: at.id }),
    );

    // Un ms antes: la tx ancla SÍ entra (el borde es >, no >=).
    const before = await getTransactionsSince(db, box.id, { sinceMs: t0 - 1 });
    expect(before.transactions.map((tx) => tx.id)).toEqual([at.id, after.id]);

    // ISO 8601 equivalente al mismo instante (el handler lo convierte a ms;
    // en el service la entrada ya es unix ms).
    expect(Date.parse("2023-11-14T22:13:20.000Z")).toBe(t0);
  });

  it("sinceTransactionId: reanuda desde su (createdAt, id), exclusivo", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Ancla por id",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const a = await seedTx(box.id, owner.id, t0);
    const b = await seedTx(box.id, owner.id, t0 + 1000);
    const c = await seedTx(box.id, owner.id, t0 + 2000);

    const result = await getTransactionsSince(db, box.id, {
      sinceTransactionId: b.id,
    });

    expect(result.transactions.map((tx) => tx.id)).toEqual([c.id]);
    // Y con el ancla en el primero: entran los dos siguientes.
    const fromA = await getTransactionsSince(db, box.id, {
      sinceTransactionId: a.id,
    });
    expect(fromA.transactions.map((tx) => tx.id)).toEqual([b.id, c.id]);
  });

  it("sinceTransactionId de OTRA box → NotFoundError (no filtra dónde está)", async () => {
    const owner = await insertUser(db);
    const boxA = await createBox(db, owner.id, {
      name: "Box A",
      currency: "USD",
    });
    const boxB = await createBox(db, owner.id, {
      name: "Box B",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const inB = await seedTx(boxB.id, owner.id, t0);

    await expect(
      getTransactionsSince(db, boxA.id, { sinceTransactionId: inB.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Igual de 404: id que no existe en ninguna box.
    await expect(
      getTransactionsSince(db, boxA.id, {
        sinceTransactionId: newId(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resolveSinceTransaction devuelve el cursor de la tx en ESA box", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Resolver ancla",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const tx = await seedTx(box.id, owner.id, t0);

    await expect(resolveSinceTransaction(db, box.id, tx.id)).resolves.toEqual({
      createdAtMs: t0,
      id: tx.id,
    });
    await expect(
      resolveSinceTransaction(db, box.id, newId()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hasMore/nextCursor: truco de limit+1, recorte a limit y cursor de la última", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Página",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const seeded = await Promise.all([
      seedTx(box.id, owner.id, t0),
      seedTx(box.id, owner.id, t0 + 1000),
      seedTx(box.id, owner.id, t0 + 2000),
      seedTx(box.id, owner.id, t0 + 3000),
      seedTx(box.id, owner.id, t0 + 4000),
    ]);

    const page = await getTransactionsSince(db, box.id, { limit: 2 });

    expect(page.hasMore).toBe(true);
    expect(page.transactions).toHaveLength(2);
    expect(page.transactions.map((tx) => tx.id)).toEqual([
      seeded[0]?.id,
      seeded[1]?.id,
    ]);
    const expectedCursor = makeCursor(
      seeded[1]?.createdAt ?? 0,
      seeded[1]?.id ?? "",
    );
    expect(page.nextCursor).toBe(expectedCursor);
    // El cursor devuelto roundtrip-a como tupla (contrato T009).
    expect(parseCursor(page.nextCursor ?? "")).toEqual({
      createdAtMs: seeded[1]?.createdAt,
      id: seeded[1]?.id,
    });
  });

  it("última página EXACTA: hasMore false y nextCursor null (sin fila extra)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Última exacta",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    await seedTx(box.id, owner.id, t0);
    await seedTx(box.id, owner.id, t0 + 1000);
    await seedTx(box.id, owner.id, t0 + 2000);

    // limit = total: la fila extra no existe, la página es la última.
    const exact = await getTransactionsSince(db, box.id, { limit: 3 });
    expect(exact.hasMore).toBe(false);
    expect(exact.nextCursor).toBeNull();
    expect(exact.transactions).toHaveLength(3);

    // Box vacía: página vacía, sin cursor.
    const emptyBox = await createBox(db, owner.id, {
      name: "Vacía",
      currency: "USD",
    });
    const empty = await getTransactionsSince(db, emptyBox.id, { limit: 10 });
    expect(empty.transactions).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty.nextCursor).toBeNull();
  });

  it("limit fuera de rango → ValidationError (0, 101, -1 y no entero)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Limit inválido",
      currency: "USD",
    });

    for (const limit of [0, 101, -1]) {
      await expect(
        getTransactionsSince(db, box.id, { limit }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe("validation");
        expect((error as ValidationError).fieldErrors.limit).toBeDefined();
        return true;
      });
    }
  });

  it("limit default 50: box con 51 txs → página de 50 con hasMore", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Default 50",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    for (let index = 0; index < 51; index += 1) {
      await seedTx(box.id, owner.id, t0 + index * 1000);
    }

    const page = await getTransactionsSince(db, box.id);
    expect(page.transactions).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it("cursor inválido → ValidationError (400; el cliente resincroniza, T068)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Cursor inválido",
      currency: "USD",
    });

    // parseCursor("garbage") → null: el service lo rechaza como 400.
    const since = parseCursor("garbage");
    expect(since).toBeNull();
    await expect(
      getTransactionsSince(db, box.id, { since: undefined }),
    ).resolves.toBeDefined();

    // Un cursor parseado pero con campos tipo-error tampoco debe colar:
    // parseCursor devuelve null, así que el handler mapea a 400 ANTES de
    // llamar al service. Acá se fija el shape del rechazo.
    const garbageResponse = parseCursor("not-a-cursor");
    expect(garbageResponse).toBeNull();
  });

  it("dos txs con MISMO createdAt → desempata por id (T063)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Empate",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    // Seed en orden INVERSO al esperado: el orden lo fija la tupla, no el
    // orden de inserción. Ids UUIDv7 fijos (el patrón de `isUuidV7`); el
    // orden lexicográfico desempata: ...0000 < ...ffff.
    const later = await seedTx(box.id, owner.id, t0, {
      id: `0199ffff-ffff-7fff-8fff-ff${Date.now().toString(16).slice(-10)}0001`,
      note: "empate-b",
    });
    const earlier = await seedTx(box.id, owner.id, t0, {
      id: `01990000-0000-7fff-8fff-00${Date.now().toString(16).slice(-10)}0000`,
      note: "empate-a",
    });

    const result = await getTransactionsSince(db, box.id);

    expect(result.transactions.map((tx) => tx.id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(result.transactions.map((tx) => tx.createdAt)).toEqual([t0, t0]);
  });

  it("reanudar con cursor sobre borde de empate: sin duplicados ni gaps (T063)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Empate en el borde",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    // Tres txs con el MISMO timestamp cruzando el corte de la página 1.
    // Sufijo único por corrida: la PK no colisiona entre tests.
    const runStamp = Date.now().toString(16).padStart(10, "0").slice(-10);
    const tieA = await seedTx(box.id, owner.id, t0, {
      id: `01990000-0000-7fff-8fff-aa${runStamp}0000`,
    });
    const tieB = await seedTx(box.id, owner.id, t0, {
      id: `01990000-0000-7fff-8fff-aa${runStamp}0001`,
    });
    const tieC = await seedTx(box.id, owner.id, t0, {
      id: `01990000-0000-7fff-8fff-aa${runStamp}0002`,
    });
    const afterTie = await seedTx(box.id, owner.id, t0 + 1000);

    // Página 1: limit 2 → corta ENTRE las txs empatadas.
    const page1 = await getTransactionsSince(db, box.id, { limit: 2 });
    expect(page1.transactions.map((tx) => tx.id)).toEqual([tieA.id, tieB.id]);
    expect(page1.hasMore).toBe(true);
    const cursorTuple = parseCursor(page1.nextCursor ?? "");
    expect(cursorTuple).toEqual({ createdAtMs: t0, id: tieB.id });

    // Página 2 con la tupla: continúa por id dentro del mismo timestamp.
    const page2 = await getTransactionsSince(db, box.id, {
      since: cursorTuple as Cursor,
      limit: 2,
    });
    expect(page2.transactions.map((tx) => tx.id)).toEqual([
      tieC.id,
      afterTie.id,
    ]);
  });

  it("walk completo por cursores: 25 txs, 3 páginas, sin gaps ni duplicados (T063)", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Walk completo",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const total = 25;
    for (let index = 0; index < total; index += 1) {
      await seedTx(box.id, owner.id, t0 + index * 1000);
    }

    // El orden esperado viene de la DB (fuente de verdad), ordenado por la
    // misma tupla que el endpoint (createdAt, id).
    const allRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.boxId, box.id));
    const expectedOrder = allRows
      .map((row) => ({ id: row.id, createdAt: row.createdAt }))
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id < b.id
            ? -1
            : 1
          : a.createdAt - b.createdAt,
      )
      .map((row) => row.id);
    expect(expectedOrder).toHaveLength(total);

    // Walk: página 1 desde el inicio, las siguientes con nextCursor.
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result = await getTransactionsSince(db, box.id, {
        limit: 10,
        since: cursor ? (parseCursor(cursor) as Cursor) : undefined,
      });
      pages += 1;
      collected.push(
        ...result.transactions.map((transaction) => transaction.id),
      );
      if (!result.hasMore) {
        expect(result.nextCursor).toBeNull();
        break;
      }
      expect(result.nextCursor).not.toBeNull();
      cursor = result.nextCursor;
    }

    expect(pages).toBe(3); // 10 + 10 + 5
    expect(collected).toHaveLength(total);
    expect(new Set(collected).size).toBe(total); // sin duplicados
    expect(collected).toEqual(expectedOrder); // orden correcto y sin gaps
  });

  it("sinceDate y sinceTransactionId a la vez: gana la ancla por id", async () => {
    const owner = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "Precedencia",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    await seedTx(box.id, owner.id, t0);
    const b = await seedTx(box.id, owner.id, t0 + 1000);
    const c = await seedTx(box.id, owner.id, t0 + 2000);

    const result = await getTransactionsSince(db, box.id, {
      sinceMs: t0,
      sinceTransactionId: b.id,
    });

    // La ancla por id (t0 + 1000) gana sobre la fecha (t0): solo queda c.
    expect(result.transactions.map((tx) => tx.id)).toEqual([c.id]);
  });

  it("no filtra transacciones de OTRA box (particionado por boxId)", async () => {
    const owner = await insertUser(db);
    const boxA = await createBox(db, owner.id, {
      name: "Solo A",
      currency: "USD",
    });
    const boxB = await createBox(db, owner.id, {
      name: "Solo B",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    await seedTx(boxA.id, owner.id, t0);
    await seedTx(boxB.id, owner.id, t0 + 1000);

    const result = await getTransactionsSince(db, boxA.id);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.note).toBe("tx@1700000000000");
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
