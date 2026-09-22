import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { type Session, sessions, type User, users } from "@/db/schema";
import { encrypt } from "@/lib/crypto/aead";
import { hashPassword, verifyPassword } from "@/lib/crypto/password";
import { newId } from "@/lib/ids";
import { generateRecoveryPhrase, parseRecoveryPhrase } from "@/lib/recovery";
import {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
} from "@/lib/validation/auth";
import { SESSION_TTL_MS } from "@/server/auth/cookies";
import {
  EmailTakenError,
  InvalidCredentialsError,
  RateLimitError,
  ValidationError,
} from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import { RATE_LIMITS, rateLimitKey } from "@/server/rate-limits";

/**
 * Lógica de negocio de auth, pura respecto al request: cada función recibe la
 * db por parámetro y no toca cookies (`next/headers`) ni nada del runtime de
 * Next. Así es testeable con una DB real y reutilizable desde actions, Route
 * Handlers o jobs. `actions.ts` es la capa delgada que valida y setea la
 * cookie.
 */

/**
 * Lo mínimo que `toFieldErrors` necesita de un error de Zod. Se define aquí
 * (en vez de importar tipos internos de zod) para no acoplar el service a la
 * versión interna de Zod.
 */
type ZodLikeError = { issues: { path: PropertyKey[]; message: string }[] };

/**
 * Convierte un error de Zod en el mapa campo → mensajes que espera la UI.
 * Exportado para que `recovery.ts` use la misma conversión.
 */
export function toFieldErrors(error: ZodLikeError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field === "") continue;
    const messages = fieldErrors[field] ?? [];
    messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return fieldErrors;
}

/** Tipo de db esperado por el service: lo que produce `drizzle()` libsql. */
type Db = LibSQLDatabase;

/**
 * Hash fijo de un password dummy, precalculado una vez (lazy) con
 * `hashPassword`. Cuando el email no existe, el login corre `verifyPassword`
 * contra este hash con el mismo coste scrypt que un intento real: la respuesta
 * tarda lo mismo exista o no la cuenta, y no se filtran emails por timing.
 * T029 refina este patrón.
 */
let dummyHashPromise: Promise<string> | null = null;

async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("timing-equalizer-dummy-password");
  return dummyHashPromise;
}

/** Resultado de registrar: el usuario creado y su sesión ya activa. */
export type AuthSuccess = {
  user: User;
  session: Session;
  /**
   * Token crudo de la sesión recién creada: la action lo setea en la cookie
   * httpOnly dentro del mismo request y nunca lo persiste ni lo loguea.
   */
  sessionToken: string;
};

/**
 * Resultado de registrar con la frase de recuperación incluida: el usuario
 * creado, su sesión ya activa y la frase **cruda**, que la action devuelve a
 * la UI una sola vez (post-registro). Nunca se persiste la frase en claro ni
 * se vuelve a obtener sin auth (T034).
 */
export type RegisterSuccess = {
  user: User;
  session: Session;
  /**
   * Token crudo de la sesión recién creada (para la cookie httpOnly, una
   * sola vez dentro del request; nunca persistido ni logueado).
   */
  sessionToken: string;
  /** Frase de recuperación cruda (12 palabras, minúsculas, separadas por `-`). */
  recoveryPhrase: string;
};

/**
 * Normaliza una frase de recuperación recién generada para hashear/encriptar:
 * minúsculas + trim de extremos. Es la misma normalización que aplicará la
 * verificación en T034, así que el hash siempre coincide.
 */
function normalizePhrase(phrase: string): string {
  const parsed = parseRecoveryPhrase(phrase);
  if (!parsed) {
    throw new Error("Recovery phrase generated is invalid");
  }
  return parsed.join("-");
}

/**
 * Registra un usuario: valida, garantiza email único, guarda el password
 * hasheado (scrypt; el password plano nunca llega a la DB), genera la frase
 * de recuperación y crea una sesión activa.
 *
 * La frase se genera aquí y se persiste sin texto plano (T033):
 * - `recoveryPhraseHash`: SHA-256 hex de la frase normalizada (lowercase).
 * - `recoveryPhraseEncrypted`: AES-256-GCM (`encrypt`) de la frase
 *   normalizada, con la key de 32 bytes que recibe por parámetro.
 *
 * La frase cruda se devuelve una única vez en `RegisterSuccess.recoveryPhrase`
 * para que la UI la muestre en el registro; luego no hay forma de leerla sin
 * autenticación (T034). Nunca se loguea.
 *
 * @throws ValidationError si la entrada no pasa `registerSchema`.
 * @throws EmailTakenError si el email ya tiene una cuenta.
 * @throws AeadError si `encryptionKey` no es un Buffer de 32 bytes.
 */
export async function registerUser(
  db: Db,
  input: unknown,
  encryptionKey: Buffer,
): Promise<RegisterSuccess> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }
  const data: RegisterInput = parsed.data;

  // Chequeo explícito de unicidad para dar el error de dominio
  // `email_taken` (más claro que un UNIQUE violation crudo).
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  if (existing.length > 0) {
    throw new EmailTakenError();
  }

  // Frase de recuperación: se genera una vez, se hashea y se encripta, y el
  // texto crudo se descarta al salir de este scope (nunca se persiste ni se
  // loguea; solo viaja en el valor de retorno de esta función).
  const recoveryPhrase = normalizePhrase(generateRecoveryPhrase());
  const recoveryPhraseHash = createHash("sha256")
    .update(recoveryPhrase, "utf8")
    .digest("hex");
  const recoveryPhraseEncrypted = encrypt(recoveryPhrase, encryptionKey);

  const passwordHash = await hashPassword(data.password);
  const userId = newId();

  await db.insert(users).values({
    id: userId,
    email: data.email,
    passwordHash,
    name: data.name,
    recoveryPhraseEncrypted,
    recoveryPhraseHash,
  });

  const created = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = created[0];
  if (!user) {
    throw new Error("User not found right after insert");
  }

  const { token, row: session } = await createSessionRow(db, userId);
  return { user, session, sessionToken: token, recoveryPhrase };
}

/**
 * Autentica con email + password y crea una sesión activa.
 *
 * Flujo: validación → rate limit por email → lookup → verificación del
 * password → creación de sesión.
 *
 * Rate limit (T030/T083): 5 intentos por minuto por email, key
 * `login:{email}`. El check corre ANTES del lookup y la key usa la MISMA
 * normalización del email que el lookup: `loginSchema` valida el formato pero
 * NO recorta ni normaliza (postura del proyecto: no normalizar en silencio),
 * así que el email validado se usa tal cual en ambos lugares.
 *
 * Decisión sobre el contador (ventana fija): todo intento que llega al check
 * con cupo disponible **incrementa el contador**, independientemente de que el
 * login luego acierte o falle; los que llegan con la ventana agotada no suman
 * ni la estiran (semántica de `checkRateLimit`). En particular, el login
 * exitoso **NO resetea** el contador: resetearlo regalaría un oráculo de
 * enumeración de passwords (acertar limpiaría el cupo de la key y delataría
 * el acierto ante quien sondee la misma key). El cupo se recobra solo al
 * vencer la ventana. El estado vive en memoria por proceso (limitación
 * conocida del MVP, documentada en `rate-limit.ts`).
 *
 * Email inexistente y password incorrecto devuelven exactamente el mismo
 * error (`invalid_credentials`): no se revela cuál falló. Cuando el email no
 * existe, corre un `verifyPassword` dummy con el mismo coste scrypt para
 * emparejar el timing.
 *
 * @throws ValidationError si la entrada no pasa `loginSchema` (antes del
 *   rate limit: un input malformado no consume cupo, igual que en recovery).
 * @throws RateLimitError si el email agotó sus 5 intentos en la ventana de
 *   60s, con `retryAfterMs` para que la UI muestre la espera.
 * @throws InvalidCredentialsError si el email no existe o el password falla.
 */
export async function loginUser(db: Db, input: unknown): Promise<AuthSuccess> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }
  const data: LoginInput = parsed.data;

  // Rate limit por email, antes del lookup: el contador corre aunque el
  // email no exista (igual que `recoverAccount`). El intento consume cupo
  // venga o no el login; NO se resetea en éxito (el cupo se recobra solo
  // al vencer la ventana).
  const limit = checkRateLimit(
    rateLimitKey("login", data.email),
    RATE_LIMITS.login.limit,
    RATE_LIMITS.login.windowMs,
  );
  if (!limit.allowed) {
    throw new RateLimitError(limit.retryAfterMs);
  }

  const found = await db
    .select({ user: users })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  const user = found[0]?.user;

  const passwordOk = user
    ? await verifyPassword(data.password, user.passwordHash)
    : await verifyPassword(data.password, await getDummyHash());

  if (!user || !passwordOk) {
    throw new InvalidCredentialsError();
  }

  const { token, row: session } = await createSessionRow(db, user.id);
  return { user, session, sessionToken: token };
}

/** Resultado de crear una sesión: token crudo (uso interno) + fila creada. */
export type CreateSessionResult = {
  /** Token crudo. Solo para setear la cookie en el mismo request; nunca persistir. */
  token: string;
  /** Hash SHA-256 del token, igual a `sessions.id`. */
  tokenHash: string;
  /** Fila de sesión creada, tal como quedó en la DB. */
  row: Session;
};

/**
 * Crea una fila de sesión para `userId` y devuelve el token crudo. La DB
 * guarda el hash SHA-256 del token (id de la fila), nunca el token en claro.
 * Expira a `now + SESSION_TTL_MS` (30 días).
 *
 * @throws Error si `userId` no existe (FK violation del insert).
 */
export async function createSessionRow(
  db: Db,
  userId: string,
): Promise<CreateSessionResult> {
  const { generateAccessToken } = await import("@/lib/crypto/token");
  const token = generateAccessToken();
  const now = Date.now();

  const inserted = await db
    .insert(sessions)
    .values({
      id: token.hash,
      userId,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert session");
  }
  return { token: token.token, tokenHash: token.hash, row };
}

/**
 * Cierra la sesión cuyo id es `sessionTokenHash`: borra la fila por el hash
 * del token (nunca hay token crudo en DB). Idempotente: si la fila no existe,
 * no falla.
 */
export async function logoutSession(
  db: Db,
  sessionTokenHash: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionTokenHash));
}

/**
 * Resuelve el usuario dueño de la sesión `tokenHash`, verificando que la
 * sesión no haya expirado (`expiresAt > now`). Devuelve `null` si el hash no
 * corresponde a ninguna sesión o si está vencida: una sesión expirada NO
 * autentica.
 *
 * Pura respecto al request (recibe db y hash; no toca cookies), así que se
 * testa directo contra una DB real. `session.ts` es la capa que lee la cookie,
 * hashea el token y llama aquí. Opcionalmente borra la fila vencida al
 * consultarla (lazy-delete): la sesión muerta deja de ocupar lugar sin
 * necesidad de un job periódico.
 *
 * @param tokenHash Hash SHA-256 hex del token de sesión (igual a `sessions.id`).
 */
export async function resolveSessionUser(
  db: Db,
  tokenHash: string,
): Promise<User | null> {
  const now = Date.now();
  const found = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  const user = found[0]?.user;
  if (user) {
    return user;
  }

  // No autentica: si el motivo es que la sesión existe pero está vencida,
  // borra la fila (lazy-delete). Si el hash no existe, el delete es no-op.
  await db
    .delete(sessions)
    .where(and(eq(sessions.id, tokenHash), lte(sessions.expiresAt, now)));

  return null;
}
