import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { sessions, users } from "@/db/schema";
import { hashAccessToken } from "@/lib/crypto/token";
import { RECOVERY_WORDLIST } from "@/lib/recovery-words";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import { recoverAccount } from "@/server/auth/recovery";
import {
  createSessionRow,
  loginUser,
  registerUser,
  resolveSessionUser,
} from "@/server/auth/service";
import { InvalidCredentialsError, ValidationError } from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";

/**
 * T035 — flujo `recoverAccount` contra DB real: reset de password con frase
 * de recuperación + nuevo password, y borrado de TODAS las sesiones previas.
 * Email inexistente, frase incorrecta y cuentas sin frase guardada comparten
 * el MISMO error genérico (`invalid_credentials`), igual que login: no se
 * filtra cuál de los tres falló.
 */

vi.mock("server-only", () => ({}));

const EMAIL = "recover@example.com";
const OLD_PASSWORD = "password-viejo-seguro";
const NEW_PASSWORD = "password-nuevo-seguro";

/** Frase bien formada (12 palabras) pero incorrecta (no es la registrada). */
const WRONG_PHRASE =
  "lunes-martes-miercoles-jueves-viernes-sabado-domingo-enero-febrero-marzo-abril-mayo";

describe("recoverAccount (T035)", () => {
  const { db, migrateOnce } = createTestDb();
  const key = encodeEncryptionKeyForTests();
  let registeredPhrase: string;

  beforeAll(async () => {
    await migrateOnce();
    const { recoveryPhrase } = await registerUser(
      db,
      {
        email: EMAIL,
        password: OLD_PASSWORD,
        name: "Recover User",
      },
      key,
    );
    registeredPhrase = recoveryPhrase;
    resetRateLimit(`recover:${EMAIL}`);
  });

  it("reset exitoso: login con el password nuevo funciona y el viejo falla", async () => {
    const result = await recoverAccount(db, {
      email: EMAIL,
      phrase: registeredPhrase,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: true });

    // Login con el password nuevo: OK.
    const { user } = await loginUser(db, {
      email: EMAIL,
      password: NEW_PASSWORD,
    });
    expect(user.email).toBe(EMAIL);

    // El password viejo ya no funciona.
    await expect(
      loginUser(db, { email: EMAIL, password: OLD_PASSWORD }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    // El hash en DB es scrypt y no contiene el password plano.
    const stored = await db
      .select()
      .from(users)
      .where(eq(users.email, EMAIL))
      .limit(1);
    expect(stored[0]?.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(stored[0]?.passwordHash).not.toContain(NEW_PASSWORD);

    // La frase NO cambia en recovery (decisión: la frase es estable).
    expect(stored[0]?.recoveryPhraseHash).toBeTruthy();
    resetRateLimit(`recover:${EMAIL}`);
  });

  it("todas las sesiones previas quedan muertas (resolveSessionUser → null)", async () => {
    const userRow = (
      await db.select().from(users).where(eq(users.email, EMAIL)).limit(1)
    )[0];
    expect(userRow).toBeDefined();
    const userId = userRow?.id ?? "";

    // Dos sesiones activas del mismo usuario.
    const { token: tokenA } = await createSessionRow(db, userId);
    const { token: tokenB } = await createSessionRow(db, userId);

    // Ambas resuelven antes del recovery.
    expect(await resolveVia(tokenA)).not.toBeNull();
    expect(await resolveVia(tokenB)).not.toBeNull();

    await recoverAccount(db, {
      email: EMAIL,
      phrase: registeredPhrase,
      newPassword: NEW_PASSWORD,
    });

    // Ninguna de las dos autentica después.
    expect(await resolveVia(tokenA)).toBeNull();
    expect(await resolveVia(tokenB)).toBeNull();

    // Y las filas se borraron físicamente.
    const remaining = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(remaining).toHaveLength(0);
    resetRateLimit(`recover:${EMAIL}`);
  });

  it("frase incorrecta → InvalidCredentialsError (y no cambia el password)", async () => {
    const wrongPhrase = registeredPhrase
      .split("-")
      .map((word, i) => (i === 0 ? "zzzzzzz" : word))
      .join("-");

    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: wrongPhrase,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: wrongPhrase,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    // El password sigue siendo el nuevo del reset anterior: no cambió.
    const { user } = await loginUser(db, {
      email: EMAIL,
      password: NEW_PASSWORD,
    });
    expect(user.email).toBe(EMAIL);
    resetRateLimit(`recover:${EMAIL}`);
  });

  it("frase bien formada (12 palabras de la wordlist) pero incorrecta → InvalidCredentialsError", async () => {
    // Distinto del caso anterior: acá la frase pasa el schema, ES parseable
    // (`parseRecoveryPhrase` devuelve palabras) pero su hash no coincide
    // con el guardado. Cubre la rama "parsedPhrase válida → hash mismatch".
    const validButWrong = RECOVERY_WORDLIST.slice(0, 12).join("-");

    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: validButWrong,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    resetRateLimit(`recover:${EMAIL}`);
  });

  it("email inexistente → el MISMO error genérico que frase incorrecta", async () => {
    const ghostError = await recoverAccount(db, {
      email: "ghost@example.com",
      phrase: registeredPhrase,
      newPassword: NEW_PASSWORD,
    }).catch((error: unknown) => error);
    const wrongPhraseError = await recoverAccount(db, {
      email: EMAIL,
      phrase: WRONG_PHRASE,
      newPassword: NEW_PASSWORD,
    }).catch((error: unknown) => error);

    expect(ghostError).toBeInstanceOf(InvalidCredentialsError);
    expect(ghostError).toMatchObject({ code: "invalid_credentials" });
    // Mismo tipo y mismo code estable para ambos casos (no se filtra cuál falló).
    expect((ghostError as InvalidCredentialsError).code).toBe(
      (wrongPhraseError as InvalidCredentialsError).code,
    );
    expect((ghostError as InvalidCredentialsError).message).toBe(
      (wrongPhraseError as InvalidCredentialsError).message,
    );
    resetRateLimit(`recover:${EMAIL}`);
  });

  it("cuenta sin frase guardada (pre-T033) → mismo error genérico", async () => {
    const noPhraseEmail = "sinfrase-recover@example.com";
    const { user } = await registerUser(
      db,
      {
        email: noPhraseEmail,
        password: OLD_PASSWORD,
        name: "Sin Frase Recover",
      },
      key,
    );
    await db
      .update(users)
      .set({ recoveryPhraseEncrypted: null, recoveryPhraseHash: null })
      .where(eq(users.id, user.id));
    resetRateLimit(`recover:${noPhraseEmail}`);

    await expect(
      recoverAccount(db, {
        email: noPhraseEmail,
        phrase: registeredPhrase,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      recoverAccount(db, {
        email: noPhraseEmail,
        phrase: registeredPhrase,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    resetRateLimit(`recover:${noPhraseEmail}`);
  });

  it("entrada inválida → ValidationError con fieldErrors por campo", async () => {
    const cases = [
      {
        email: "no-email",
        phrase: registeredPhrase,
        newPassword: NEW_PASSWORD,
      },
      { email: EMAIL, phrase: "una-sola-palabra", newPassword: NEW_PASSWORD },
      { email: EMAIL, phrase: registeredPhrase, newPassword: "corto" },
    ];
    for (const bad of cases) {
      await expect(recoverAccount(db, bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    try {
      await recoverAccount(db, {
        email: EMAIL,
        phrase: "una-sola-palabra",
        newPassword: NEW_PASSWORD,
      });
      expect.unreachable();
    } catch (error) {
      const validation = error as ValidationError;
      expect(validation.code).toBe("validation");
      expect(Object.keys(validation.fieldErrors)).toContain("phrase");
    }
    // La validación falla antes del rate limit: no consume cupo.
    resetRateLimit(`recover:${EMAIL}`);
  });

  /** Helper: resuelve la sesión como lo haría `getCurrentUser`. */
  async function resolveVia(token: string) {
    return resolveSessionUser(db, hashAccessToken(token));
  }
});
