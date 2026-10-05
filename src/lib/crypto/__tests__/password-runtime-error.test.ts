import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fallo del runtime de hashing (línea reject de `deriveKey`): con scrypt
 * real y parámetros en rango, el callback del helper promisificado nunca
 * recibe error; se fuerza mockeando `node:crypto` para que el callback
 * reciba uno. Contrato esperado: `hashPassword` NO traga el error (quien
 * llama — register/login — decide qué hacer con un fallo de hashing).
 *
 * Vive en archivo propio porque `vi.mock` se hoistea al tope: aislarlo evita
 * mockear `node:crypto` para las demás suites de password.
 */

// `randomBytes` sigue siendo real: hashPassword lo usa para la salt y el
// mock no debe afectarlo (el reject viene de `scrypt`).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: actual.randomBytes,
    scrypt: (
      _password: string,
      _salt: Buffer,
      _keylen: number,
      _options: unknown,
      callback: (error: Error | null, key?: Buffer) => void,
    ) => {
      callback(new Error("scrypt exploded"));
    },
  };
});

describe("hashPassword — fallo del runtime de scrypt", () => {
  let hashPasswordMocked: (plain: string) => Promise<string>;

  beforeAll(async () => {
    ({ hashPassword: hashPasswordMocked } = await import(
      "@/lib/crypto/password"
    ));
  });

  it("propaga el error del callback de scrypt", async () => {
    await expect(hashPasswordMocked("cualquiera")).rejects.toThrowError(
      "scrypt exploded",
    );
  });
});
