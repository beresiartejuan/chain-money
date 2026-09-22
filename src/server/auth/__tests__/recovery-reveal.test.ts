import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { users } from "@/db/schema";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import {
  REVEAL_LIMIT,
  REVEAL_WINDOW_MS,
  revealRecoveryPhrase,
} from "@/server/auth/recovery";
import { registerUser } from "@/server/auth/service";
import {
  NoRecoveryPhraseError,
  RateLimitError,
  RecoveryPhraseUnreadableError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";

/**
 * T034 — `revealRecoveryPhrase`: el usuario autenticado puede volver a ver
 * su frase (caso "me la guardé mal"), con rate limit estricto (3/hora por
 * usuario) y auditoría simple. El service es puro (db + userId + key); la
 * sesión la resuelve `recovery-actions.ts` y no se cubre aquí. El tiempo de
 * la ventana de rate limit se controla con fake timers (fingen `Date.now()`,
 * la única fuente de tiempo de `rate-limit.ts`).
 */

vi.mock("server-only", () => ({}));

describe("revealRecoveryPhrase (T034)", () => {
  const { db, migrateOnce } = createTestDb();
  const key = encodeEncryptionKeyForTests();

  let logSpy: MockInstance;

  beforeAll(async () => {
    await migrateOnce();
  });

  beforeEach(() => {
    // Silenciamos el log de auditoría durante los tests y lo espiamos.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("usuario con frase guardada → devuelve exactamente la frase normalizada del registro", async () => {
    const { user, recoveryPhrase } = await registerUser(
      db,
      {
        email: "reveal@example.com",
        password: "contrasena-segura",
        name: "Reveal User",
      },
      key,
    );
    resetRateLimit(`reveal:${user.id}`);

    const result = await revealRecoveryPhrase(db, user.id, key);

    // `registerUser` devuelve la frase ya normalizada (12 palabras lowercase
    // unidas por `-`); lo revelado tiene que ser idéntico.
    expect(result.recoveryPhrase).toBe(recoveryPhrase);
    expect(result.recoveryPhrase.split("-")).toHaveLength(12);
    resetRateLimit(`reveal:${user.id}`);
  });

  it("usuario sin frase guardada (cuenta pre-T033) → NoRecoveryPhraseError", async () => {
    const { user } = await registerUser(
      db,
      {
        email: "sinfrase@example.com",
        password: "contrasena-segura",
        name: "Sin Frase",
      },
      key,
    );
    // Simula una cuenta creada antes de T033: sin frase persistida.
    await db
      .update(users)
      .set({ recoveryPhraseEncrypted: null, recoveryPhraseHash: null })
      .where(eq(users.id, user.id));
    resetRateLimit(`reveal:${user.id}`);

    await expect(revealRecoveryPhrase(db, user.id, key)).rejects.toBeInstanceOf(
      NoRecoveryPhraseError,
    );
    await expect(revealRecoveryPhrase(db, user.id, key)).rejects.toMatchObject({
      code: "no_recovery_phrase",
    });
    resetRateLimit(`reveal:${user.id}`);
  });

  it("4ta llamada en la hora → RateLimitError con retryAfterMs; liberación al vencer la ventana", async () => {
    vi.useFakeTimers();
    try {
      const { user } = await registerUser(
        db,
        {
          email: "ratelimit@example.com",
          password: "contrasena-segura",
          name: "Rate Limit",
        },
        key,
      );
      resetRateLimit(`reveal:${user.id}`);

      // Las primeras 3 llamadas de la hora tienen cupo.
      for (let i = 0; i < REVEAL_LIMIT; i += 1) {
        await expect(
          revealRecoveryPhrase(db, user.id, key),
        ).resolves.toMatchObject({ recoveryPhrase: expect.any(String) });
      }

      // La 4ta está bloqueada y informa cuánto falta para el reinicio.
      await expect(
        revealRecoveryPhrase(db, user.id, key),
      ).rejects.toBeInstanceOf(RateLimitError);
      await expect(
        revealRecoveryPhrase(db, user.id, key),
      ).rejects.toMatchObject({
        code: "rate_limited",
        retryAfterMs: expect.any(Number),
      });

      // Al vencer la ventana se abre una nueva: vuelve a permitir.
      vi.advanceTimersByTime(REVEAL_WINDOW_MS + 1);
      await expect(
        revealRecoveryPhrase(db, user.id, key),
      ).resolves.toMatchObject({ recoveryPhrase: expect.any(String) });
    } finally {
      vi.useRealTimers();
      resetRateLimit("reveal:ratelimit-user");
    }
  });

  it("el rate limit corre aunque la cuenta no tenga frase (no regala el estado)", async () => {
    const { user } = await registerUser(
      db,
      {
        email: "blocked-nofrase@example.com",
        password: "contrasena-segura",
        name: "Blocked Sin Frase",
      },
      key,
    );
    await db
      .update(users)
      .set({ recoveryPhraseEncrypted: null, recoveryPhraseHash: null })
      .where(eq(users.id, user.id));
    resetRateLimit(`reveal:${user.id}`);

    for (let i = 0; i < REVEAL_LIMIT; i += 1) {
      await expect(
        revealRecoveryPhrase(db, user.id, key),
      ).rejects.toBeInstanceOf(NoRecoveryPhraseError);
    }
    // El 4to intento ya no llega al lookup: bloqueado por rate limit.
    await expect(revealRecoveryPhrase(db, user.id, key)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    resetRateLimit(`reveal:${user.id}`);
  });

  it("key incorrecta → RecoveryPhraseUnreadableError (nunca escapa el AeadError crudo)", async () => {
    const { user } = await registerUser(
      db,
      {
        email: "badkey@example.com",
        password: "contrasena-segura",
        name: "Bad Key",
      },
      key,
    );
    resetRateLimit(`reveal:${user.id}`);

    const otherKey = encodeEncryptionKeyForTests();
    await expect(
      revealRecoveryPhrase(db, user.id, otherKey),
    ).rejects.toBeInstanceOf(RecoveryPhraseUnreadableError);
    await expect(
      revealRecoveryPhrase(db, user.id, otherKey),
    ).rejects.toMatchObject({ code: "recovery_phrase_unreadable" });
    resetRateLimit(`reveal:${user.id}`);
  });

  it("auditoría: log de timestamp + userId, jamás la frase", async () => {
    const { user, recoveryPhrase } = await registerUser(
      db,
      {
        email: "audit@example.com",
        password: "contrasena-segura",
        name: "Audit User",
      },
      key,
    );
    resetRateLimit(`reveal:${user.id}`);

    await revealRecoveryPhrase(db, user.id, key);

    const logged = logSpy.mock.calls
      .map((call) => call.map(String).join(" "))
      .find((line) => line.includes("recovery-phrase revealed"));
    expect(logged).toBeDefined();
    expect(logged).toContain(user.id);
    // La frase jamás aparece en el log. Tampoco ninguna de sus palabras como
    // token delimitado (el grep por substring crudo daría falsos positivos:
    // p. ej. la palabra "ser" está dentro de "userId").
    expect(logged).not.toContain(recoveryPhrase);
    const loggedWords = logged?.split(/[^a-záéíóúñü-]+/) ?? [];
    for (const word of recoveryPhrase.split("-")) {
      expect(loggedWords).not.toContain(word);
    }
    resetRateLimit(`reveal:${user.id}`);
  });

  it("constantes del límite: 3 intentos por hora", () => {
    expect(REVEAL_LIMIT).toBe(3);
    expect(REVEAL_WINDOW_MS).toBe(3_600_000);
  });
});
