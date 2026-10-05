import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { sessions, type User, users } from "@/db/schema";
import { PASSWORD_MIN_LENGTH } from "@/lib/crypto/password";
import { hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import {
  createSessionRow,
  loginUser,
  logoutSession,
  registerUser,
} from "@/server/auth/service";
import {
  EmailTakenError,
  InvalidCredentialsError,
  ValidationError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import { rateLimitKey } from "@/server/rate-limits";

/**
 * T025/T026/T027/T029/T033 — lógica de auth contra DB real (SQLite temporal
 * con las migraciones de `drizzle/`). El service es puro respecto al request:
 * recibe la db (y la key de encriptación para el registro) y no toca cookies,
 * así que se testa directo; la capa de cookies vive en `actions.ts`/
 * `session.ts` y no se cubre aquí.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test.
vi.mock("server-only", () => ({}));

const VALID_REGISTER = {
  email: "ana@example.com",
  password: "contrasena-segura",
  name: "Ana Pérez",
};

/** Key AEAD de 32 bytes para los registros de esta suite. */
const TEST_KEY = encodeEncryptionKeyForTests();

async function insertUser(
  db: Parameters<typeof registerUser>[0],
  overrides: Partial<User> = {},
): Promise<User> {
  const values = {
    id: overrides.id ?? newId(),
    email: overrides.email ?? "seed@example.com",
    passwordHash:
      overrides.passwordHash ?? "scrypt$16384$8$1$seedSalt$seedHash",
    name: overrides.name ?? "Seed",
    ...overrides,
  };
  const inserted = await db.insert(users).values(values).returning();
  return inserted[0] as User;
}

describe("auth service", () => {
  const { db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  describe("registerUser", () => {
    it("crea user + sesión en DB, con password hasheado (nunca plano)", async () => {
      const { user, session } = await registerUser(
        db,
        { ...VALID_REGISTER },
        TEST_KEY,
      );

      // User persistido con id UUIDv7 y hash scrypt
      expect(user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(user.email).toBe(VALID_REGISTER.email);
      expect(user.name).toBe(VALID_REGISTER.name);

      const stored = await db
        .select()
        .from(users)
        .where(eq(users.email, VALID_REGISTER.email))
        .limit(1);
      const saved = stored[0] as User | undefined;
      expect(saved).toBeDefined();
      expect(saved?.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
      expect(saved?.passwordHash).not.toContain(VALID_REGISTER.password);

      // Sesión activa: id = hash del token, expiry ~30 días
      expect(session.userId).toBe(user.id);
      const lifetime = session.expiresAt - session.createdAt;
      const dayMs = 24 * 60 * 60 * 1000;
      expect(lifetime).toBeGreaterThanOrEqual(29 * dayMs);
      expect(lifetime).toBeLessThanOrEqual(31 * dayMs);
      const persisted = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id))
        .limit(1);
      expect(persisted).toHaveLength(1);
      // El id de la fila es un hash SHA-256 hex, no un token crudo
      expect(session.id).toMatch(/^[0-9a-f]{64}$/);
      expect(session.id).not.toContain("-"); // no es un UUID, es el hash
    });

    it("rechaza email duplicado con EmailTakenError y sin crear sesión", async () => {
      await registerUser(
        db,
        { ...VALID_REGISTER, email: "dup@example.com" },
        TEST_KEY,
      );
      const before = await db.select().from(sessions);
      const countBefore = before.length;

      await expect(
        registerUser(
          db,
          { ...VALID_REGISTER, email: "dup@example.com" },
          TEST_KEY,
        ),
      ).rejects.toBeInstanceOf(EmailTakenError);

      // El usuario original sigue solo (sin duplicado)
      const all = await db
        .select()
        .from(users)
        .where(eq(users.email, "dup@example.com"));
      expect(all).toHaveLength(1);
      expect((await db.select().from(sessions)).length).toBe(countBefore);
    });

    it("rechaza entrada inválida con ValidationError y errores por campo", async () => {
      const cases = [
        { ...VALID_REGISTER, email: "no-email" },
        { ...VALID_REGISTER, password: "corto" },
        { ...VALID_REGISTER, name: "   " },
        { email: "a@b.com", password: "", name: "" },
      ];

      for (const bad of cases) {
        await expect(registerUser(db, bad, TEST_KEY)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }

      try {
        await registerUser(
          db,
          { ...VALID_REGISTER, password: "corto" },
          TEST_KEY,
        );
        expect.unreachable();
      } catch (error) {
        const validation = error as ValidationError;
        expect(validation.code).toBe("validation");
        expect(Object.keys(validation.fieldErrors)).toContain("password");
        expect(validation.fieldErrors.password?.[0]).toContain(
          String(PASSWORD_MIN_LENGTH),
        );
      }

      // Nada se creó
      const count = (
        await db
          .select()
          .from(users)
          .where(eq(users.email, VALID_REGISTER.email))
      ).length;
      expect(count).toBeLessThanOrEqual(1); // solo el del happy path, si corrió antes
    });

    it("no deja sesiones huérfanas si la validación falla (nada se inserta)", async () => {
      const before = await db.select().from(sessions);
      await expect(
        registerUser(db, { ...VALID_REGISTER, email: "malformato" }, TEST_KEY),
      ).rejects.toBeInstanceOf(ValidationError);
      const after = await db.select().from(sessions);
      expect(after.length).toBe(before.length);
    });

    it("AeadError con key malformada (no Buffer de 32 bytes): error de deploy, nada se crea", async () => {
      const badKey = Buffer.alloc(16, 1); // 16 bytes: la forma no es 32
      const { AeadError } = await import("@/lib/crypto/aead");
      const email = `badkey-${newId()}@example.com`;
      await expect(
        registerUser(db, { ...VALID_REGISTER, email }, badKey),
      ).rejects.toBeInstanceOf(AeadError);
      // El chequeo de shape corre antes de insertar: la tabla no creció.
      const after = await db.select().from(users).where(eq(users.email, email));
      expect(after.length).toBe(0);
    });
  });

  describe("loginUser", () => {
    // El service ahora aplica rate limit por email (5/min): cada test abre
    // con una ventana limpia para no arrastrar el contador entre tests.
    const LOGIN_EMAIL = "login@example.com";

    beforeEach(() => {
      resetRateLimit(rateLimitKey("login", LOGIN_EMAIL));
    });

    beforeAll(async () => {
      await registerUser(
        db,
        {
          email: "login@example.com",
          password: "password-login",
          name: "Login User",
        },
        TEST_KEY,
      );
    });

    it("happy path: credenciales correctas crean sesión", async () => {
      const { user, session } = await loginUser(db, {
        email: "login@example.com",
        password: "password-login",
      });
      expect(user.email).toBe("login@example.com");
      expect(session.userId).toBe(user.id);

      const persisted = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id))
        .limit(1);
      expect(persisted).toHaveLength(1);
    });

    it("password erróneo → InvalidCredentialsError (mismo error que email inexistente)", async () => {
      await expect(
        loginUser(db, {
          email: "login@example.com",
          password: "password-incorrecto",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it("email inexistente → InvalidCredentialsError (no revela si el email existe)", async () => {
      await expect(
        loginUser(db, {
          email: "ghost@example.com",
          password: "password-login",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      // Mismo código estable para ambos casos
      const wrongPassword = await loginUser(db, {
        email: "login@example.com",
        password: "password-incorrecto",
      }).catch((error: unknown) => error);
      const ghostEmail = await loginUser(db, {
        email: "ghost@example.com",
        password: "password-login",
      }).catch((error: unknown) => error);

      expect((wrongPassword as InvalidCredentialsError).code).toBe(
        "invalid_credentials",
      );
      expect((ghostEmail as InvalidCredentialsError).code).toBe(
        "invalid_credentials",
      );
    });
    it("entrada inválida → ValidationError", async () => {
      await expect(
        loginUser(db, { email: "no-email", password: "" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("credenciales inválidas no crean sesión", async () => {
      const before = (await db.select().from(sessions)).length;
      await expect(
        loginUser(db, {
          email: "login@example.com",
          password: "otro-password-malo",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect((await db.select().from(sessions)).length).toBe(before);
    });
  });

  describe("logoutSession", () => {
    it("borra la fila de sesión por hash y es idempotente", async () => {
      const user = await insertUser(db, { email: "logout@example.com" });
      const { tokenHash, row } = await createSessionRow(db, user.id);
      expect(row.id).toBe(tokenHash);

      // La fila existe
      let found = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, tokenHash));
      expect(found).toHaveLength(1);

      await logoutSession(db, tokenHash);

      // Ya no existe
      found = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, tokenHash));
      expect(found).toHaveLength(0);

      // Idempotente: borrar de nuevo no falla
      await expect(logoutSession(db, tokenHash)).resolves.toBeUndefined();
    });

    it("con un hash desconocido no falla y no borra otras sesiones", async () => {
      const user = await insertUser(db, { email: "keep@example.com" });
      const { tokenHash } = await createSessionRow(db, user.id);

      await expect(
        logoutSession(db, hashAccessToken("token-que-no-existe")),
      ).resolves.toBeUndefined();

      const kept = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, tokenHash));
      expect(kept).toHaveLength(1);
    });
  });

  describe("createSessionRow", () => {
    it("inserta fila con hash como id y expiry correcta", async () => {
      const user = await insertUser(db, { email: "session@example.com" });

      const before = Date.now();
      const { token, tokenHash, row } = await createSessionRow(db, user.id);
      const after = Date.now();

      expect(token.length).toBeGreaterThan(20);
      expect(row.id).toBe(tokenHash);
      expect(row.userId).toBe(user.id);
      // TTL de 30 días ± margen del reloj
      expect(row.createdAt).toBeGreaterThanOrEqual(before);
      expect(row.createdAt).toBeLessThanOrEqual(after);
      expect(row.expiresAt - row.createdAt).toBe(30 * 24 * 60 * 60 * 1000);

      // La fila está en DB
      const persisted = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, tokenHash))
        .limit(1);
      expect(persisted[0]?.userId).toBe(user.id);
    });

    it("falla si el userId no existe (FK)", async () => {
      await expect(
        createSessionRow(db, "0199bbbb-9999-7333-b999-00000000000x"),
      ).rejects.toThrow();
    });
  });
});
