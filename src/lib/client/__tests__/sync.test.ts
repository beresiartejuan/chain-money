/**
 * Tests de `syncBox` (T067) y del resync ante cursor inválido (T068).
 *
 * Todo corre con dependencias en memoria: un `SyncStorage` sobre un `Map`
 * y un `fetchPage` que simula el endpoint incremental de T062 (páginas,
 * `hasMore`, cursor por orden de tupla). Sin red, sin DB, sin navegador.
 */
import { describe, expect, it, vi } from "vitest";
import {
  applyTransactions,
  type BalanceState,
  balanceFromTransactions,
  emptyBalanceState,
  type SyncTransaction,
} from "@/lib/client/balance-cache";
import {
  createBoxSync,
  type FetchPage,
  InvalidCursorError,
  isInvalidCursorError,
  type SyncPageParams,
  type SyncStorage,
} from "@/lib/client/sync";
import type { Cursor } from "@/lib/cursor";
import { compareTuples, makeCursor, parseCursor } from "@/lib/cursor";
import { tx } from "./helpers";

const BOX_ID = "box-1";

/** Storage en memoria sobre un Map, con entrada inicial opcional. */
function memoryStorage(initial?: Record<string, BalanceState>): {
  storage: SyncStorage;
  map: Map<string, BalanceState>;
} {
  const map = new Map(Object.entries(initial ?? {}));
  const storage: SyncStorage = {
    get: (boxId) => map.get(boxId) ?? null,
    set: (boxId, state) => {
      map.set(boxId, state);
    },
    clear: (boxId) => {
      map.delete(boxId);
    },
  };
  return { storage, map };
}

/** Índice de la primera transacción mayor (por tupla) que el cursor. */
function startIndexAfter(
  transactions: SyncTransaction[],
  params: SyncPageParams,
): number {
  if (
    params.sinceDate === undefined ||
    params.sinceTransactionId === undefined
  ) {
    return 0;
  }
  const cursor: Cursor = {
    createdAtMs: params.sinceDate,
    id: params.sinceTransactionId,
  };
  let index = 0;
  while (
    index < transactions.length &&
    compareTuples(
      {
        createdAtMs: transactions[index].createdAt,
        id: transactions[index].id,
      },
      cursor,
    ) <= 0
  ) {
    index += 1;
  }
  return index;
}

type FakeServerOptions = {
  /** Tamaño de página por defecto (se usa si el pedido no trae `limit`). */
  pageSize?: number;
  /** Rechaza con `InvalidCursorError` el PRIMER pedido que traiga cursor. */
  rejectCursorOnce?: boolean;
  /** Rechaza TODOS los pedidos (ni siquiera el resync sale adelante). */
  rejectEverything?: boolean;
};

/**
 * Simula el endpoint incremental: sirve `transactions` paginado desde el
 * cursor del pedido y registra cada llamada para las aserciones. Respeta el
 * `limit` del pedido (como el server real) y, con `rejectCursorOnce`,
 * rechaza solo el primer pedido con cursor: modela un server que ya no
 * resuelve el cursor viejo del cliente, pero sí los que este emite durante
 * el resync.
 */
function fakeServer(
  transactions: SyncTransaction[],
  options: FakeServerOptions = {},
) {
  const pageSize = options.pageSize ?? 3;
  const calls: Array<{ boxId: string; params: SyncPageParams }> = [];
  let cursorRejections = 0;

  const fetchPage: FetchPage = vi.fn(
    async (boxId: string, params: SyncPageParams) => {
      calls.push({ boxId, params });

      const hasCursor =
        params.sinceDate !== undefined ||
        params.sinceTransactionId !== undefined;
      const reject =
        options.rejectEverything ||
        (options.rejectCursorOnce && hasCursor && cursorRejections === 0);
      if (reject) {
        cursorRejections += 1;
        throw new InvalidCursorError();
      }

      const size = params.limit ?? pageSize;
      const start = startIndexAfter(transactions, params);
      const page = transactions.slice(start, start + size);
      const last = page[page.length - 1];
      return {
        transactions: page,
        nextCursor:
          page.length > 0 ? makeCursor(last.createdAt, last.id) : null,
        hasMore: start + size < transactions.length,
      };
    },
  );

  return {
    fetchPage,
    calls,
    /** Cantidad de veces que el server rechazó un cursor. */
    cursorRejections: () => cursorRejections,
  };
}

describe("isInvalidCursorError", () => {
  it("reconoce la clase InvalidCursorError", () => {
    expect(isInvalidCursorError(new InvalidCursorError())).toBe(true);
  });

  it("reconoce el code estable invalid_cursor en errores duck-typed", () => {
    const error = Object.assign(new Error("boom"), {
      code: "invalid_cursor",
    });
    expect(isInvalidCursorError(error)).toBe(true);
  });

  it("reconoce 'invalid cursor' con espacio, mayúsculas u otro separador", () => {
    expect(isInvalidCursorError(new Error("invalid cursor"))).toBe(true);
    expect(isInvalidCursorError(new Error("INVALID_CURSOR"))).toBe(true);
    expect(isInvalidCursorError(new Error("Invalid-Cursor"))).toBe(true);
  });

  it("rechaza errores que no hablan de cursor", () => {
    expect(isInvalidCursorError(new Error("network down"))).toBe(false);
    expect(
      isInvalidCursorError(
        Object.assign(new Error("x"), { code: "validation" }),
      ),
    ).toBe(false);
    expect(isInvalidCursorError(null)).toBe(false);
    expect(isInvalidCursorError("invalid_cursor")).toBe(false);
    expect(isInvalidCursorError(42)).toBe(false);
  });
});

describe("T067 — primera sync descarga todo y persiste", () => {
  it("pagina un delta de 2 páginas, aplica el balance y guarda el estado", async () => {
    const transactions = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "deposit", 2000, 2000),
      tx("c", "deposit", 500, 3000),
    ];
    const server = fakeServer(transactions, { pageSize: 2 });
    const { storage, map } = memoryStorage();
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID, { limit: 2 });

    expect(result.balanceMinor).toBe(3500);
    expect(result.transactionsDownloaded).toBe(3);
    expect(result.transactionCount).toBe(3);
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 3000,
      id: "c",
    });

    // El estado quedó persistido y consistente con el resultado.
    const saved = map.get(BOX_ID);
    expect(saved).not.toBeNull();
    expect(parseCursor(saved?.cursor ?? "")).toEqual({
      createdAtMs: 3000,
      id: "c",
    });
    expect(saved?.balanceMinor).toBe(3500);
    expect(saved?.transactionCount).toBe(3);
    expect(saved?.updatedAt).toBe(3000);

    // Dos páginas: la primera sin cursor, la segunda desde el cursor de "b".
    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]?.boxId).toBe(BOX_ID);
    expect(server.calls[0]?.params.sinceDate).toBeUndefined();
    expect(server.calls[0]?.params.sinceTransactionId).toBeUndefined();
    expect(server.calls[0]?.params.limit).toBe(2);
    expect(server.calls[1]?.params).toEqual({
      sinceDate: 2000,
      sinceTransactionId: "b",
      limit: 2,
    });
  });

  it("una alcancía sin transacciones termina con el estado vacío", async () => {
    const server = fakeServer([], { pageSize: 3 });
    const { storage, map } = memoryStorage();
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    expect(result).toEqual({
      balanceMinor: 0,
      transactionsDownloaded: 0,
      transactionCount: 0,
      cursor: null,
    });
    expect(server.calls).toHaveLength(1);
    expect(map.get(BOX_ID)).toEqual(emptyBalanceState());
  });
});

describe("T067 — sync incremental sin cambios y con N nuevas", () => {
  it("segunda sync sin cambios pide desde el cursor y descarga 0", async () => {
    const transactions = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "withdraw", 400, 2000),
    ];
    const server = fakeServer(transactions);
    const { storage, map } = memoryStorage();
    const first = createBoxSync({ storage, fetchPage: server.fetchPage });
    await first.syncBox(BOX_ID);

    // Nueva instancia (simula reload) contra el mismo storage.
    const second = createBoxSync({ storage, fetchPage: server.fetchPage });
    const before = map.get(BOX_ID);
    const result = await second.syncBox(BOX_ID);

    expect(result.transactionsDownloaded).toBe(0);
    expect(result.balanceMinor).toBe(600);
    expect(result.transactionCount).toBe(2);
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 2000,
      id: "b",
    });

    // El pedido usó el cursor guardado y la respuesta no cambió el estado.
    const deltaCall = server.calls[1];
    expect(deltaCall?.params).toEqual({
      sinceDate: 2000,
      sinceTransactionId: "b",
    });
    expect(map.get(BOX_ID)).toBe(before); // identidad referencial intacta
  });

  it("con N transacciones nuevas descarga exactamente N y avanza el cursor", async () => {
    const transactions = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "deposit", 2000, 2000),
      tx("c", "deposit", 500, 3000),
    ];
    const server = fakeServer(transactions, { pageSize: 2 });
    const { storage, map } = memoryStorage();
    const first = createBoxSync({ storage, fetchPage: server.fetchPage });
    await first.syncBox(BOX_ID);

    // Llegan 2 transacciones nuevas al server.
    transactions.push(tx("d", "deposit", 250, 4000));
    transactions.push(tx("e", "withdraw", 100, 5000));

    // Reload: nueva instancia con el mismo storage.
    const second = createBoxSync({ storage, fetchPage: server.fetchPage });
    const result = await second.syncBox(BOX_ID);

    expect(result.transactionsDownloaded).toBe(2);
    expect(result.transactionCount).toBe(5);
    expect(result.balanceMinor).toBe(3650); // 3500 + 250 - 100
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 5000,
      id: "e",
    });
    expect(map.get(BOX_ID)?.transactionCount).toBe(5);
  });

  it("el estado persistido sobrevive el reload sin re-descargar nada", async () => {
    const transactions = [tx("a", "deposit", 700, 1000)];
    const server = fakeServer(transactions);
    const { storage, map } = memoryStorage();
    await createBoxSync({ storage, fetchPage: server.fetchPage }).syncBox(
      BOX_ID,
    );

    const stateAfterFirstSync = map.get(BOX_ID);
    expect(stateAfterFirstSync).not.toBeNull();

    // "Reload": nueva instancia, mismo storage; el server no tiene novedades.
    const reloaded = createBoxSync({ storage, fetchPage: server.fetchPage });
    const result = await reloaded.syncBox(BOX_ID);

    expect(result.transactionsDownloaded).toBe(0);
    expect(map.get(BOX_ID)).toBe(stateAfterFirstSync);
  });
});

describe("T067 — paginación completa", () => {
  it("encadena páginas hasta hasMore false con el cursor avanzando", async () => {
    // 7 depósitos de 100, páginas de 3 → 3 páginas (3 + 3 + 1).
    const transactions = Array.from({ length: 7 }, (_, index) =>
      tx(`t${index}`, "deposit", 100, 1000 * (index + 1)),
    );
    const server = fakeServer(transactions, { pageSize: 3 });
    const { storage, map } = memoryStorage();
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    expect(result.balanceMinor).toBe(700);
    expect(result.transactionsDownloaded).toBe(7);
    expect(result.transactionCount).toBe(7);
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 7000,
      id: "t6",
    });

    expect(server.calls).toHaveLength(3);
    expect(server.calls[0]?.params.sinceDate).toBeUndefined();
    expect(server.calls[1]?.params.sinceDate).toBe(3000);
    expect(server.calls[1]?.params.sinceTransactionId).toBe("t2");
    expect(server.calls[2]?.params.sinceDate).toBe(6000);
    expect(server.calls[2]?.params.sinceTransactionId).toBe("t5");

    // Cada página persistió un prefijo: el estado final es el acumulado.
    expect(map.get(BOX_ID)?.transactionCount).toBe(7);
  });

  it("reenvía el limit pedido al server en cada página", async () => {
    const transactions = Array.from({ length: 5 }, (_, index) =>
      tx(`t${index}`, "deposit", 10, 1000 * (index + 1)),
    );
    const server = fakeServer(transactions, { pageSize: 10 });
    const { storage } = memoryStorage();
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID, { limit: 2 });

    expect(result.transactionsDownloaded).toBe(5);
    expect(server.calls).toHaveLength(3);
    for (const call of server.calls) {
      expect(call.params.limit).toBe(2);
    }
  });
});

describe("T068 — cursor corrupto en storage → full resync", () => {
  it("descarta el estado viejo, sincroniza desde cero y persiste el nuevo", async () => {
    const transactions = [
      tx("a", "deposit", 700, 1000),
      tx("b", "withdraw", 200, 2000),
    ];
    const server = fakeServer(transactions, { pageSize: 1 });
    const corrupt: BalanceState = {
      cursor: "esto-no-es-un-cursor",
      balanceMinor: 999,
      transactionCount: 42,
      updatedAt: 9999,
    };
    const { storage, map } = memoryStorage({ [BOX_ID]: corrupt });
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    // El balance es el del server, NO el corrupto más el delta.
    expect(result.balanceMinor).toBe(500);
    expect(result.balanceMinor).not.toBe(999 + 500);
    expect(result.transactionsDownloaded).toBe(2);
    expect(result.transactionCount).toBe(2);
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 2000,
      id: "b",
    });

    // La primera página NO trae cursor: resync desde el inicio.
    expect(server.calls[0]?.params.sinceDate).toBeUndefined();
    expect(server.calls[0]?.params.sinceTransactionId).toBeUndefined();

    // El estado nuevo reemplazó al corrupto en storage.
    const saved = map.get(BOX_ID);
    expect(saved).not.toBeNull();
    expect(saved).not.toBe(corrupt);
    expect(saved?.balanceMinor).toBe(500);
    expect(saved?.transactionCount).toBe(2);
    expect(parseCursor(saved?.cursor ?? "")).toEqual({
      createdAtMs: 2000,
      id: "b",
    });
  });

  it("estado sin cursor pero con balance residual → resync desde cero", async () => {
    // Caché a medio escribir: balance residual sin cursor. Aplicar un delta
    // fresco encima daría un balance falso; el resync lo evita.
    const halfWritten: BalanceState = {
      cursor: null,
      balanceMinor: 400,
      transactionCount: 7,
      updatedAt: 500,
    };
    const server = fakeServer([tx("a", "deposit", 100, 1000)], {
      pageSize: 3,
    });
    const { storage, map } = memoryStorage({ [BOX_ID]: halfWritten });
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    expect(result.balanceMinor).toBe(100);
    expect(result.balanceMinor).not.toBe(500);
    expect(result.transactionCount).toBe(1);
    expect(server.calls[0]?.params.sinceDate).toBeUndefined();
    expect(map.get(BOX_ID)?.balanceMinor).toBe(100);
  });

  it("el balance del resync coincide con el del historial completo del server", async () => {
    const transactions = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "withdraw", 400, 2000),
      tx("c", "reset", 0, 3000),
      tx("d", "deposit", 250, 4000),
      tx("e", "withdraw", 100, 5000),
    ];
    const server = fakeServer(transactions, { pageSize: 2 });
    const { storage } = memoryStorage({
      [BOX_ID]: {
        // Cursor corrupto a propósito: fuerza el full resync (T068).
        cursor: "no-valido",
        balanceMinor: 12345,
        transactionCount: 99,
        updatedAt: 9999,
      },
    });
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    // El balance final es el que produce aplicar el historial completo del
    // server desde cero, no el balance corrupto sembrado (12345).
    expect(result.balanceMinor).toBe(balanceFromTransactions(transactions));
    expect(result.balanceMinor).toBe(150);
    expect(result.transactionCount).toBe(5);
  });
});

describe("T068 — server rechaza el cursor → UN resync", () => {
  it("resincroniza una vez desde el inicio y termina ok", async () => {
    const transactions = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "deposit", 2000, 2000),
      tx("c", "withdraw", 300, 3000),
      tx("d", "deposit", 50, 4000),
    ];
    const server = fakeServer(transactions, {
      pageSize: 2,
      rejectCursorOnce: true,
    });
    // Estado válido cuyo cursor el server ya no puede resolver (p. ej. la
    // tupla quedó fuera del historial retenido por el server).
    const stale = applyTransactions(emptyBalanceState(), [
      transactions[0],
      transactions[1],
    ]);
    const { storage, map } = memoryStorage({ [BOX_ID]: stale });
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    const result = await syncBox(BOX_ID);

    expect(result.balanceMinor).toBe(2750);
    expect(result.transactionCount).toBe(4);
    expect(parseCursor(result.cursor ?? "")).toEqual({
      createdAtMs: 4000,
      id: "d",
    });

    // Exactamente UN rechazo; el resync arranca desde el inicio (sin cursor)
    // y pagina las 2 páginas restantes.
    expect(server.cursorRejections()).toBe(1);
    expect(server.calls).toHaveLength(3);
    expect(server.calls[0]?.params.sinceDate).toBe(2000);
    expect(server.calls[1]?.params.sinceDate).toBeUndefined();
    expect(server.calls[2]?.params.sinceDate).toBe(2000);
    expect(map.get(BOX_ID)?.transactionCount).toBe(4);
  });

  it("si el resync también falla, propaga el error sin reintentar más", async () => {
    const server = fakeServer([tx("a", "deposit", 100, 1000)], {
      rejectEverything: true,
    });
    const saved = applyTransactions(emptyBalanceState(), [
      tx("a", "deposit", 100, 1000),
    ]);
    const { storage, map } = memoryStorage({ [BOX_ID]: saved });
    const { syncBox } = createBoxSync({ storage, fetchPage: server.fetchPage });

    await expect(syncBox(BOX_ID)).rejects.toThrow(InvalidCursorError);

    // Solo dos pedidos: el delta original y el primer pedido del resync.
    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]?.params.sinceDate).toBeDefined();
    expect(server.calls[1]?.params.sinceDate).toBeUndefined();
    // Crash-safe: storage quedó en estado vacío, no con el cursor corrupto.
    expect(map.get(BOX_ID)).toEqual(emptyBalanceState());
  });
});

describe("T067/T068 — errores de red", () => {
  it("propaga el error sin perder el estado guardado", async () => {
    const saved = applyTransactions(emptyBalanceState(), [
      tx("a", "deposit", 700, 1000),
      tx("b", "withdraw", 200, 2000),
    ]);
    const { storage, map } = memoryStorage({ [BOX_ID]: saved });
    const fetchPage = vi.fn<FetchPage>(async () => {
      throw new Error("network down");
    });
    const { syncBox } = createBoxSync({ storage, fetchPage });

    await expect(syncBox(BOX_ID)).rejects.toThrow("network down");

    // Ni storage ni estado fueron tocados: la sync no empezó a aplicar.
    expect(map.get(BOX_ID)).toBe(saved);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[1]).toEqual({
      sinceDate: 2000,
      sinceTransactionId: "b",
    });
  });

  it("un error de red a mitad de la paginación deja un prefijo persistido", async () => {
    const transactions = [
      tx("a", "deposit", 100, 1000),
      tx("b", "deposit", 100, 2000),
      tx("c", "deposit", 100, 3000),
    ];
    const { storage, map } = memoryStorage();
    let calls = 0;
    const fetchPage: FetchPage = vi.fn(
      async (_boxId: string, _params: SyncPageParams) => {
        calls += 1;
        if (calls === 1) {
          return {
            transactions: [transactions[0]],
            nextCursor: makeCursor(1000, "a"),
            hasMore: true,
          };
        }
        throw new Error("network down");
      },
    );
    const { syncBox } = createBoxSync({ storage, fetchPage });

    await expect(syncBox(BOX_ID)).rejects.toThrow("network down");

    // Crash-safe: la primera página ya quedó persistida con su cursor, así
    // que la próxima sync continúa desde ahí y no desde cero.
    const saved = map.get(BOX_ID);
    expect(saved?.balanceMinor).toBe(100);
    expect(saved?.transactionCount).toBe(1);
    expect(parseCursor(saved?.cursor ?? "")).toEqual({
      createdAtMs: 1000,
      id: "a",
    });
    expect(fetchPage).toHaveBeenNthCalledWith(1, BOX_ID, {});
    expect(fetchPage).toHaveBeenNthCalledWith(2, BOX_ID, {
      sinceDate: 1000,
      sinceTransactionId: "a",
    });
  });
});
