import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { encodeEncryptionKeyForTests } from "@/server/auth/__tests__/helpers";
import { loginUser, registerUser } from "@/server/auth/service";
import { InvalidCredentialsError, RateLimitError } from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import { rateLimitKey } from "@/server/rate-limits";

/**
 * T029 — errores genéricos en login. Email inexistente y password incorrecto
 * deben producir exactamente el mismo error: mismo tipo, mismo `code`
 * estable y mismo mensaje (la UI compara códigos, nunca mensajes, pero el
 * mensaje también es idéntico para que cualquier log/respuesta sea igual).
 * Además el timing se empareja con un `verifyPassword` dummy cuando el email
 * no existe, para no filtrar por duración.
 *
 * T085 — con el rate limit integrado en `loginUser` (5/min por email), este
 * archivo resetea la ventana en el `beforeEach` (el test de timing hace 5+5
 * logins con los mismos emails) y agrega un único test de integración del
 * bloqueo, criterio de T030 aún sin cubrir para login.
 */

vi.mock("server-only", () => ({}));

describe("login errores genéricos (T029)", () => {
  const { db, migrateOnce } = createTestDb();

  const EMAIL = "timing@example.com";
  const PASSWORD = "password-timing";
  const GHOST_EMAIL = "ghost@example.com";
  const WRONG_PASSWORD = "password-equivocado";

  // El service aplica rate limit por email (5/min) desde T085: el test de
  // timing hace 5+5 logins con los mismos emails, así que cada test abre con
  // la ventana limpia para no agotar el cupo ni arrastrar el contador.
  beforeEach(() => {
    resetRateLimit(rateLimitKey("login", EMAIL));
    resetRateLimit(rateLimitKey("login", GHOST_EMAIL));
  });

  beforeAll(async () => {
    await migrateOnce();
    const key = encodeEncryptionKeyForTests();
    await registerUser(
      db,
      { email: EMAIL, password: PASSWORD, name: "Timing User" },
      key,
    );
  });

  /** Captura el error de login como objeto comparable. */
  async function loginError(input: {
    email: string;
    password: string;
  }): Promise<{ code: string; message: string; name: string }> {
    try {
      await loginUser(db, input);
      throw new Error("Expected login to throw");
    } catch (error) {
      const appError = error as { code: string; message: string; name: string };
      expect(appError.name).toBe("InvalidCredentialsError");
      return {
        code: appError.code,
        message: appError.message,
        name: appError.name,
      };
    }
  }

  it("email inexistente y password erróneo → misma respuesta byte a byte", async () => {
    const ghost = await loginError({ email: GHOST_EMAIL, password: PASSWORD });
    const wrongPassword = await loginError({
      email: EMAIL,
      password: WRONG_PASSWORD,
    });

    // Igualdad completa: código estable, mensaje y tipo de error
    expect(ghost).toStrictEqual(wrongPassword);
    expect(ghost.code).toBe("invalid_credentials");
  });

  it("ninguno de los dos casos revela cuál falló (ni email ni password)", async () => {
    const ghost = await loginError({ email: GHOST_EMAIL, password: PASSWORD });
    const wrongPassword = await loginError({
      email: EMAIL,
      password: WRONG_PASSWORD,
    });

    expect(ghost.message).not.toContain(GHOST_EMAIL);
    expect(ghost.message).not.toContain(EMAIL);
    expect(wrongPassword.message).toBe(ghost.message);
  });

  it("timing aproximado: 5 corridas por caso, diferencia media < 100ms", async () => {
    const RUNS = 5;
    const TOLERANCE_MS = 100;

    async function averageMs(input: {
      email: string;
      password: string;
    }): Promise<number> {
      let total = 0;
      for (let i = 0; i < RUNS; i++) {
        const start = performance.now();
        await loginUser(db, input).catch(() => undefined);
        total += performance.now() - start;
      }
      return total / RUNS;
    }

    const ghostAvg = await averageMs({
      email: GHOST_EMAIL,
      password: PASSWORD,
    });
    const wrongAvg = await averageMs({
      email: EMAIL,
      password: WRONG_PASSWORD,
    });

    const diff = Math.abs(ghostAvg - wrongAvg);
    // El dummy-verify empareja el coste scrypt; la aserción es tolerante
    // porque CI/reloj pueden añadir ruido. Si llega a ser flaky, la garantía
    // estructural está en los tests de igualdad de código de arriba.
    expect(diff).toBeLessThan(TOLERANCE_MS);
  });

  it("6to intento en la ventana → RateLimitError (rate limit de login, T030)", async () => {
    // El beforeEach ya dejó la ventana limpia. 5 intentos (fallidos) con
    // cupo, el 6to agota la ventana y se bloquea con el error específico.
    // Sin fake timers: cada verify scrypt tarda ~100ms y la ventana real es
    // de 60s, así que no hay riesgo de que venza a mitad del test.
    for (let i = 0; i < 5; i += 1) {
      await expect(
        loginUser(db, { email: EMAIL, password: WRONG_PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const error = await loginUser(db, {
      email: EMAIL,
      password: PASSWORD,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfterMs: expect.any(Number),
    });
    expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
    // Distinto del genérico de credenciales: la UI puede mostrar "esperá".
    expect((error as RateLimitError).code).not.toBe("invalid_credentials");
  });
});
