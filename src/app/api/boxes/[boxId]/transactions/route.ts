import { db } from "@/db";
import { parseCursor } from "@/lib/cursor";
import { requireCurrentUser } from "@/server/auth/session";
import {
  type AppError,
  type ErrorCode,
  NotFoundError,
  PermissionError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";
import {
  getTransactionsWithAccess,
  type SyncTransaction,
} from "@/server/transactions/sync";

/**
 * Route Handler de sync incremental (T062/T063/T064). Capa delgada:
 * resuelve la sesión, parsea los query params a la entrada del service
 * (`getTransactionsWithAccess`) y mapea los errores de dominio a status
 * HTTP. Toda la lógica (gate de permisos, cursor, paginación) vive en
 * `src/server/transactions/sync.ts`, testeable sin HTTP.
 *
 * ## Query params (todos opcionales)
 *
 * - `sinceDate`: ISO 8601 (p. ej. `2026-09-20T00:00:00.000Z`, acepta
 *   offset u hora Z) **o** unix ms numérico. EXCLUSIVO: devuelve txs con
 *   `createdAt > sinceDate` — una tx con `createdAt === sinceDate` no se
 *   incluye. Solo fecha: para reanudar una página exacta usar `cursor`.
 * - `sinceTransactionId`: id de la tx ancla EN esta alcancía; se usa su
 *   `(createdAt, id)` como punto de partida. Si no existe ahí → 404.
 * - `limit`: 1..100, default 50.
 * - `cursor`: tupla opaca `(createdAt, id)` (T009, base64url) que esta API
 *   devolvió antes en `nextCursor`. Para reanudar una página: desempata
 *   por id las txs con el mismo `createdAt` (sin gaps ni duplicados, T063).
 *
 * Si llega más de uno: `cursor` > `sinceTransactionId` > `sinceDate`
 * (reanudación exacta > ancla por id > fecha-sola); se ignora el resto.
 *
 * ## Respuesta
 *
 * `{ transactions: Array<{ id, type, amountMinor, counterparty, note,
 * createdBy, createdAt }>, nextCursor, hasMore }`, ASC por `(createdAt,
 * id)`. `nextCursor` es el cursor de la última tx solo si `hasMore`;
 * `null` en la última página. Sin params → desde el inicio de la box
 * (paginación completa).
 *
 * ## Errores (códigos estables de `AppError` en el body)
 *
 * 401 sin sesión · 400 params inválidos (`validation`, incluye cursor
 * corrupto: el cliente hace full resync, cf. T068) · 404 extraño/box o tx
 * ancla inexistente (`not_found`) · 403 sin `view:transactions`
 * (`forbidden`) · 500 errores inesperados (sin cuerpo de error de dominio).
 */

/** Status HTTP de cada error de dominio esperado por este endpoint. */
const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  email_taken: 409,
  validation: 400,
  rate_limited: 429,
  no_recovery_phrase: 409,
  recovery_phrase_unreadable: 500,
  limit_reached: 409,
  not_found: 404,
  forbidden: 403,
  token_invalid: 400,
  token_already_redeemed: 409,
  token_expired: 410,
  own_box_redeem: 409,
  insufficient_funds: 422,
};

/** Respuesta de error JSON: `{ error: { code, ... } }`, códigos estables. */
type SyncErrorBody =
  | { code: "validation"; fieldErrors: Record<string, string[]> }
  | { code: ErrorCode };

/** `Response.json` con el status del error de dominio. */
function errorResponse(error: AppError): Response {
  const status = ERROR_STATUS[error.code] ?? 500;
  if (error instanceof ValidationError) {
    return Response.json(
      {
        error: {
          code: "validation" satisfies ErrorCode,
          fieldErrors: error.fieldErrors,
        } satisfies SyncErrorBody,
      },
      { status },
    );
  }
  return Response.json(
    { error: { code: error.code } satisfies SyncErrorBody },
    { status },
  );
}

/**
 * Convierte el query param `sinceDate` a unix ms. Acepta ISO 8601
 * (`Date.parse` incluye `Z`/offset) o unix ms como dígitos. `null` si el
 * valor está presente pero no es parseable (→ 400).
 */
function parseSinceDate(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Query params crudos de la request, ya validados. Las funciones de parseo
 * marcan los presentes-pero-inválidos y el constructor los rechaza con
 * `ValidationError` (400). El caller pasa `searchParams` de la URL.
 */
class SyncQuery {
  private invalid: Record<string, string[]> = {};

  /** `sinceDate` crudo (ISO 8601 o unix ms). */
  readonly sinceDateRaw: string | null;
  /** `sinceTransactionId` crudo. */
  readonly sinceTransactionIdRaw: string | null;
  /** `cursor` crudo (base64url de T009). */
  readonly cursorRaw: string | null;
  /** `limit` crudo. */
  readonly limitRaw: string | null;

  constructor(searchParams: URLSearchParams) {
    this.sinceDateRaw = searchParams.get("sinceDate");
    this.sinceTransactionIdRaw = searchParams.get("sinceTransactionId");
    this.cursorRaw = searchParams.get("cursor");
    this.limitRaw = searchParams.get("limit");
  }

  /** Marca `field` como inválido (400 con `fieldErrors` por campo). */
  private reject(field: string, message: string): void {
    const messages = this.invalid[field] ?? [];
    messages.push(message);
    this.invalid[field] = messages;
  }

  /** Unix ms de `sinceDate`; `undefined` si no vino; inválido → marca 400. */
  get sinceMs(): number | undefined {
    if (this.sinceDateRaw === null) {
      return undefined;
    }
    const ms = parseSinceDate(this.sinceDateRaw);
    if (ms === null) {
      this.reject(
        "sinceDate",
        "Debe ser una fecha ISO 8601 o unix ms válidos.",
      );
      return undefined;
    }
    return ms;
  }

  /** `limit` parseado; `undefined` si no vino; inválido → marca 400. */
  get limit(): number | undefined {
    if (this.limitRaw === null) {
      return undefined;
    }
    const parsed = Number(this.limitRaw);
    if (!Number.isInteger(parsed)) {
      this.reject("limit", "Debe ser un entero entre 1 y 100.");
      return undefined;
    }
    return parsed;
  }

  /** Cursor parseado (T009); `undefined` si no vino; corrupto → marca 400. */
  get cursor(): ReturnType<typeof parseCursor> | undefined {
    if (this.cursorRaw === null) {
      return undefined;
    }
    const parsed = parseCursor(this.cursorRaw);
    if (parsed === null) {
      // Cursor inválido → 400: el cliente resincroniza completo (T068).
      this.reject("cursor", "El cursor es inválido.");
      return undefined;
    }
    return parsed;
  }

  /** Lanza `ValidationError` si algún param presente era inválido. */
  assertValid(): void {
    if (Object.keys(this.invalid).length > 0) {
      throw new ValidationError(this.invalid);
    }
  }
}

/** Shape JSON de la respuesta de una página de sync. */
type SyncPageBody = {
  transactions: SyncTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * GET /api/boxes/[boxId]/transactions — delta incremental del historial.
 * Autenticado (401 sin sesión) y con gate `view:transactions` (403 sin el
 * permiso; extraño → 404). Mapea los errores de dominio del service a
 * status HTTP con códigos estables; los errores inesperados se propagan
 * (Next los redacta antes de llegar al cliente).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ boxId: string }> },
): Promise<Response> {
  try {
    const { boxId } = await params;

    const user = await requireCurrentUser();

    // Query params desde la URL estándar del Request (Web API): funciona
    // con el NextRequest que entrega Next (Request es su base) y con un
    // Request plano en tests. `searchParams` ya decodifica %3A etc.
    const query = new SyncQuery(new URL(request.url).searchParams);
    const sinceMs = query.sinceMs;
    const limit = query.limit;
    const since = query.cursor;
    query.assertValid();

    const result = await getTransactionsWithAccess(db, user.id, boxId, {
      since: since ?? undefined,
      sinceMs,
      sinceTransactionId: query.sinceTransactionIdRaw ?? undefined,
      limit,
    });

    const body: SyncPageBody = {
      transactions: result.transactions,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
    return Response.json(body, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse(error);
    }
    if (error instanceof ValidationError) {
      return errorResponse(error);
    }
    if (error instanceof NotFoundError) {
      return errorResponse(error);
    }
    if (error instanceof PermissionError) {
      return errorResponse(error);
    }
    throw error; // errores inesperados: los redacta Next
  }
}
