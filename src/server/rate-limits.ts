/**
 * T083 — única fuente de los rate limits de los endpoints sensibles
 * (T030/T036/T050). Cada punto declara acá su `limit`, su ventana y el
 * prefijo de key que consume `checkRateLimit` (`src/server/rate-limit.ts`).
 *
 * Los valores son los vigentes; NO se ajustan acá sin revisar los tests que
 * dependen de ellos: los de recovery construyen las keys con literales
 * (`recover:{email}`, `reveal:{userId}`) y los de redeem comparten la key vía
 * `redeemRateLimitKey`, así que el formato `keyPrefix:identifier` es parte
 * del contrato.
 *
 * Consumidores:
 * - login (key `login:{email}`, 5/min): primitiva y key definidas acá; su
 *   integración en el flujo de login corresponde a T030 (el limiter ya está
 *   activo en recovery y redeem).
 * - `src/server/auth/recovery.ts`: `recoverAccount` (recover) y
 *   `revealRecoveryPhrase` (reveal).
 * - `src/server/tokens/service.ts`: `redeemToken` (redeem).
 */
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 60_000, keyPrefix: "login" },
  recover: { limit: 5, windowMs: 10 * 60_000, keyPrefix: "recover" },
  reveal: { limit: 3, windowMs: 60 * 60_000, keyPrefix: "reveal" },
  redeem: { limit: 10, windowMs: 60_000, keyPrefix: "redeem" },
} as const;

/** Nombre de una configuración de rate limit (key de `RATE_LIMITS`). */
export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Construye la key de rate limit para el punto `name` con su identificador
 * (email o userId según el endpoint): `${keyPrefix}:${identifier}`. Las keys
 * generadas son idénticas a las usadas hasta T083 (`login:{email}`,
 * `recover:{email}`, `reveal:{userId}`, `redeem:{userId}`), así que los
 * tests que las construyen con literales siguen apuntando al mismo contador.
 */
export function rateLimitKey(name: RateLimitName, identifier: string): string {
  return `${RATE_LIMITS[name].keyPrefix}:${identifier}`;
}
