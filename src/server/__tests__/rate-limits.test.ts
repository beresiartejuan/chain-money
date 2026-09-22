import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/server/rate-limit";
import {
  RATE_LIMITS,
  type RateLimitName,
  rateLimitKey,
} from "@/server/rate-limits";

/**
 * T083 — smoke de cada rate limit consolidado: consume el cupo completo de
 * cada punto con su key real (`rateLimitKey`) y verifica que la llamada
 * siguiente se bloquea con `retryAfterMs > 0`. Es un smoke de la
 * configuración (números y keys), no de `checkRateLimit`, que tiene su suite
 * propia (`rate-limit.test.ts`). Sin DB.
 */

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.useRealTimers();
});

// No hay nada que limpiar por archivo: cada `resetRateLimit` por caso deja
// el store sin entradas de este test.
afterAll(() => {
  for (const name of Object.keys(RATE_LIMITS)) {
    resetRateLimit(`${name}:smoke`);
  }
});

describe("rate-limits consolidados (T083)", () => {
  it.each(
    Object.keys(RATE_LIMITS) as RateLimitName[],
  )("%s: agota el cupo y la llamada %d+1 se bloquea con retryAfterMs", (name) => {
    const { limit, windowMs } = RATE_LIMITS[name];
    const key = rateLimitKey(name, "smoke");
    resetRateLimit(key);

    for (let i = 0; i < limit; i += 1) {
      expect(checkRateLimit(key, limit, windowMs).allowed).toBe(true);
    }
    expect(checkRateLimit(key, limit, windowMs)).toEqual({
      allowed: false,
      retryAfterMs: expect.any(Number),
    });
    expect(
      (checkRateLimit(key, limit, windowMs) as { retryAfterMs: number })
        .retryAfterMs,
    ).toBeGreaterThan(0);

    resetRateLimit(key);
  });

  it("rateLimitKey produce las keys exactas del contrato (keyPrefix:identifier)", () => {
    expect(rateLimitKey("login", "a@x.com")).toBe("login:a@x.com");
    expect(rateLimitKey("recover", "a@x.com")).toBe("recover:a@x.com");
    expect(rateLimitKey("reveal", "u1")).toBe("reveal:u1");
    expect(rateLimitKey("redeem", "u1")).toBe("redeem:u1");
  });

  it("los valores consolidados coinciden con los vigentes (T030/T036/T050)", () => {
    expect(RATE_LIMITS.login).toEqual({
      limit: 5,
      windowMs: 60_000,
      keyPrefix: "login",
    });
    expect(RATE_LIMITS.recover).toEqual({
      limit: 5,
      windowMs: 600_000,
      keyPrefix: "recover",
    });
    expect(RATE_LIMITS.reveal).toEqual({
      limit: 3,
      windowMs: 3_600_000,
      keyPrefix: "reveal",
    });
    expect(RATE_LIMITS.redeem).toEqual({
      limit: 10,
      windowMs: 60_000,
      keyPrefix: "redeem",
    });
  });
});
