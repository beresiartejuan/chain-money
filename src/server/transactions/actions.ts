"use server";

import { db } from "@/db";
import { requireCurrentUser } from "@/server/auth/session";
import {
  type ErrorCode,
  InsufficientFundsError,
  NotFoundError,
  PermissionError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";
import {
  type CreateTransactionInput,
  createTransaction as createTransactionInDb,
  type ResetBoxResult,
  resetBox as resetBoxInDb,
} from "@/server/transactions/service";

/**
 * Server actions de transacciones (T055/T058/T059, capa delgada): resuelven
 * la sesión con `requireCurrentUser` y delegan toda la lógica (gate de
 * permisos, validación, regla de balance e insert con atribución) a
 * `service.ts`. Devuelven resultados tipados y serializables: los errores
 * de dominio se convierten en `{ ok: false, error: { code, ... } }`; los
 * inesperados se propagan y Next los redacta antes de llegar al cliente.
 */

/** Shape serializable de una transacción en las actions. */
export type ActionTransaction = {
  id: string;
  boxId: string;
  type: string;
  amountMinor: number;
  counterparty: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
};

/** Éxito de createTransaction: la transacción tal como quedó en la DB. */
export type CreateTransactionActionSuccess = {
  ok: true;
  transaction: ActionTransaction;
};

/** Fallo tipado devuelto por la action: `code` estable para la UI. */
export type CreateTransactionActionError =
  | { code: "validation"; fieldErrors: Record<string, string[]> }
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" }
  | { code: "insufficient_funds" };

/** Unión de resultados de `createTransactionAction`. */
export type CreateTransactionActionResult =
  | CreateTransactionActionSuccess
  | { ok: false; error: CreateTransactionActionError };

/** Mapea la fila de DB al shape serializable de la action. */
function toActionTransaction(transaction: {
  id: string;
  boxId: string;
  type: string;
  amountMinor: number;
  counterparty: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
}): ActionTransaction {
  return {
    id: transaction.id,
    boxId: transaction.boxId,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    counterparty: transaction.counterparty,
    note: transaction.note,
    createdBy: transaction.createdBy,
    createdAt: transaction.createdAt,
  };
}

/**
 * Crea un movimiento (deposit/withdraw) en la alcancía `boxId` para el
 * usuario con sesión activa. Devuelve `{ ok: true, transaction }` o un
 * error tipado: `validation` (con `fieldErrors` por campo), `not_found`
 * (box inexistente o extraño sin relación), `forbidden` (sin
 * `create:transactions`) o `insufficient_funds` (withdraw que excede el
 * balance, T058).
 */
export async function createTransactionAction(
  boxId: string,
  input: CreateTransactionInput,
): Promise<CreateTransactionActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" satisfies ErrorCode } };
    }
    throw error;
  }

  try {
    const transaction = await createTransactionInDb(db, userId, boxId, input);
    return { ok: true, transaction: toActionTransaction(transaction) };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        ok: false,
        error: {
          code: "validation" satisfies ErrorCode,
          fieldErrors: error.fieldErrors,
        },
      };
    }
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    if (error instanceof InsufficientFundsError) {
      return {
        ok: false,
        error: { code: "insufficient_funds" satisfies ErrorCode },
      };
    }
    throw error; // errores inesperados: los redacta Next
  }
}

/** Éxito de resetBox: `reset: false` si el balance ya era 0 (no-op). */
export type ResetBoxActionSuccess = {
  ok: true;
  reset: boolean;
  balanceMinor: number;
};

/** Fallo tipado devuelto por `resetBoxAction`. */
export type ResetBoxActionError =
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" };

/** Unión de resultados de `resetBoxAction`. */
export type ResetBoxActionResult =
  | ResetBoxActionSuccess
  | { ok: false; error: ResetBoxActionError };

/**
 * Resetea el balance de la alcancía `boxId` a 0 (T059). Capa delgada sobre
 * `resetBox` del service: toda la lógica (gate `reset:box`, transacción de
 * DB, insert de la transacción `reset` con atribución) vive en
 * `service.ts`. Devuelve `{ ok: true, reset, balanceMinor: 0 }` o un error
 * tipado: `not_found`, `forbidden` (sin `reset:box`) o `unauthorized`.
 */
export async function resetBoxAction(
  boxId: string,
): Promise<ResetBoxActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" satisfies ErrorCode } };
    }
    throw error;
  }

  try {
    const result: ResetBoxResult = await resetBoxInDb(db, userId, boxId);
    return { ok: true, reset: result.reset, balanceMinor: result.balanceMinor };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    throw error; // errores inesperados: los redacta Next
  }
}
