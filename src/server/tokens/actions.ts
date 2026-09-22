"use server";

import { db } from "@/db";
import { requireCurrentUser } from "@/server/auth/session";
import {
  type ErrorCode,
  NotFoundError,
  OwnBoxRedeemError,
  PermissionError,
  RateLimitError,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  TokenInvalidError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";
import {
  createToken as createTokenInDb,
  expireToken as expireTokenInDb,
  listTokens as listTokensInDb,
  redeemToken as redeemTokenInDb,
  revokeToken as revokeTokenInDb,
} from "@/server/tokens/service";

/**
 * Server actions de tokens (capa delgada, T049/T050): resuelven la sesión
 * con `requireCurrentUser` y delegan toda la lógica a `service.ts`.
 * Devuelven resultados tipados y serializables: los errores de dominio se
 * convierten en `{ ok: false, error: { code, ... } }`; los inesperados se
 * propagan y Next los redacta antes de llegar al cliente.
 */

/** Éxito de createToken: el token crudo se muestra UNA vez y ya no vuelve. */
export type CreateTokenActionSuccess = {
  ok: true;
  token: string;
  id: string;
  prefix: string;
  permissions: string[];
};

/** Fallo tipado devuelto por `createTokenAction`. */
export type CreateTokenActionError =
  | { code: "validation"; fieldErrors: Record<string, string[]> }
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" };

/** Unión de resultados de `createTokenAction`. */
export type CreateTokenActionResult =
  | CreateTokenActionSuccess
  | { ok: false; error: CreateTokenActionError };

/**
 * Crea un token de un solo uso para compartir la alcancía `boxId` (T049).
 * Solo el owner puede crearlo; el token crudo vuelve en el resultado una
 * única vez (en DB queda solo el hash).
 */
export async function createTokenAction(
  boxId: string,
  permissions: string[],
): Promise<CreateTokenActionResult> {
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
    const result = await createTokenInDb(db, userId, boxId, permissions);
    return {
      ok: true,
      token: result.token,
      id: result.id,
      prefix: result.prefix,
      permissions: result.permissions,
    };
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
    throw error; // errores inesperados: los redacta Next
  }
}

/** Éxito de redeemToken: la UI redirige a la alcancía. */
export type RedeemTokenActionSuccess = {
  ok: true;
  boxId: string;
};

/** Fallo tipado devuelto por `redeemTokenAction`. */
export type RedeemTokenActionError =
  | { code: "token_invalid" }
  | { code: "token_expired" }
  | { code: "token_already_redeemed" }
  | { code: "own_box_redeem" }
  | { code: "rate_limited"; retryAfterMs: number }
  | { code: "unauthorized" };

/** Unión de resultados de `redeemTokenAction`. */
export type RedeemTokenActionResult =
  | RedeemTokenActionSuccess
  | { ok: false; error: RedeemTokenActionError };

/**
 * Canjea un token crudo (T050): otorga a la sesión actual el acceso que
 * describe el token. La UI usa `boxId` del resultado para redirigir.
 */
export async function redeemTokenAction(
  rawToken: string,
): Promise<RedeemTokenActionResult> {
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
    const { boxId } = await redeemTokenInDb(db, userId, rawToken);
    return { ok: true, boxId };
  } catch (error) {
    if (error instanceof TokenInvalidError) {
      return {
        ok: false,
        error: { code: "token_invalid" satisfies ErrorCode },
      };
    }
    if (error instanceof TokenExpiredError) {
      return {
        ok: false,
        error: { code: "token_expired" satisfies ErrorCode },
      };
    }
    if (error instanceof TokenAlreadyRedeemedError) {
      return {
        ok: false,
        error: { code: "token_already_redeemed" satisfies ErrorCode },
      };
    }
    if (error instanceof OwnBoxRedeemError) {
      return {
        ok: false,
        error: { code: "own_box_redeem" satisfies ErrorCode },
      };
    }
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        error: {
          code: "rate_limited" satisfies ErrorCode,
          retryAfterMs: error.retryAfterMs,
        },
      };
    }
    throw error;
  }
}

/** Éxito de revokeToken: la fila del token fue eliminada. */
export type RevokeTokenActionSuccess = {
  ok: true;
  id: string;
};

/** Fallo tipado devuelto por `revokeTokenAction`. */
export type RevokeTokenActionError =
  | { code: "token_already_redeemed" }
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" };

/** Unión de resultados de `revokeTokenAction`. */
export type RevokeTokenActionResult =
  | RevokeTokenActionSuccess
  | { ok: false; error: RevokeTokenActionError };

/**
 * Revoca (borra físicamente) el token `tokenId` (T052): solo el owner de la
 * alcancía, y solo mientras NO esté canjeado — el acceso ya otorgado
 * persiste (decisión de producto, T092), y la FK `tokenId` de `box_access`
 * es NOT NULL sin `ON DELETE`, así que borrar un token canjeado rompería la
 * trazabilidad (de eso responde `token_already_redeemed`).
 */
export async function revokeTokenAction(
  tokenId: string,
): Promise<RevokeTokenActionResult> {
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
    const { id } = await revokeTokenInDb(db, userId, tokenId);
    return { ok: true, id };
  } catch (error) {
    if (error instanceof TokenAlreadyRedeemedError) {
      return {
        ok: false,
        error: {
          code: "token_already_redeemed" satisfies ErrorCode,
        },
      };
    }
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    throw error; // errores inesperados: los redacta Next
  }
}

/** Éxito de expireToken: el token (posiblemente ya expirado) en su estado. */
export type ExpireTokenActionSuccess = {
  ok: true;
  id: string;
  status: string;
};

/** Fallo tipado devuelto por `expireTokenAction`. */
export type ExpireTokenActionError =
  | { code: "token_already_redeemed" }
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" };

/** Unión de resultados de `expireTokenAction`. */
export type ExpireTokenActionResult =
  | ExpireTokenActionSuccess
  | { ok: false; error: ExpireTokenActionError };

/**
 * Expira el token `tokenId` (T052): solo el owner; invalida canjes futuros
 * sin borrar la fila. Idempotente sobre tokens ya expirados.
 */
export async function expireTokenAction(
  tokenId: string,
): Promise<ExpireTokenActionResult> {
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
    const token = await expireTokenInDb(db, userId, tokenId);
    return { ok: true, id: token.id, status: token.status };
  } catch (error) {
    if (error instanceof TokenAlreadyRedeemedError) {
      return {
        ok: false,
        error: {
          code: "token_already_redeemed" satisfies ErrorCode,
        },
      };
    }
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    throw error;
  }
}

/** Item de la lista de tokens (T053): sin hash ni token crudo, solo prefix. */
export type ListTokensActionItem = {
  id: string;
  tokenPrefix: string;
  permissions: string[];
  status: string;
  createdAt: number;
  redeemedAt: number | null;
  redeemedByName: string | null;
};

/** Éxito de listTokens: los tokens de la alcancía, más nuevos primero. */
export type ListTokensActionSuccess = {
  ok: true;
  tokens: ListTokensActionItem[];
};

/** Fallo tipado devuelto por `listTokensAction`. */
export type ListTokensActionError =
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "unauthorized" };

/** Unión de resultados de `listTokensAction`. */
export type ListTokensActionResult =
  | ListTokensActionSuccess
  | { ok: false; error: ListTokensActionError };

/**
 * Lista los tokens de la alcancía `boxId` (T053): solo el owner, y el
 * payload jamás incluye el hash ni el token crudo (solo el prefix).
 */
export async function listTokensAction(
  boxId: string,
): Promise<ListTokensActionResult> {
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
    const tokens = await listTokensInDb(db, userId, boxId);
    return { ok: true, tokens };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    throw error;
  }
}
