import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeEncryptionKey } from "../encryption-key";

// `server-only` lanza fuera del bundler de Next; stub vacío (patrón del
// resto de las suites).
vi.mock("server-only", () => ({}));

/**
 * `decodeEncryptionKey` (T033): decodifica `ENCRYPTION_KEY` (base64) al
 * Buffer de 32 bytes que espera AES-256-GCM. Es una función pura (sin DB ni
 * request), así que se testa directo.
 *
 * La variante "devuelve null si falta la variable" es la puerta del flujo de
 * desarrollo sin key; "lanza si no decodifica 32 bytes" convierte una key
 * malformada en un error de deploy inmediato (no algo de lo que recuperarse
 * en runtime).
 */

describe("decodeEncryptionKey (T033)", () => {
  const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (ORIGINAL_ENCRYPTION_KEY === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY;
    }
    vi.unstubAllEnvs();
  });

  it("devuelve Buffer de 32 bytes para una key válida", () => {
    const base64 = Buffer.alloc(32, 7).toString("base64");
    const key = decodeEncryptionKey(base64);

    expect(key).toBeInstanceOf(Buffer);
    expect(key?.length).toBe(32);
    expect(key?.[0]).toBe(7);
    expect(key?.[31]).toBe(7);
  });

  it("acepta cualquier contenido de 32 bytes decodificables (no solo ceros)", () => {
    const base64 = Buffer.from("0123456789abcdef0123456789abcdef").toString(
      "base64",
    );
    const key = decodeEncryptionKey(base64);
    expect(key?.length).toBe(32);
    expect(key?.toString("utf8")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("devuelve null si la variable no está configurada (undefined)", () => {
    expect(decodeEncryptionKey(undefined)).toBeNull();
  });

  it("devuelve null si la variable está vacía (misma postura que parseEnv)", () => {
    expect(decodeEncryptionKey("")).toBeNull();
  });

  it.each([
    ["key corta (16 bytes)", Buffer.alloc(16, 1).toString("base64")],
    ["key larga (64 bytes)", Buffer.alloc(64, 1).toString("base64")],
    ["string arbitrario no-base64-32", "esto-no-es-una-key"],
  ])("lanza con key malformada: %s", (_label, badKey) => {
    expect(() => decodeEncryptionKey(badKey)).toThrowError(/32 bytes/);
  });
});
