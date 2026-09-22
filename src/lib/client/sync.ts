/**
 * Orquestador de sincronización incremental del caché de balance (cliente).
 *
 * Conecta el caché puro de `balance-cache.ts` con dos dependencias inyectables:
 * un adapter de storage (dónde persistir el `BalanceState` entre sesiones,
 * p. ej. localStorage) y un adapter de red (`fetchPage`, que habla con el
 * endpoint incremental `GET /api/boxes/[boxId]/transactions` de T062). El
 * módulo no importa nada de server ni DB: es cliente-safe y se testea con
 * storage en memoria y `fetchPage` mockeado; T080 le pasa los adapters reales.
 *
 * El loop de `syncBox` pide páginas desde el cursor guardado, aplica el delta
 * con `applyTransactions` y persiste el estado DESPUÉS de cada página: si el
 * proceso muere a mitad de sync, el estado guardado es siempre un prefijo
 * consistente y la próxima sync continúa desde el último cursor (crash-safe).
 *
 * Autocuración (T068): si el cursor guardado no parsea —o el server rechaza
 * un cursor con el código estable `invalid_cursor`— se descarta el estado y
 * se hace UN full resync paginado desde el inicio. Si ese resync también
 * falla, el error propaga sin más reintentos.
 *
 * No es reentrante: no llamar `syncBox` dos veces en paralelo para el mismo
 * boxId (los pedidos intercalados aplicarían el mismo delta dos veces).
 *
 * Contrato para T080 (adapters reales):
 * - `storage`: envolver localStorage serializando el `BalanceState` a JSON.
 * - `fetchPage`: llamar al endpoint con `sinceDate` + `sinceTransactionId`
 *   + `limit` (los params que emite este módulo); si el server responde 4xx
 *   con code `invalid_cursor`, lanzar `InvalidCursorError`; cualquier otro
 *   fallo (red, auth, …) se propaga tal cual, sin reintentos del orquestador.
 */
import {
  applyTransactions,
  type BalanceState,
  emptyBalanceState,
  type SyncTransaction,
} from "@/lib/client/balance-cache";
import { parseCursor } from "@/lib/cursor";

/** Código estable con el que el server (T062) marca un cursor inválido. */
export const INVALID_CURSOR_CODE = "invalid_cursor";

/**
 * Error que el adapter de `fetchPage` lanza cuando el server rechaza el
 * cursor enviado. `syncBox` lo interpreta como señal de resync completo
 * (T068): el estado guardado apunta a un cursor que el server ya no puede
 * resolver, así que la única salida segura es re-descargar desde el inicio.
 */
export class InvalidCursorError extends Error {
  readonly code = INVALID_CURSOR_CODE;

  constructor(message = "El cursor de sincronización es inválido.") {
    super(message);
    this.name = new.target.name;
  }
}

/** Reconoce `invalid_cursor` / `invalid cursor` en cualquier variante. */
const INVALID_CURSOR_PATTERN = /invalid[ _-]?cursor/i;

/**
 * Contrato entre `syncBox` y el adapter de `fetchPage`: si el server rechaza
 * el cursor, el error debe ser reconocible por esta función. Acepta la clase
 * `InvalidCursorError` o cualquier error duck-typed cuyo `code`, `name` o
 * `message` contenga `invalid_cursor` (o su variante con espacio). Así el
 * orquestador distingue "cursor rechazado" —que se autocura con un resync—
 * de cualquier otro fallo, que propaga sin tocar el estado guardado.
 */
export function isInvalidCursorError(error: unknown): boolean {
  if (error instanceof InvalidCursorError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, name, message } = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };

  return [code, name, message].some(
    (value) => typeof value === "string" && INVALID_CURSOR_PATTERN.test(value),
  );
}

/**
 * Parámetros de una página del delta. El orquestador envía la forma
 * descompuesta (`sinceDate` + `sinceTransactionId`, derivada de
 * `parseCursor`), que es la que entiende el endpoint de T062. El campo
 * `cursor` queda en el contrato para adapters que prefieran mandar el
 * cursor opaco tal cual; los campos ausentes simplemente no se envían.
 */
export type SyncPageParams = {
  /** Unix ms de la última tx aplicada: devolver tuplas mayores. */
  sinceDate?: number;
  /** Id de la última tx aplicada: desempata el mismo timestamp. */
  sinceTransactionId?: string;
  /** Cursor opaco alternativo al par anterior (el orquestador no lo usa). */
  cursor?: string;
  /** Tamaño máximo de página. */
  limit?: number;
};

/** Una página del delta, mismo shape que responde el endpoint (T062). */
export type SyncPage = {
  /** Transacciones del delta, en orden de tupla (createdAt, id). */
  transactions: SyncTransaction[];
  /** Cursor de la última tx de la página; `null` si la página vino vacía. */
  nextCursor: string | null;
  /** `true` si hay más páginas después de esta. */
  hasMore: boolean;
};

/** Adapter de persistencia del `BalanceState`, una entrada por boxId. */
export type SyncStorage = {
  /** Estado guardado para el box, o `null` si nunca se sincronizó. */
  get(boxId: string): BalanceState | null;
  /** Reemplaza el estado guardado del box (persistencia crash-safe). */
  set(boxId: string, state: BalanceState): void;
  /** Opcional: borra la entrada del box (logout, box eliminado, etc.). */
  clear?(boxId: string): void;
};

/**
 * Adapter de red: devuelve UNA página del delta para `boxId`. El adapter
 * real (T080) llama al endpoint incremental y lanza `InvalidCursorError`
 * cuando el server rechaza el cursor; cualquier otro fallo se propaga tal
 * cual (el orquestador no reintentan errores de red).
 */
export type FetchPage = (
  boxId: string,
  params: SyncPageParams,
) => Promise<SyncPage>;

/** Dependencias inyectables de `createBoxSync`. */
export type BoxSyncDeps = {
  storage: SyncStorage;
  fetchPage: FetchPage;
};

/** Opciones de `syncBox`. */
export type SyncOptions = {
  /** Tamaño máximo de página pedido al server en cada vuelta del loop. */
  limit?: number;
};

/** Resultado de una `syncBox` completada. */
export type SyncResult = {
  /** Balance acumulado en unidades menores tras aplicar todo el delta. */
  balanceMinor: number;
  /** Transacciones recibidas en ESTA sync (un resync las re-descarga todas). */
  transactionsDownloaded: number;
  /** Total histórico de transacciones aplicadas en la caché. */
  transactionCount: number;
  /** Cursor final guardado (`null` si la alcancía no tiene transacciones). */
  cursor: string | null;
};

/** Orquestador creado por `createBoxSync`. */
export type BoxSync = {
  /**
   * Sincroniza una alcancía: lee el estado guardado, descarga el delta
   * paginando hasta `hasMore: false` y devuelve el estado resultante.
   */
  syncBox(boxId: string, opts?: SyncOptions): Promise<SyncResult>;
};

/**
 * Arma los params del pedido a partir del estado: un cursor válido se
 * descompone en `sinceDate` + `sinceTransactionId`. Lanza
 * `InvalidCursorError` si el cursor guardado no parsea: en el flujo normal
 * es inalcanzable (`syncBox` valida el cursor antes de entrar al loop y
 * `applyTransactions` siempre produce cursores válidos), pero cubre el caso
 * de un storage mutado en medio de la sync — el catch de `syncBox` lo trata
 * como T068 y resincroniza desde cero.
 */
function pageParams(state: BalanceState, limit?: number): SyncPageParams {
  const params: SyncPageParams = {};
  if (limit !== undefined) {
    params.limit = limit;
  }

  if (state.cursor === null) {
    return params;
  }

  const parsed = parseCursor(state.cursor);
  if (parsed === null) {
    throw new InvalidCursorError();
  }

  params.sinceDate = parsed.createdAtMs;
  params.sinceTransactionId = parsed.id;
  return params;
}

export function createBoxSync(deps: BoxSyncDeps): BoxSync {
  const { storage, fetchPage } = deps;

  /**
   * Corre el loop de páginas partiendo de `start`: pide, aplica y persiste
   * DESPUÉS de cada página, y corta cuando `hasMore` es false.
   */
  async function run(
    boxId: string,
    start: BalanceState,
    limit?: number,
  ): Promise<SyncResult> {
    let state = start;
    let transactionsDownloaded = 0;

    for (;;) {
      const page = await fetchPage(boxId, pageParams(state, limit));

      // Guarda anti-bucle: un server que marca hasMore sin devolver
      // transacciones dejaría el loop girando para siempre (el cursor no
      // avanza y el próximo pedido repetiría la misma página). Cortar es
      // seguro: lo pendiente lo levanta la próxima sync desde el cursor.
      if (page.transactions.length === 0 && page.hasMore) {
        break;
      }

      state = applyTransactions(state, page.transactions);
      transactionsDownloaded += page.transactions.length;

      // Persistencia por página: el estado guardado siempre es un prefijo
      // consistente de la sync (crash-safe).
      storage.set(boxId, state);

      if (!page.hasMore) {
        break;
      }
    }

    return {
      balanceMinor: state.balanceMinor,
      transactionsDownloaded,
      transactionCount: state.transactionCount,
      cursor: state.cursor,
    };
  }

  /**
   * T068: descarta el estado guardado y re-sincroniza todo desde el inicio.
   * El estado vacío se persiste ANTES del primer pedido: aunque el resync
   * muera a mitad de camino, storage nunca queda con el estado corrupto, y
   * lo descargado hasta ahí es un prefijo reanudable desde el cursor.
   */
  function fullResync(boxId: string, limit?: number): Promise<SyncResult> {
    const fresh = emptyBalanceState();
    storage.set(boxId, fresh);
    return run(boxId, fresh, limit);
  }

  async function syncBox(
    boxId: string,
    opts?: SyncOptions,
  ): Promise<SyncResult> {
    const limit = opts?.limit;
    const saved = storage.get(boxId);

    // Estado ausente o cursor que no parsea → resync completo (T068). Sin
    // cursor no hay posición reanudable: aplicar un delta fresco sobre un
    // balance no verificado podría derivar; desde cero es siempre correcto.
    if (
      saved === null ||
      saved.cursor === null ||
      parseCursor(saved.cursor) === null
    ) {
      return fullResync(boxId, limit);
    }

    try {
      return await run(boxId, saved, limit);
    } catch (error) {
      // Cursor rechazado por el server → UN resync completo (T068). Otro
      // error (red, auth, …) propaga sin tocar el estado guardado. Si el
      // resync vuelve a fallar, ese error propaga sin nuevos reintentos.
      if (!isInvalidCursorError(error)) {
        throw error;
      }
      return fullResync(boxId, limit);
    }
  }

  return { syncBox };
}
