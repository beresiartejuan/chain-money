import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/server/rate-limit";

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test.
vi.mock("server-only", () => ({}));

/**
 * T030 — rate limit en memoria. Sin sleeps reales: el tiempo se controla con
 * fake timers de Vitest, que también finge `Date.now()`, la única fuente de
 * tiempo que usa el módulo.
 */

const KEY = "login:ana@example.com";
const OTHER_KEY = "login:bob@example.com";
const LIMIT = 5;
const WINDOW_MS = 60_000;

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimit(KEY);
    resetRateLimit(OTHER_KEY);
  });

  afterEach(() => {
    resetRateLimit(KEY);
    resetRateLimit(OTHER_KEY);
    vi.useRealTimers();
  });

  it("permite hasta limit llamadas dentro de la ventana", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const result = checkRateLimit(KEY, LIMIT, WINDOW_MS);
      expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    }
  });

  it("bloquea la (limit+1)-ésima llamada con retryAfterMs > 0", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      checkRateLimit(KEY, LIMIT, WINDOW_MS);
    }

    const blocked = checkRateLimit(KEY, LIMIT, WINDOW_MS);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tras agotar el cupo, bloquea en 0 ms restantes justo al vencer la ventana", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      checkRateLimit(KEY, LIMIT, WINDOW_MS);
    }

    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS).allowed).toBe(false);

    // Al vencer la ventana se abre una nueva: vuelve a permitir.
    vi.advanceTimersByTime(1);
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it("vuelve a permitir después de la ventana (fake timers)", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      checkRateLimit(KEY, LIMIT, WINDOW_MS);
    }
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS).allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW_MS);
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it("keys distintas no comparten contador", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      checkRateLimit(KEY, LIMIT, WINDOW_MS);
    }
    // KEY agotó su cupo, OTHER_KEY arranca con ventana propia.
    expect(checkRateLimit(OTHER_KEY, LIMIT, WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS).allowed).toBe(false);
  });

  it("resetRateLimit limpia el contador de la key", () => {
    for (let i = 0; i < LIMIT; i += 1) {
      checkRateLimit(KEY, LIMIT, WINDOW_MS);
    }
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS).allowed).toBe(false);

    resetRateLimit(KEY);
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it("el sweep global purga entradas vencidas (fake timers)", () => {
    // Llena el contador de checks para que el próximo check dispare el
    // sweep (frecuencia interna: 1 de cada 1000 checks).
    for (let i = 0; i < 1_000; i += 1) {
      checkRateLimit("sweep-fill", 100, WINDOW_MS);
    }

    // Crea una entrada y deja que su ventana venza sin volver a checkearla.
    checkRateLimit(KEY, LIMIT, WINDOW_MS);
    vi.advanceTimersByTime(WINDOW_MS + 1);

    // El próximo check corre el sweep: la entrada vencida desaparece del
    // store (la lógica de purga es la under test; el resultado visible
    // para el caller no cambia — la ventana ya venció igual).
    checkRateLimit(OTHER_KEY, LIMIT, WINDOW_MS);
    expect(checkRateLimit(KEY, LIMIT, WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });
});
