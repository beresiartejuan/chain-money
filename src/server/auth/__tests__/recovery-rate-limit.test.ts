import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import { recoverAccount } from "@/server/auth/recovery";
import { registerUser } from "@/server/auth/service";
import { InvalidCredentialsError, RateLimitError } from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";

/**
 * T036 — rate limit del recovery: key `recover:{email}`, 5 intentos por
 * 10 minutos. El bloqueo es un `RateLimitError` (`code: "rate_limited"` con
 * `retryAfterMs`), distinto del `invalid_credentials` genérico, para que la
 * UI pueda mostrar "esperá". Sin sleeps reales: fake timers fingen
 * `Date.now()`, la única fuente de tiempo de `rate-limit.ts`.
 */

vi.mock("server-only", () => ({}));

const EMAIL = "brute@example.com";
const OTHER_EMAIL = "otro@example.com";
const LIMIT = 5;
const WINDOW_MS = 600_000;

/** Frase bien formada (12 palabras) pero incorrecta (no es la registrada). */
const WRONG_PHRASE =
  "lunes-martes-miercoles-jueves-viernes-sabado-domingo-enero-febrero-marzo-abril-mayo";

describe("recoverAccount rate limit (T036)", () => {
  const { db, migrateOnce } = createTestDb();
  const key = encodeEncryptionKeyForTests();
  let registeredPhrase: string;

  beforeAll(async () => {
    await migrateOnce();
    const { recoveryPhrase } = await registerUser(
      db,
      {
        email: EMAIL,
        password: "password-brute",
        name: "Brute Target",
      },
      key,
    );
    registeredPhrase = recoveryPhrase;
  });

  afterEach(() => {
    resetRateLimit(`recover:${EMAIL}`);
    resetRateLimit(`recover:${OTHER_EMAIL}`);
    vi.useRealTimers();
  });

  it("constantes del límite: 5 intentos por 10 minutos", async () => {
    // El contrato vive en el service; lo verificamos indirectamente: 5
    // intentos pasan y el 6to se bloquea (caso siguiente). Aquí solo
    // confirmamos el shape del error de bloqueo.
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: WRONG_PHRASE,
          newPassword: "password-nuevo-seguro",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: WRONG_PHRASE,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("6to intento en la ventana → RateLimitError con code rate_limited y retryAfterMs (no invalid_credentials)", async () => {
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: registeredPhrase,
          newPassword: "password-nuevo-seguro",
        }),
      ).resolves.toEqual({ ok: true });
    }

    // 6to intento: bloqueado con el error específico.
    const error = await recoverAccount(db, {
      email: EMAIL,
      phrase: registeredPhrase,
      newPassword: "password-nuevo-seguro",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfterMs: expect.any(Number),
    });
    expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
    // Distinto del genérico de credenciales.
    expect((error as RateLimitError).code).not.toBe("invalid_credentials");
  });

  it("la ventana se libera tras 10 minutos (fake timers) y vuelve a permitir", async () => {
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: registeredPhrase,
          newPassword: "password-nuevo-seguro",
        }),
      ).resolves.toEqual({ ok: true });
    }
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    // Dentro de la ventana sigue bloqueado (falta 1 ms).
    vi.advanceTimersByTime(WINDOW_MS - 1);
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    // Al vencer la ventana se abre una nueva: vuelve a permitir.
    vi.advanceTimersByTime(1);
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("otros emails no comparten contador (el límite es por email)", async () => {
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);
    resetRateLimit(`recover:${OTHER_EMAIL}`);

    // EMAIL agota su cupo.
    for (let i = 0; i < LIMIT; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: registeredPhrase,
          newPassword: "password-nuevo-seguro",
        }),
      ).resolves.toEqual({ ok: true });
    }
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    // OTHER_EMAIL tiene ventana propia: se permite aunque EMAIL esté agotado.
    // (Email inexistente → invalid_credentials, pero con cupo propio.)
    await expect(
      recoverAccount(db, {
        email: OTHER_EMAIL,
        phrase: WRONG_PHRASE,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    // EMAIL sigue bloqueado.
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("los intentos fallidos también consumen cupo (frenan la fuerza bruta)", async () => {
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);

    // 5 intentos con frase incorrecta.
    for (let i = 0; i < LIMIT; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: WRONG_PHRASE,
          newPassword: "password-nuevo-seguro",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    // El 6to, aunque traiga la frase CORRECTA, está bloqueado.
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("1–2 errores no bloquean a usuarios legítimos (criterio de aceptación)", async () => {
    vi.useFakeTimers();
    resetRateLimit(`recover:${EMAIL}`);

    // Un usuario legítimo se equivoca 2 veces con frase mal tipeada...
    for (let i = 0; i < 2; i += 1) {
      await expect(
        recoverAccount(db, {
          email: EMAIL,
          phrase: WRONG_PHRASE,
          newPassword: "password-nuevo-seguro",
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    // ...y al 3er intento, con la frase correcta, recupera sin problema.
    await expect(
      recoverAccount(db, {
        email: EMAIL,
        phrase: registeredPhrase,
        newPassword: "password-nuevo-seguro",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
