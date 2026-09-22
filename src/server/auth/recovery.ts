import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { sessions, users } from "@/db/schema";
import { AeadError, decrypt } from "@/lib/crypto/aead";
import { hashPassword } from "@/lib/crypto/password";
import { constantTimeEqual } from "@/lib/crypto/token";
import { parseRecoveryPhrase } from "@/lib/recovery";
import { type RecoverInput, recoverSchema } from "@/lib/validation/auth";
import { toFieldErrors } from "@/server/auth/service";
import {
  InvalidCredentialsError,
  NoRecoveryPhraseError,
  RateLimitError,
  RecoveryPhraseUnreadableError,
  ValidationError,
} from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import { RATE_LIMITS, rateLimitKey } from "@/server/rate-limits";

/**
 * Lógica de recuperación de cuenta (T034/T035/T036). Igual que `service.ts`:
 * pura respecto al request — cada función recibe la db por parámetro y no
 * toca cookies (`next/headers`), así que es testeable con una DB real y
 * reutilizable desde actions, Route Handlers o jobs. `recovery-actions.ts`
 * es la capa delgada que resuelve la sesión actual y decodifica la key.
 */

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/** Resultado de revelar la frase de recuperación de un usuario autenticado. */
export type RevealRecoveryPhraseResult = {
  /**
   * Frase **normalizada** (12 palabras en minúsculas unidas por `-`): es la
   * misma forma que se hasheó y encriptó en el registro, así que lo devuelto
   * es la versión canónica para copiar/guardar.
   */
  recoveryPhrase: string;
};

/** Resultado de recuperar la cuenta: password reseteado y sesiones muertas. */
export type RecoverAccountResult = {
  ok: true;
};

/**
 * Rate limits de este módulo, consolidados en `@/server/rate-limits` (T083).
 * Re-exportados con su nombre histórico: los tests los importan de acá
 * (`REVEAL_LIMIT`, `REVEAL_WINDOW_MS`), y quedan en un solo lugar para el
 * resto del código que ya consume estas constantes.
 */
export const REVEAL_LIMIT = RATE_LIMITS.reveal.limit;
export const REVEAL_WINDOW_MS = RATE_LIMITS.reveal.windowMs;

export const RECOVER_LIMIT = RATE_LIMITS.recover.limit;
export const RECOVER_WINDOW_MS = RATE_LIMITS.recover.windowMs;

/**
 * Verifica que `key` sea un Buffer de 32 bytes (AES-256), la misma forma que
 * exige `encrypt`/`decrypt` de `@/lib/crypto/aead`. Lanza `AeadError` si no:
 * mantiene el contrato simétrico con `registerUser` y detecta temprano una
 * key malformada de deploy.
 */
function assertEncryptionKeyShape(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new AeadError(
      `La key debe ser un Buffer de 32 bytes (AES-256), recibió ${key.length}`,
    );
  }
}

/**
 * Revela la frase de recuperación del usuario autenticado `userId`
 * (T034, caso "me la guardé mal").
 *
 * Orden intencional: primero el rate limit (3/hora por usuario), después
 * lookup + decrypt. Así un usuario bloqueado no consume decrypts y el
 * contador corre aunque la cuenta no tenga frase guardada (registros
 * previos a T033): el endpoint existe igual y no regala el estado de la
 * cuenta.
 *
 * Auditoría simple (MVP sin tabla): log server-side de timestamp + userId.
 * **Nunca se loguea la frase.**
 *
 * Requiere sesión activa: eso lo garantiza la action (`recovery-actions.ts`)
 * con `requireCurrentUser` antes de llegar aquí; el service es puro y no
 * toca cookies.
 *
 * @param now Momento del request, para el timestamp de auditoría. Default:
 *   `Date.now()` (separado para poder controlarlo en tests).
 * @throws RateLimitError si ya hizo 3 reveals en la hora en curso.
 * @throws NoRecoveryPhraseError si la cuenta no tiene frase guardada
 *   (registro previo a T033).
 * @throws RecoveryPhraseUnreadableError si el decrypt falla (payload
 *   alterado o key incorrecta): el AeadError crudo nunca escapa.
 */
export async function revealRecoveryPhrase(
  db: Db,
  userId: string,
  encryptionKey: Buffer,
  now: number = Date.now(),
): Promise<RevealRecoveryPhraseResult> {
  // Rate limit primero: el contador corre aunque después falle el lookup.
  const limit = checkRateLimit(
    rateLimitKey("reveal", userId),
    REVEAL_LIMIT,
    REVEAL_WINDOW_MS,
  );
  if (!limit.allowed) {
    throw new RateLimitError(limit.retryAfterMs);
  }

  const found = await db
    .select({ encrypted: users.recoveryPhraseEncrypted })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const encrypted = found[0]?.encrypted;
  if (encrypted === null || encrypted === undefined) {
    throw new NoRecoveryPhraseError();
  }

  let phrase: string;
  try {
    phrase = decrypt(encrypted, encryptionKey);
  } catch {
    // Nunca dejar escapar el AeadError crudo: puede denunciar detalles de
    // key/payload. Se envuelve en un error de dominio con code estable.
    throw new RecoveryPhraseUnreadableError();
  }

  // Auditoría: timestamp + userId. La frase jamás entra a este log.
  console.log(
    `[audit] recovery-phrase revealed at=${new Date(now).toISOString()} userId=${userId}`,
  );

  // Lo desencriptado ES la frase normalizada persistida en el registro
  // (12 palabras lowercase unidas por `-`); se devuelve tal cual.
  return { recoveryPhrase: phrase };
}

/**
 * Recupera la cuenta con email + frase de recuperación + nuevo password
 * (T035/T036): reset de password y borrado de TODAS las sesiones.
 *
 * Flujo: validación → rate limit por email (5/10 min) → lookup → verificación
 * de la frase → reset de password → delete de sesiones.
 *
 * Email inexistente, frase incorrecta y `recoveryPhraseHash` null (cuenta
 * previa a T033) producen exactamente el mismo `InvalidCredentialsError`
 * que login: no se revela cuál de los tres falló ni si el email existe.
 *
 * La frase NO se regenera ni se re-encripta en el recovery (decisión de
 * diseño: la frase es la llave maestra estable de la cuenta y no cambia).
 * `encryptionKey` es opcional y solo se valida si llega: mantiene el
 * contrato simétrico con `registerUser` (mismo tipo de key) y detecta
 * temprano una key malformada de deploy.
 *
 * @throws ValidationError si la entrada no pasa `recoverSchema`.
 * @throws RateLimitError si el email agotó sus 5 intentos en 10 minutos.
 * @throws InvalidCredentialsError si el email no existe, la frase no
 *   coincide o la cuenta no tiene frase guardada.
 */
export async function recoverAccount(
  db: Db,
  input: unknown,
  encryptionKey?: Buffer,
): Promise<RecoverAccountResult> {
  // 0. Si la key llegó (contrato simétrico con `registerUser`), debe tener
  //    la forma correcta: una key malformada es un error de deploy, no de
  //    usuario. No se usa para nada más (la frase no se re-encripta aquí).
  if (encryptionKey !== undefined) {
    assertEncryptionKeyShape(encryptionKey);
  }

  // 1. Validación de formato (antes del rate limit: un input malformado
  //    nunca llega a verificar frase ni consume cupo).
  const parsed = recoverSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }
  const data: RecoverInput = parsed.data;

  // 2. Rate limit por email (T036): frena la fuerza bruta de frases.
  const limit = checkRateLimit(
    rateLimitKey("recover", data.email),
    RECOVER_LIMIT,
    RECOVER_WINDOW_MS,
  );
  if (!limit.allowed) {
    throw new RateLimitError(limit.retryAfterMs);
  }

  // 3. Lookup por email (case-sensitive, igual que login).
  const found = await db
    .select()
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  const user = found[0];
  if (!user) {
    throw new InvalidCredentialsError();
  }

  // 4. Verificación constant-time del hash de la frase normalizada.
  //    Hash null (cuenta previa a T033) → mismo error genérico.
  if (user.recoveryPhraseHash === null) {
    throw new InvalidCredentialsError();
  }
  const parsedPhrase = parseRecoveryPhrase(data.phrase);
  if (!parsedPhrase) {
    // Formato válido según el schema pero palabras fuera de la wordlist:
    // no puede coincidir con ninguna frase generada → error genérico.
    throw new InvalidCredentialsError();
  }
  const normalized = parsedPhrase.join("-");
  const phraseHash = createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex");
  if (!constantTimeEqual(phraseHash, user.recoveryPhraseHash)) {
    throw new InvalidCredentialsError();
  }

  // 5. Reset de password (scrypt; el password plano nunca llega a la DB).
  const passwordHash = await hashPassword(data.newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

  // 6. Matar TODAS las sesiones del usuario: cualquier dispositivo con
  //    sesión activa queda deslogueado (el hash del token de su cookie ya
  //    no corresponde a ninguna fila).
  await db.delete(sessions).where(eq(sessions.userId, user.id));

  return { ok: true };
}
