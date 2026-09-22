import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from "@/server/auth/cookies";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

describe("session cookie constants", () => {
  it("uses the agreed cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("cm_session");
  });

  it("expresses a 30-day TTL in milliseconds", () => {
    expect(SESSION_TTL_MS).toBe(THIRTY_DAYS_IN_SECONDS * 1000);
  });
});

describe("sessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always sets httpOnly and sameSite lax regardless of the environment", () => {
    for (const nodeEnv of ["production", "development", "test"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);

      const options = sessionCookieOptions();

      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
    }
  });

  it("sets secure to true only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("sets secure to false outside production", () => {
    for (const nodeEnv of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      expect(sessionCookieOptions().secure).toBe(false);
    }
  });

  it("returns maxAge in seconds for a 30-day TTL", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions().maxAge).toBe(THIRTY_DAYS_IN_SECONDS);
  });
});
