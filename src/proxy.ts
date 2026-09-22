/**
 * T040 — Proxy (ex middleware) de rutas privadas y de auth.
 *
 * Next.js 16 renombró la convención `middleware.ts` a `proxy.ts` (ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`):
 * el archivo exporta una función llamada `proxy` con la misma semántica.
 *
 * Chequeo barato: solo presencia de la cookie de sesión (`cm_session`), sin
 * validar la sesión contra la DB. La validación real la hace el server en
 * cada action / carga de página. Por eso este módulo NO importa nada que use
 * `next/headers` ni la DB: `next/server` (NextRequest/NextResponse) sí está
 * permitido en proxy.
 */
import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/cookies";

/** Prefijo de todas las rutas privadas de la app. */
const DASHBOARD_PREFIX = "/dashboard";
/** Ruta exacta del flujo de canje. */
const REDEEM_PATH = "/redeem";
/** Rutas del flujo de auth: con sesión activa ya no tienen sentido. */
const AUTH_ROUTES = ["/login", "/register", "/recover"] as const;
/** Destino por defecto para un visitante autenticado. */
const AUTHENTICATED_DEFAULT = "/dashboard";
/** Destino por defecto para un visitante sin sesión. */
const UNAUTHENTICATED_DEFAULT = "/login";

/**
 * ¿Es una ruta privada (requiere sesión)?
 *
 * Purita y exportada para testearla sin levantar servidor ni runtime de Next.
 * Las rutas `/api/**` devuelven `false` a propósito: cada route handler /
 * server action valida la sesión por su cuenta.
 */
export function requiresAuth(pathname: string): boolean {
  if (
    pathname === DASHBOARD_PREFIX ||
    pathname.startsWith(`${DASHBOARD_PREFIX}/`)
  ) {
    return true;
  }
  return pathname === REDEEM_PATH || pathname.startsWith(`${REDEEM_PATH}/`);
}

/**
 * ¿Es una ruta del flujo de auth (`/login`, `/register`, `/recover`)?
 *
 * Con sesión activa estas rutas redirigen a `/dashboard`; también deciden
 * dónde cae `/` según haya sesión o no.
 */
export function isAuthRoute(pathname: string): boolean {
  return (AUTH_ROUTES as readonly string[]).includes(pathname);
}

/**
 * Decide la acción del proxy a partir del path y de si hay cookie de sesión.
 *
 * Purita (no toca el request), para poder testear la matriz completa de
 * redirects sin runtime de Next.js. Devuelve `null` cuando el request sigue
 * su curso (`NextResponse.next()`).
 */
export function proxyDecision(
  pathname: string,
  hasSessionCookie: boolean,
): { location: string } | null {
  if (hasSessionCookie) {
    // Con sesión: `/` y las rutas de auth llevan al dashboard. Las rutas
    // privadas y el resto pasan sin cambios.
    if (isAuthRoute(pathname) || pathname === "/") {
      return { location: AUTHENTICATED_DEFAULT };
    }
    return null;
  }

  // Sin sesión: las rutas privadas van a /login conservando el destino en
  // `next` (el LoginForm ya valida que sea ruta interna y hace fallback).
  if (requiresAuth(pathname)) {
    return { location: `/login?next=${encodeURIComponent(pathname)}` };
  }
  // `/` sin sesión cae en /login; el resto (auth routes, /api, estáticos…)
  // pasa sin cambios.
  if (pathname === "/") {
    return { location: UNAUTHENTICATED_DEFAULT };
  }
  return null;
}

/**
 * Función `proxy` (convención Next.js 16, ex `middleware`).
 *
 * Solo lee la presencia de la cookie del request; nunca valida contra DB ni
 * usa `next/headers`.
 */
export function proxy(request: NextRequest): NextResponse {
  const decision = proxyDecision(
    request.nextUrl.pathname,
    request.cookies.has(SESSION_COOKIE_NAME),
  );
  if (decision === null) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(decision.location, request.url));
}

/**
 * Matcher: no correr en `_next/static`, `_next/image`, favicon ni metadatos.
 * Se excluye `api` a propósito: las APIs validan la sesión por su cuenta y
 * el proxy no debe interferir (criterio: `requiresAuth("/api/...") === false`).
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
