"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { hashAccessToken } from "@/lib/crypto/token";
import { env } from "@/lib/env";
import {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
} from "@/lib/validation/auth";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/server/auth/cookies";
import { decodeEncryptionKey } from "@/server/auth/encryption-key";
import {
  loginUser as loginUserInDb,
  logoutSession,
  registerUser as registerUserInDb,
} from "@/server/auth/service";
import {
  EmailTakenError,
  InvalidCredentialsError,
  RateLimitError,
  ValidationError,
} from "@/server/errors";

/**
 * Server actions de auth (capa delgada): validan la entrada, delegan la lógica
 * de DB a `service.ts` y manejan la cookie de sesión con `next/headers`.
 * Todas devuelven resultados tipados y serializables (los errores de dominio
 * se convierten en `{ ok: false, error: { code, ... } }`; los inesperados se
 * propagan y Next los redacta antes de llegar al cliente).
 */

/** Fallo tipado devuelto por las actions: `code` estable para la UI. */
export type ActionError =
  | { code: "email_taken" }
  | { code: "invalid_credentials" }
  | { code: "rate_limited"; retryAfterMs: number }
  | { code: "validation"; fieldErrors: Record<string, string[]> };

/** Éxito de register/login: id, email y nombre del usuario con sesión activa. */
export type AuthActionSuccess = {
  ok: true;
  user: { id: string; email: string; name: string };
};

/**
 * Éxito de register: el usuario con sesión activa y la frase de recuperación
 * **cruda**, que la UI muestra una sola vez post-registro (T033). Luego no se
 * vuelve a obtener sin auth (T034). Nunca loguear.
 */
export type RegisterActionSuccess = {
  ok: true;
  user: { id: string; email: string; name: string };
  recoveryPhrase: string;
};

/** Éxito de logout (idempotente: sin cookie también es ok). */
export type LogoutActionSuccess = { ok: true };

/** Unión de resultados de register/login. */
export type AuthActionResult =
  | RegisterActionSuccess
  | AuthActionSuccess
  | { ok: false; error: ActionError };

/** Convierte un ValidationError en la forma `{ ok: false, ... }` de la action. */
function validationFailure(error: ValidationError): AuthActionResult {
  return {
    ok: false,
    error: {
      code: "validation",
      fieldErrors: error.fieldErrors,
    },
  };
}

/** Forma segura de extraer `fieldErrors` de un error Zod en runtime. */
function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * Crea cuenta e inicia sesión. Devuelve `{ ok: true, user, recoveryPhrase }`
 * (la frase cruda se devuelve **una sola vez**, para mostrarla en la UI
 * post-registro; luego no se vuelve a obtener sin auth) o un error tipado:
 * `validation` (con `fieldErrors` por campo), `email_taken` (el email ya
 * tiene cuenta). La frase nunca se loguea.
 */
export async function register(
  input: RegisterInput,
): Promise<AuthActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        fieldErrors: zodFieldErrors(parsed.error),
      },
    };
  }

  const encryptionKey = decodeEncryptionKey(env.encryptionKey);
  if (!encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY no está configurada: no se puede registrar usuarios.",
    );
  }

  try {
    const { user, sessionToken, recoveryPhrase } = await registerUserInDb(
      db,
      parsed.data,
      encryptionKey,
    );
    // Cookie httpOnly con el token de la sesión recién creada (mismo request).
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      recoveryPhrase,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationFailure(error);
    }
    if (error instanceof EmailTakenError) {
      return { ok: false, error: { code: "email_taken" } };
    }
    throw error; // errores inesperados: los redacta Next
  }
}

/**
 * Inicia sesión con email + password. Email inexistente y password incorrecto
 * devuelven el mismo error `invalid_credentials` (no se revela cuál falló;
 * el service además empareja el timing con un hash dummy). El exceso de
 * intentos (5/min por email, T085) devuelve `rate_limited` con
 * `retryAfterMs` para que la UI muestre la espera.
 */
export async function login(input: LoginInput): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        fieldErrors: zodFieldErrors(parsed.error),
      },
    };
  }

  try {
    const { user, sessionToken } = await loginUserInDb(db, parsed.data);
    // Cookie httpOnly con el token de la sesión recién creada (mismo request).
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationFailure(error);
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
    throw error;
  }
}

/**
 * Cierra la sesión actual: borra la fila por hash del token y expira la
 * cookie. Idempotente: sin cookie (o con sesión ya borrada) devuelve
 * `{ ok: true }` sin fallar.
 */
export async function logout(): Promise<LogoutActionSuccess> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (raw) {
    await logoutSession(db, hashAccessToken(raw));
  }

  // `delete` con las mismas opciones que `set`: path y dominio deben coincidir
  // para que el browser descarte la cookie.
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });

  return { ok: true };
}
