import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { users } from "@/db/schema";
import { decrypt } from "@/lib/crypto/aead";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import { registerUser } from "@/server/auth/service";

/**
 * T033 — persistencia de la frase de recuperación en registro. La frase cruda
 * NUNCA llega a la DB: solo su hash SHA-256 (de la normalizada, en
 * minúsculas) y su versión AES-256-GCM roundtrip-able con la key. La frase
 * cruda viaja una sola vez en el retorno de `registerUser`, para la UI
 * post-registro.
 */

vi.mock("server-only", () => ({}));

const VALID_REGISTER = {
  email: "phrase@example.com",
  password: "contrasena-segura",
  name: "Phrase User",
};

describe("recovery phrase persistida (T033)", () => {
  const { db, migrateOnce } = createTestDb();
  const key = encodeEncryptionKeyForTests();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("registro genera frase: hash = sha256 de la normalizada, sin plaintext en DB", async () => {
    const { user, recoveryPhrase } = await registerUser(
      db,
      { ...VALID_REGISTER },
      key,
    );

    // La frase devuelta es una frase válida de 12 palabras en minúsculas
    const words = recoveryPhrase.split("-");
    expect(words).toHaveLength(12);
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/);
    }

    const stored = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const saved = stored[0];
    expect(saved).toBeDefined();

    // Hay encrypted y hash en DB
    expect(saved?.recoveryPhraseEncrypted).toBeTruthy();
    expect(saved?.recoveryPhraseHash).toBeTruthy();

    // La frase cruda NO aparece en ninguna columna de la fila. (No se
    // grepean palabras individuales: con 3-6 letras aleatorias colisionan
    // por azar dentro del ciphertext base64 — falsos positivos que hacían
    // flaky este test. La protección real está en el roundtrip de abajo:
    // la columna es AEAD, no plaintext.)
    const rowJson = JSON.stringify(saved);
    expect(rowJson).not.toContain(recoveryPhrase);

    // Hash determinista sobre la frase normalizada (lowercase + trim)
    const expectedHash = createHash("sha256")
      .update(recoveryPhrase.toLowerCase().trim(), "utf8")
      .digest("hex");
    expect(saved?.recoveryPhraseHash).toBe(expectedHash);
  });

  it("roundtrip: decrypt(recoveryPhraseEncrypted, key) === frase normalizada", async () => {
    const { user, recoveryPhrase } = await registerUser(
      db,
      {
        email: "roundtrip@example.com",
        password: "contrasena-segura",
        name: "Roundtrip User",
      },
      key,
    );

    const stored = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const saved = stored[0];
    expect(saved).toBeDefined();

    // El payload va en el formato v1$iv$tag$ciphertext de AEAD
    expect(saved?.recoveryPhraseEncrypted).toMatch(/^v1\$/);

    const decrypted = decrypt(saved?.recoveryPhraseEncrypted ?? "", key);
    expect(decrypted).toBe(recoveryPhrase.toLowerCase().trim());
  });

  it("otra key no descifra la frase (key correcta importa)", async () => {
    const { user } = await registerUser(
      db,
      {
        email: "wrongkey@example.com",
        password: "contrasena-segura",
        name: "Wrong Key User",
      },
      key,
    );

    const stored = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const saved = stored[0];
    expect(saved).toBeDefined();

    const otherKey = encodeEncryptionKeyForTests();
    expect(() =>
      decrypt(saved?.recoveryPhraseEncrypted ?? "", otherKey),
    ).toThrow();
  });

  it("registro con email duplicado no crea user con frase (error antes de insert)", async () => {
    // El happy path ya insertó `phrase@example.com`; registrar de nuevo lanza
    // EmailTakenError antes de generar/persistir otra frase.
    await expect(
      registerUser(db, { ...VALID_REGISTER, email: "phrase@example.com" }, key),
    ).rejects.toMatchObject({ code: "email_taken" });

    // Solo hay una fila para ese email
    const all = await db
      .select()
      .from(users)
      .where(eq(users.email, "phrase@example.com"));
    expect(all).toHaveLength(1);
  });
});
