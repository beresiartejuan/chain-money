import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AeadError, decrypt, encrypt } from "@/lib/crypto/aead";

function newKey(): Buffer {
  return randomBytes(32);
}

describe("encrypt / decrypt", () => {
  it("roundtrip devuelve el original", () => {
    const key = newKey();
    const plaintext = "recovery phrase con acentos y emoji: óíñ 🚀";
    expect(decrypt(encrypt(plaintext, key), key)).toBe(plaintext);
  });

  it("genera payloads con formato v1$iv$tag$ciphertext (base64)", () => {
    const payload = encrypt("hola", newKey());
    const parts = payload.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // IV de 12 bytes → 16 chars base64
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
  });

  it("dos encrypts del mismo texto difieren (IV aleatorio)", () => {
    const key = newKey();
    expect(encrypt("mismo texto", key)).not.toBe(encrypt("mismo texto", key));
  });
});

describe("decrypt", () => {
  it("falla la autenticación si se altera un byte del ciphertext", () => {
    const key = newKey();
    const payload = encrypt("secreto", key);
    const parts = payload.split("$");
    const ciphertext = Buffer.from(parts[3], "base64");
    ciphertext[0] ^= 0x01; // alterar un byte
    parts[3] = ciphertext.toString("base64");
    expect(() => decrypt(parts.join("$"), key)).toThrow(AeadError);
  });

  it("falla la autenticación si se altera el tag", () => {
    const key = newKey();
    const parts = encrypt("secreto", key).split("$");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() => decrypt(parts.join("$"), key)).toThrow(AeadError);
  });

  it("falla con una key distinta", () => {
    expect(() => decrypt(encrypt("secreto", newKey()), newKey())).toThrow(
      AeadError,
    );
  });

  it("lanza AeadError ante payload con formato inválido", () => {
    const key = newKey();
    expect(() => decrypt("no-es-un-payload", key)).toThrow(AeadError);
    expect(() => decrypt("v1$solo$tres", key)).toThrow(AeadError);
    expect(() => decrypt("v1$iv$tag$ct$extra", key)).toThrow(AeadError);
  });

  it("lanza AeadError ante versión desconocida", () => {
    const key = newKey();
    const payload = encrypt("secreto", key).replace("v1", "v2");
    expect(() => decrypt(payload, key)).toThrow(AeadError);
  });

  it("lanza AeadError ante IV inválido", () => {
    const key = newKey();
    const parts = encrypt("secreto", key).split("$");
    parts[1] = Buffer.from("corto").toString("base64");
    expect(() => decrypt(parts.join("$"), key)).toThrow(AeadError);
  });
});

describe("validación de key", () => {
  it("lanza error claro con key de 16 bytes", () => {
    const key = randomBytes(16);
    expect(() => encrypt("x", key)).toThrow(/32 bytes/);
    expect(() => decrypt("v1$a$b$c", key)).toThrow(/32 bytes/);
  });

  it("lanza error si la key no es un Buffer", () => {
    // Biome no permite aserciones TS en tests; simulamos con un valor runtime inválido.
    const notABuffer = new Date() as unknown as Buffer;
    expect(() => encrypt("x", notABuffer)).toThrow(AeadError);
  });
});
