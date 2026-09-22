"use server";

import { db } from "@/db";
import { env } from "@/lib/env";
import { decodeEncryptionKey } from "@/server/auth/encryption-key";
import {
  recoverAccount as recoverAccountInDb,
  revealRecoveryPhrase as revealRecoveryPhraseInDb,
} from "@/server/auth/recovery";
import { requireCurrentUser } from "@/server/auth/session";
import {
  InvalidCredentialsError,
  NoRecoveryPhraseError,
  RateLimitError,
  RecoveryPhraseUnreadableError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";

/**
 * Server actions de recuperación (T034/T035/T036), capa delgada sobre
 * `recovery.ts`. Igual que `actions.ts`: validan/autentican lo que depende
 * del request (sesión via `requireCurrentUser`, key via `decodeEncryptionKey`)
 * y delegan la lógica de DB al service puro. Devuelven resultados tipados y
 * serializables; los errores de dominio se convierten en
 * `{ ok: false, error: { code, ... } }` y los inesperados se propagan para
 * que Next los redacte.
 */

/** Fallo tipado devuelto por las actions de recovery: `code` estable. */
export type RecoveryActionError =
  | { code: "unauthorized" }
  | { code: "invalid_credentials" }
  | { code: "validation"; fieldErrors: Record<string, string[]> }
  | { code: "rate_limited"; retryAfterMs: number }
  | { code: "no_recovery_phrase" }
  | { code: "recovery_phrase_unreadable" };

/** Éxito de reveal: la frase normalizada (12 palabras, minúsculas, `-`). */
export type RevealRecoveryPhraseActionSuccess = {
  ok: true;
  recoveryPhrase: string;
};

/** Resultado de `revealRecoveryPhrase` (action). */
export type RevealRecoveryPhraseActionResult =
  | RevealRecoveryPhraseActionSuccess
  | { ok: false; error: RecoveryActionError };

/** Éxito de recoverAccount: password reseteado y sesiones muertas. */
export type RecoverAccountActionSuccess = {
  ok: true;
};

/** Resultado de `recoverAccount` (action). */
export type RecoverAccountActionResult =
  | RecoverAccountActionSuccess
  | { ok: false; error: RecoveryActionError };

/**
 * Decodifica `ENCRYPTION_KEY` o lanza: sin key no se puede desencriptar la
 * frase, y eso es un error de deploy (como en `actions.ts`), no algo de lo
 * que recuperarse en runtime.
 */
function requireEncryptionKey(): Buffer {
  const encryptionKey = decodeEncryptionKey(env.encryptionKey);
  if (!encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY no está configurada: no se puede acceder a la frase de recuperación.",
    );
  }
  return encryptionKey;
}

/**
 * Revela la frase de recuperación del usuario autenticado (T034). Exige
 * sesión activa: sin sesión devuelve `unauthorized` y jamás llega a leer la
 * frase. Rate limit 3/hora por usuario, con auditoría server-side de
 * timestamp + userId (la frase nunca se loguea).
 */
export async function revealRecoveryPhrase(): Promise<RevealRecoveryPhraseActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" } };
    }
    throw error;
  }

  const encryptionKey = requireEncryptionKey();

  try {
    const { recoveryPhrase } = await revealRecoveryPhraseInDb(
      db,
      userId,
      encryptionKey,
    );
    return { ok: true, recoveryPhrase };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          retryAfterMs: error.retryAfterMs,
        },
      };
    }
    if (error instanceof NoRecoveryPhraseError) {
      return { ok: false, error: { code: "no_recovery_phrase" } };
    }
    if (error instanceof RecoveryPhraseUnreadableError) {
      return { ok: false, error: { code: "recovery_phrase_unreadable" } };
    }
    throw error; // errores inesperados: los redacta Next
  }
}

/**
 * Recupera la cuenta con email + frase + nuevo password (T035/T036). Reset
 * de password y borrado de todas las sesiones. Email inexistente, frase
 * incorrecta y cuentas sin frase guardada devuelven el mismo
 * `invalid_credentials`; el exceso de intentos (5/10 min por email) devuelve
 * `rate_limited` con `retryAfterMs` para que la UI muestre "esperá".
 */
export async function recoverAccount(
  input: unknown,
): Promise<RecoverAccountActionResult> {
  const encryptionKey = requireEncryptionKey();

  try {
    await recoverAccountInDb(db, input, encryptionKey);
    return { ok: true };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        ok: false,
        error: {
          code: "validation",
          fieldErrors: error.fieldErrors,
        },
      };
    }
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          retryAfterMs: error.retryAfterMs,
        },
      };
    }
    if (error instanceof InvalidCredentialsError) {
      return { ok: false, error: { code: "invalid_credentials" } };
    }
    throw error; // errores inesperados: los redacta Next
  }
}
