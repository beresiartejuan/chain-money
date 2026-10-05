import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isAuthRoute, proxy, proxyDecision, requiresAuth } from "@/proxy";
import { SESSION_COOKIE_NAME } from "@/server/auth/cookies";

/**
 * T040 — Tests del proxy de rutas privadas.
 *
 * `requiresAuth`, `isAuthRoute` y `proxyDecision` son funciones puras: se
 * testean sin levantar servidor ni runtime de Next.js. La función `proxy` se
 * testea con un `NextRequest` real (importable en Vitest con environment
 * node) para cubrir la integración con `NextResponse.redirect`.
 */

function makeRequest(pathname: string, withSessionCookie = false): NextRequest {
  const request = new NextRequest(`https://chain-money.test${pathname}`);
  if (withSessionCookie) {
    request.cookies.set(SESSION_COOKIE_NAME, "test-token");
  }
  return request;
}

function expectedLoginWithNext(pathname: string): string {
  return `/login?next=${encodeURIComponent(pathname)}`;
}

describe("requiresAuth", () => {
  it("matches /dashboard exactly", () => {
    expect(requiresAuth("/dashboard")).toBe(true);
  });

  it("matches nested dashboard paths", () => {
    expect(requiresAuth("/dashboard/boxes/x")).toBe(true);
  });

  it("does not match unrelated prefixes", () => {
    expect(requiresAuth("/dashboardfoo")).toBe(false);
    expect(requiresAuth("/redeemable")).toBe(false);
  });

  it("matches /redeem", () => {
    expect(requiresAuth("/redeem")).toBe(true);
  });

  it("never matches /api routes: they validate the session themselves", () => {
    expect(requiresAuth("/api/health")).toBe(false);
  });

  it("does not match / or auth routes", () => {
    expect(requiresAuth("/")).toBe(false);
    expect(requiresAuth("/login")).toBe(false);
  });
});

describe("isAuthRoute", () => {
  it("matches exactly /login, /register and /recover", () => {
    expect(isAuthRoute("/login")).toBe(true);
    expect(isAuthRoute("/register")).toBe(true);
    expect(isAuthRoute("/recover")).toBe(true);
  });

  it("does not match nested or lookalike paths", () => {
    expect(isAuthRoute("/login/foo")).toBe(false);
    expect(isAuthRoute("/registerx")).toBe(false);
    expect(isAuthRoute("/")).toBe(false);
  });
});

describe("proxyDecision", () => {
  describe("without session cookie", () => {
    it("sends private routes to /login preserving the destination in next", () => {
      expect(proxyDecision("/dashboard", false)).toEqual({
        location: expectedLoginWithNext("/dashboard"),
      });
      expect(proxyDecision("/dashboard/boxes/x", false)).toEqual({
        location: expectedLoginWithNext("/dashboard/boxes/x"),
      });
      expect(proxyDecision("/redeem", false)).toEqual({
        location: expectedLoginWithNext("/redeem"),
      });
    });

    it("keeps / on the public landing instead of redirecting to /login", () => {
      expect(proxyDecision("/", false)).toBeNull();
    });

    it("lets auth routes, /api and anything else pass through", () => {
      expect(proxyDecision("/login", false)).toBeNull();
      expect(proxyDecision("/register", false)).toBeNull();
      expect(proxyDecision("/recover", false)).toBeNull();
      expect(proxyDecision("/api/health", false)).toBeNull();
    });
  });

  describe("with session cookie", () => {
    it("sends / and auth routes to /dashboard", () => {
      expect(proxyDecision("/", true)).toEqual({ location: "/dashboard" });
      expect(proxyDecision("/login", true)).toEqual({
        location: "/dashboard",
      });
      expect(proxyDecision("/register", true)).toEqual({
        location: "/dashboard",
      });
      expect(proxyDecision("/recover", true)).toEqual({
        location: "/dashboard",
      });
    });

    it("lets private routes and anything else pass through", () => {
      expect(proxyDecision("/dashboard", true)).toBeNull();
      expect(proxyDecision("/dashboard/boxes/x", true)).toBeNull();
      expect(proxyDecision("/redeem", true)).toBeNull();
      expect(proxyDecision("/api/health", true)).toBeNull();
    });
  });
});

describe("proxy (NextRequest integration)", () => {
  it("redirects a visitor without session from /dashboard to /login?next=…", () => {
    const response = proxy(makeRequest("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://chain-money.test${expectedLoginWithNext("/dashboard")}`,
    );
  });

  it("redirects an authenticated visitor from /login to /dashboard", () => {
    const response = proxy(makeRequest("/login", true));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://chain-money.test/dashboard",
    );
  });

  it("keeps / on the public landing without session; with one, goes to dashboard", () => {
    const anonymous = proxy(makeRequest("/"));
    expect(anonymous.headers.get("location")).toBeNull();
    expect(anonymous.status).toBe(200);

    const authenticated = proxy(makeRequest("/", true));
    expect(authenticated.headers.get("location")).toBe(
      "https://chain-money.test/dashboard",
    );
  });

  it("lets private requests with session pass through without redirect", () => {
    const response = proxy(makeRequest("/dashboard", true));
    expect(response.headers.get("location")).toBeNull();
  });
});
