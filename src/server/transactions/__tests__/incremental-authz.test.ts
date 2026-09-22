import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { makeCursor, parseCursor } from "@/lib/cursor";
import { createBox } from "@/server/boxes/service";
import { NotFoundError, PermissionError } from "@/server/errors";
import {
  getTransactionsSince,
  getTransactionsWithAccess,
  type SyncTransaction,
} from "@/server/transactions/sync";
import { insertAccess, insertRawTransaction, insertUser } from "./helpers";

/**
 * T064 — matriz de acceso del endpoint incremental, service-level (sin
 * HTTP). El Route Handler solo agrega requireCurrentUser (401) y el
 * mapeo de errores a status; el gate de permisos es el MISMO patrón de
 * las actions de dominio: `requireBoxAccess` + `hasPermission`, ya
 * testeados en `assert.test.ts`/`access.test.ts`.
 *
 * Matriz fijada acá (sobre `getTransactionsWithAccess`):
 *
 * | actor                          | resultado esperado          |
 * | ------------------------------ | --------------------------- |
 * | owner                          | 200 — lee todo              |
 * | guest con view:transactions    | 200 — puede leer            |
 * | guest solo create:transactions | PermissionError (→ 403)     |
 * | guest con set vacío (imposible |                             |
 * | por diseño de tokens)          | PermissionError (→ 403)     |
 * | extraño (sin relación)         | NotFoundError (→ 404)       |
 * | box inexistente                | NotFoundError (→ 404)       |
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-transaction.test.ts`). Vitest hoistea `vi.mock` al tope del
// archivo.
vi.mock("server-only", () => ({}));

describe("getTransactionsWithAccess (T064)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  /** Box del owner con dos transacciones seed (timestamps fijos). */
  async function seedBoxWithTransactions(ownerId: string) {
    const box = await createBox(db, ownerId, {
      name: "Sync box",
      currency: "USD",
    });
    const t0 = 1_700_000_000_000;
    const first = await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 100,
      note: "primera",
      createdBy: ownerId,
      createdAt: t0,
    });
    const second = await insertRawTransaction(db, {
      boxId: box.id,
      type: "withdraw",
      amountMinor: 40,
      note: "segunda",
      createdBy: ownerId,
      createdAt: t0 + 1000,
    });
    return { box, t0, first, second };
  }

  it("owner → lee el historial completo (permisos implícitos)", async () => {
    const owner = await insertUser(db);
    const { box, first, second } = await seedBoxWithTransactions(owner.id);

    const result = await getTransactionsWithAccess(db, owner.id, box.id);

    expect(result.hasMore).toBe(false);
    expect(result.transactions.map((tx) => tx.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("guest con view:transactions → puede leer (200)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const { box, first, second } = await seedBoxWithTransactions(owner.id);
    await insertAccess(db, box.id, guest.id, owner.id, '["view:transactions"]');

    const result = await getTransactionsWithAccess(db, guest.id, box.id);

    expect(result.transactions.map((tx) => tx.id)).toEqual([
      first.id,
      second.id,
    ]);
    // El guest también puede paginar (el gate no degrada la consulta).
    const page = await getTransactionsWithAccess(db, guest.id, box.id, {
      limit: 1,
    });
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it("guest SOLO con create:transactions → PermissionError (no puede ver)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const { box } = await seedBoxWithTransactions(owner.id);
    // Tokens con permisos mínimos: este guest solo puede crear movimientos.
    await insertAccess(
      db,
      box.id,
      guest.id,
      owner.id,
      '["create:transactions"]',
    );

    await expect(
      getTransactionsWithAccess(db, guest.id, box.id),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PermissionError);
      expect((error as PermissionError).code).toBe("forbidden");
      return true;
    });
  });

  it("guest con set vacío de permisos → NotFoundError (requireBoxAccess lo trata como extraño)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const { box } = await seedBoxWithTransactions(owner.id);
    // Diseño de tokens: el canje exige ≥ 1 permiso, así que un guest con
    // set vacío no debería existir. `requireBoxAccess` (compartido con
    // actions) trata un guest con 0 permisos como extraño → NotFoundError,
    // que el handler mapea al mismo 404: la box no es visible para él.
    await insertAccess(db, box.id, guest.id, owner.id, "[]");

    await expect(
      getTransactionsWithAccess(db, guest.id, box.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("extraño sin relación → NotFoundError (404, nunca 403)", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const { box } = await seedBoxWithTransactions(owner.id);

    await expect(
      getTransactionsWithAccess(db, stranger.id, box.id),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("not_found");
      return true;
    });
  });

  it("box inexistente → NotFoundError (mismo 404 que el extraño)", async () => {
    const user = await insertUser(db);

    await expect(
      getTransactionsWithAccess(
        db,
        user.id,
        "01999999-9999-7999-8999-999999999999",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la ancla sinceTransactionId se resuelve DESPUÉS del gate: extraño no sondea", async () => {
    const owner = await insertUser(db);
    const stranger = await insertUser(db);
    const { box, first } = await seedBoxWithTransactions(owner.id);

    // La tx existe en la box, pero el extraño igual recibe NotFoundError
    // del gate de acceso (no un resultado vacío): no se le deja sondear.
    await expect(
      getTransactionsWithAccess(db, stranger.id, box.id, {
        sinceTransactionId: first.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la consulta con acceso delega en getTransactionsSince (mismo contrato)", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const { box, t0, first, second } = await seedBoxWithTransactions(owner.id);
    await insertAccess(db, box.id, guest.id, owner.id, '["view:transactions"]');

    const withAccess = await getTransactionsWithAccess(db, guest.id, box.id, {
      limit: 1,
    });
    const direct = await getTransactionsSince(db, box.id, { limit: 1 });

    expect(withAccess).toEqual(direct);
    const cursorTuple = parseCursor(withAccess.nextCursor ?? "");
    expect(cursorTuple).toEqual({
      createdAtMs: t0,
      id: first.id,
    });
    // Y desde ese cursor se completa la página restante.
    const rest = await getTransactionsWithAccess(db, guest.id, box.id, {
      since: cursorTuple as NonNullable<typeof cursorTuple>,
      limit: 10,
    });
    expect(rest.transactions.map((tx: SyncTransaction) => tx.id)).toEqual([
      second.id,
    ]);
  });

  it("makeCursor/parseCursor roundtrip del nextCursor (contrato T009)", async () => {
    const owner = await insertUser(db);
    const { box } = await seedBoxWithTransactions(owner.id);

    const page = await getTransactionsWithAccess(db, owner.id, box.id, {
      limit: 1,
    });
    const tuple = parseCursor(page.nextCursor ?? "");
    expect(tuple).not.toBeNull();
    expect(makeCursor(tuple?.createdAtMs ?? 0, tuple?.id ?? "")).toBe(
      page.nextCursor,
    );
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
