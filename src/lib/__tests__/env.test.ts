import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalProcessEnv = process.env;

beforeEach(() => {
  process.env = { NODE_ENV: "test", TURSO_DATABASE_URL: "file:./local.db" };
});

afterEach(() => {
  process.env = originalProcessEnv;
});

// El módulo valida `process.env` al importarse: se carga dinámicamente en cada
// test, con `process.env` ya controlado, para no depender del entorno real.
async function loadEnvModule(): Promise<typeof import("../env")> {
  vi.resetModules();
  return import("../env");
}

describe("parseEnv", () => {
  it("accepts a valid environment", async () => {
    const { parseEnv } = await loadEnvModule();
    const parsed = parseEnv({
      TURSO_DATABASE_URL: "libsql://chain-money.turso.io",
      TURSO_AUTH_TOKEN: "auth-token",
      ENCRYPTION_KEY: "base64-key",
      NODE_ENV: "production",
    });

    expect(parsed.tursoDatabaseUrl).toBe("libsql://chain-money.turso.io");
    expect(parsed.tursoAuthToken).toBe("auth-token");
    expect(parsed.encryptionKey).toBe("base64-key");
  });

  it("treats any custom NODE_ENV (string raro) as non-production", async () => {
    // resolveNodeEnv solo trata literal "production" como producción; cualquier
    // otro valor no vacío cae en la rama "no exige key" (línea 27 de env.ts).
    const { parseEnv } = await loadEnvModule();
    const parsed = parseEnv({
      TURSO_DATABASE_URL: "file:./local.db",
      NODE_ENV: "staging",
    });
    expect(parsed.encryptionKey).toBeUndefined();
  });

  it("rejects missing TURSO_DATABASE_URL", async () => {
    const { parseEnv } = await loadEnvModule();
    expect(() => parseEnv({})).toThrowError(/TURSO_DATABASE_URL/);
  });

  it("rejects empty ENCRYPTION_KEY in production", async () => {
    const { parseEnv } = await loadEnvModule();
    expect(() =>
      parseEnv({
        TURSO_DATABASE_URL: "libsql://chain-money.turso.io",
        ENCRYPTION_KEY: "",
        NODE_ENV: "production",
      }),
    ).toThrowError(/ENCRYPTION_KEY/);
  });

  it("allows missing ENCRYPTION_KEY in development", async () => {
    const { parseEnv } = await loadEnvModule();
    const parsed = parseEnv({
      TURSO_DATABASE_URL: "file:./local.db",
      TURSO_AUTH_TOKEN: "",
      NODE_ENV: "development",
    });

    expect(parsed.tursoDatabaseUrl).toBe("file:./local.db");
    expect(parsed.tursoAuthToken).toBeUndefined();
    expect(parsed.encryptionKey).toBeUndefined();
  });
});

describe("env module", () => {
  it("validates process.env at import time and exports a frozen env", async () => {
    process.env = {
      NODE_ENV: "development",
      TURSO_DATABASE_URL: "libsql://chain-money.turso.io",
    };
    const { env } = await loadEnvModule();

    expect(env.tursoDatabaseUrl).toBe("libsql://chain-money.turso.io");
    expect(env.tursoAuthToken).toBeUndefined();
    expect(env.encryptionKey).toBeUndefined();
    expect(Object.isFrozen(env)).toBe(true);
  });
});
