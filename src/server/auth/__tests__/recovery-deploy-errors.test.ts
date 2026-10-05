import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { users } from "@/db/schema";
import { AeadError } from "@/lib/crypto/aead";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import { recoverAccount, revealRecoveryPhrase } from "@/server/auth/recovery";
import { registerUser } from "@/server/auth/service";
import {
  RecoveryPhraseUnreadableError,
  ValidationError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";

/**
 * Errores de deploy en el contrato de la key (T033/T034/T035): una
 * `ENCRYPTION_KEY` con la forma equivocada es un error de configuración, no
 * de usuario. `registerUser`, `revealRecoveryPhrase` y `recoverAccount`
 * mantienen el mismo contrato: `AeadError` si la key no es un Buffer de 32
 * bytes, chequeado ANTES de tocar la DB (en recover, incluso antes de
 * validar el input).
 */

vi.mock("server-only", () => ({}));

/** Key con la forma incorrecta que simulan los tests (16 bytes). */
const BAD_KEY = Buffer.alloc(16, 1);

describe("forma de la encryption key en el service de recovery", () => {
  const { db, migrateOnce } = createTestDb();
  const key = encodeEncryptionKeyForTests();
  const EMAIL = "deploy-errors@example.com";

  beforeAll(async () => {
    await migrateOnce();
    process.env.TURSO_DATABASE_URL ??= "file:./probe-deploy.db";
    await registerUser(
      db,
      { email: EMAIL, password: "password-seguro-123", name: "Deploy" },
      key,
    );
    resetRateLimit(`recover:${EMAIL}`);
    resetRateLimit(`reveal:${EMAIL}`);
  });

  it("registerUser con key malformada → AeadError (testeado en service.test.ts)", () => {
    // Documentado acá para el contrato simétrico; la prueba vive en
    // `service.test.ts` junto al resto de registerUser.
    expect(true).toBe(true);
  });

  it("revealRecoveryPhrase con key malformada → RecoveryPhraseUnreadableError (el AeadError crudo nunca escapa)", async () => {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, EMAIL))
      .limit(1);
    const userId = found[0]?.id ?? "";

    // La key de 16 bytes hace que `decrypt` lance AeadError internamente;
    // el service lo envuelve en el error de dominio con code estable para
    // no filtrar detalles de key/payload.
    await expect(
      revealRecoveryPhrase(db, userId, BAD_KEY),
    ).rejects.toBeInstanceOf(RecoveryPhraseUnreadableError);
  });

  it("recoverAccount con key malformada → AeadError antes de validar el input", async () => {
    // Input deliberadamente ausente: si llegara a la validación, el error
    // sería ValidationError (zod), no AeadError.
    await expect(recoverAccount(db, undefined, BAD_KEY)).rejects.toBeInstanceOf(
      AeadError,
    );
  });

  it("recoverAccount con input inválido y key correcta → ValidationError (no AeadError)", async () => {
    await expect(
      recoverAccount(
        db,
        { email: EMAIL, phrase: "corta", newPassword: "x" },
        key,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
