import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { makeCursor, parseCursor } from "@/lib/cursor";
import { newId } from "@/lib/ids";
import { createBox } from "@/server/boxes/service";
import { insertAccess, insertRawTransaction, insertUser } from "./helpers";

/**
 * T062/T064 — test HTTP del Route Handler con mocks mínimos (patrón de la
 * suite): `server-only` stubbed (Vitest corre en Node), `next/headers`
 * mockeado para la cookie de sesión y `@/server/auth/session` mockeado
 * para resolver el usuario contra la MISMA DB de test (el flujo real de
 * `resolveSessionUser` ya está cubierto por `session.test.ts`; acá el
 * interés es el contrato HTTP del handler delgado). `@/db` se mockea
 * igual: la factory de `vi.mock` se hoistea, así que la DB de test se
 * inyecta por `__setRouteDb` desde `beforeAll`.
 *
 * Lo que se fija acá: status codes (401/400/404/403/200), shape del body
 * de error (`{ error: { code, ... } }`), parseo de `sinceDate` ISO/unix
 * ms, 404 de la tx ancla cross-box y el orden ASC por `(createdAt, id)`.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `create-transaction.test.ts`). Vitest hoistea `vi.mock` al tope del
// archivo.
vi.mock("server-only", () => ({}));

// Cookie store mock: el test lo repuebla por caso (o lo deja vacío para el
// 401). `cookies()` de next/headers es async en Next 16.
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

/**
 * Mock de `@/server/auth/session`: `requireCurrentUser` resuelve el user
 * por el token de la cookie contra la DB de test con el MISMO contrato que
 * el módulo real — cookie válida → user; sin cookie o token desconocido →
 * lanza `UnauthorizedError` (el handler lo mapea a 401). La resolución
 * real de sesión (`resolveSessionUser`) ya está testada en
 * `session.test.ts`; acá el interés es el handler. `sessionDb` lo setea
 * el test en `beforeAll` (la factory de `vi.mock` se hoistea, no puede
 * leer el resultado de `createTestDb()` todavía).
 */
let sessionDb: unknown = null;
vi.mock("@/server/auth/session", async () => {
  const { resolveSessionUser } = await import("@/server/auth/service");
  const { UnauthorizedError } = await import("@/server/errors");
  return {
    requireCurrentUser: async () => {
      const raw = cookieStore.get("cm_session");
      const user =
        raw !== null && raw !== undefined && sessionDb !== null
          ? await resolveSessionUser(
              sessionDb as Parameters<typeof resolveSessionUser>[0],
              (await import("@/lib/crypto/token")).hashAccessToken(raw),
            )
          : null;
      if (user === null) {
        throw new UnauthorizedError();
      }
      return user;
    },
  };
});

// Mock de `@/db`: la route usa el singleton global; acá se sustituye por
// la DB de test (seteada en `beforeAll`).
let routeDb: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    if (routeDb === null) {
      throw new Error("routeDb not initialized");
    }
    return routeDb;
  },
}));

import { GET } from "@/app/api/boxes/[boxId]/transactions/route";

const T0 = 1_700_000_000_000;

function makeRequest(query: string): Request {
  return new Request(
    `http://localhost:3000/api/boxes/b1/transactions${query}`,
  ) as Request;
}

function makeParams(boxId: string): { params: Promise<{ boxId: string }> } {
  return { params: Promise.resolve({ boxId }) };
}

describe("GET /api/boxes/[boxId]/transactions (T062/T064 HTTP)", () => {
  const { db, client, migrateOnce, url } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
    const { drizzle } = await import("drizzle-orm/libsql");
    const drizzleDb = drizzle({ connection: { url } });
    routeDb = drizzleDb;
    sessionDb = drizzleDb;
  });

  beforeEach(() => {
    cookieStore.clear();
  });

  /** Owner + box + 3 txs con timestamps fijos; guest con view y guest sin view. */
  async function seedWorld() {
    const owner = await insertUser(db);
    const guestView = await insertUser(db);
    const guestNoView = await insertUser(db);
    const stranger = await insertUser(db);
    const box = await createBox(db, owner.id, {
      name: "HTTP box",
      currency: "USD",
    });
    await insertAccess(
      db,
      box.id,
      guestView.id,
      owner.id,
      '["view:transactions"]',
    );
    await insertAccess(
      db,
      box.id,
      guestNoView.id,
      owner.id,
      '["create:transactions"]',
    );
    const a = await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 100,
      note: "a",
      createdBy: owner.id,
      createdAt: T0,
    });
    const b = await insertRawTransaction(db, {
      boxId: box.id,
      type: "withdraw",
      amountMinor: 30,
      note: "b",
      createdBy: owner.id,
      createdAt: T0 + 1000,
    });
    const c = await insertRawTransaction(db, {
      boxId: box.id,
      type: "deposit",
      amountMinor: 5,
      note: "c",
      createdBy: owner.id,
      createdAt: T0 + 2000,
    });
    return { owner, guestView, guestNoView, stranger, box, a, b, c };
  }

  /**
   * Sesión activa: inserta la fila de sesión (hash como id, el flujo real
   * de `createSessionRow`) y deja la cookie con el token crudo.
   */
  async function loginAs(dbAny: unknown, userId: string): Promise<void> {
    const { createSessionRow } = await import("@/server/auth/service");
    const { token } = await createSessionRow(
      dbAny as Parameters<typeof createSessionRow>[0],
      userId,
    );
    cookieStore.set("cm_session", token);
  }

  it("sin sesión → 401 con { error: { code: 'unauthorized' } }", async () => {
    const { owner, box } = await seedWorld();
    expect(owner).toBeDefined();

    const response = await GET(makeRequest(""), makeParams(box.id));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized" },
    });
  });

  it("owner con sesión → 200, shape completo, ASC por (createdAt, id)", async () => {
    const { owner, box, a, b, c } = await seedWorld();
    await loginAs(db, owner.id);

    const response = await GET(makeRequest(""), makeParams(box.id));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      transactions: Array<{
        id: string;
        type: string;
        amountMinor: number;
        counterparty: string | null;
        note: string;
        createdBy: string;
        createdAt: number;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body.transactions.map((tx) => tx.id)).toEqual([a.id, b.id, c.id]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.transactions[0]).toEqual({
      id: a.id,
      type: "deposit",
      amountMinor: 100,
      counterparty: null,
      note: "a",
      createdBy: owner.id,
      createdAt: T0,
    });
  });

  it("sinceDate ISO y unix ms equivalentes; exclusivo (createdAt === sinceDate no entra)", async () => {
    const { owner, box, a, b, c } = await seedWorld();
    await loginAs(db, owner.id);

    const unix = await GET(
      makeRequest(`?sinceDate=${T0 + 1000}`),
      makeParams(box.id),
    );
    expect(unix.status).toBe(200);
    const unixBody = (await unix.json()) as {
      transactions: Array<{ id: string }>;
    };
    expect(unixBody.transactions.map((tx) => tx.id)).toEqual([c.id]);

    const iso = await GET(
      makeRequest(`?sinceDate=2023-11-14T22%3A13%3A21.000Z`),
      makeParams(box.id),
    );
    expect(iso.status).toBe(200);
    const isoBody = (await iso.json()) as {
      transactions: Array<{ id: string }>;
    };
    expect(isoBody.transactions.map((tx) => tx.id)).toEqual([c.id]);

    // El borde es EXCLUSIVO: la tx con createdAt === sinceDate queda fuera.
    const boundary = await GET(
      makeRequest(`?sinceDate=${T0}`),
      makeParams(box.id),
    );
    const boundaryBody = (await boundary.json()) as {
      transactions: Array<{ id: string }>;
    };
    expect(boundaryBody.transactions.map((tx) => tx.id)).toEqual([b.id, c.id]);
    expect(boundaryBody.transactions.map((tx) => tx.id)).not.toContain(a.id);
  });

  it("sinceDate inválido → 400 con fieldErrors.sinceDate", async () => {
    const { owner, box } = await seedWorld();
    await loginAs(db, owner.id);

    const response = await GET(
      makeRequest("?sinceDate=mañana"),
      makeParams(box.id),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fieldErrors: {
          sinceDate: ["Debe ser una fecha ISO 8601 o unix ms válidos."],
        },
      },
    });
  });

  it("sinceTransactionId: usa su (createdAt, id) como ancla; tx de otra box → 404", async () => {
    const { owner, box, b, c } = await seedWorld();
    await loginAs(db, owner.id);

    const ok = await GET(
      makeRequest(`?sinceTransactionId=${b.id}`),
      makeParams(box.id),
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { transactions: Array<{ id: string }> };
    expect(okBody.transactions.map((tx) => tx.id)).toEqual([c.id]);

    // Ancla en OTRA box: la query cruza por boxId → 404.
    const otherOwner = await insertUser(db);
    const otherBox = await createBox(db, otherOwner.id, {
      name: "Otra box",
      currency: "USD",
    });
    const foreignTx = await insertRawTransaction(db, {
      boxId: otherBox.id,
      type: "deposit",
      amountMinor: 1,
      note: "foreign",
      createdBy: otherOwner.id,
      createdAt: T0,
    });

    const cross = await GET(
      makeRequest(`?sinceTransactionId=${foreignTx.id}`),
      makeParams(box.id),
    );
    expect(cross.status).toBe(404);
    await expect(cross.json()).resolves.toEqual({
      error: { code: "not_found" },
    });

    // Id inexistente: mismo 404.
    const missing = await GET(
      makeRequest(`?sinceTransactionId=${newId()}`),
      makeParams(box.id),
    );
    expect(missing.status).toBe(404);
  });

  it("cursor inválido → 400 (el cliente resincroniza, cf. T068)", async () => {
    const { owner, box } = await seedWorld();
    await loginAs(db, owner.id);

    const response = await GET(
      makeRequest("?cursor=garbage"),
      makeParams(box.id),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fieldErrors: { cursor: ["El cursor es inválido."] },
      },
    });
  });

  it("paginación por nextCursor con hasMore: walk HTTP completo", async () => {
    const { owner, box, a, b, c } = await seedWorld();
    await loginAs(db, owner.id);

    const page1 = await GET(makeRequest("?limit=2"), makeParams(box.id));
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      transactions: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body1.hasMore).toBe(true);
    expect(body1.transactions.map((tx) => tx.id)).toEqual([a.id, b.id]);
    expect(parseCursor(body1.nextCursor ?? "")).toEqual({
      createdAtMs: T0 + 1000,
      id: b.id,
    });

    const page2 = await GET(
      makeRequest(
        `?limit=10&cursor=${encodeURIComponent(body1.nextCursor ?? "")}`,
      ),
      makeParams(box.id),
    );
    expect(page2.status).toBe(200);
    const body2 = (await page2.json()) as {
      transactions: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body2.hasMore).toBe(false);
    expect(body2.nextCursor).toBeNull();
    expect(body2.transactions.map((tx) => tx.id)).toEqual([c.id]);

    // makeCursor roundtrip: el cursor entregado es re-decodificable (T009).
    expect(makeCursor(T0 + 1000, b.id)).toBe(body1.nextCursor);
  });

  it("limit fuera de rango (0, 101, -1, 1.5) → 400 con fieldErrors.limit", async () => {
    const { owner, box } = await seedWorld();
    await loginAs(db, owner.id);

    for (const limit of ["0", "101", "-1", "1.5"]) {
      const response = await GET(
        makeRequest(`?limit=${limit}`),
        makeParams(box.id),
      );
      expect(response.status).toBe(400);
      // El contrato estable es el `code` y el campo; el texto del mensaje
      // no (sale del service o del handler según qué validación falló).
      const body = (await response.json()) as {
        error: { code: string; fieldErrors: { limit: string[] } };
      };
      expect(body.error.code).toBe("validation");
      expect(body.error.fieldErrors.limit).toHaveLength(1);
    }
  });

  it("extraño → 404 (no revela la box); guest sin view → 403", async () => {
    const { stranger, guestNoView, box } = await seedWorld();

    await loginAs(db, stranger.id);
    const notFound = await GET(makeRequest(""), makeParams(box.id));
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: { code: "not_found" },
    });

    await loginAs(db, guestNoView.id);
    const forbidden = await GET(makeRequest(""), makeParams(box.id));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: { code: "forbidden" },
    });
  });

  it("guest con view:transactions → 200 (puede leer y paginar)", async () => {
    const { guestView, box, a, b, c } = await seedWorld();
    await loginAs(db, guestView.id);

    const response = await GET(makeRequest(""), makeParams(box.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      transactions: Array<{ id: string }>;
    };
    expect(body.transactions.map((tx) => tx.id)).toEqual([a.id, b.id, c.id]);
  });

  it("box inexistente → 404 (mismo code que el extraño)", async () => {
    const { owner } = await seedWorld();
    await loginAs(db, owner.id);

    const response = await GET(
      makeRequest(""),
      makeParams("01999999-9999-7999-8999-999999999999"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found" },
    });
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
    expect(db).toBeDefined();
    expect(eq).toBeDefined();
  });
});
