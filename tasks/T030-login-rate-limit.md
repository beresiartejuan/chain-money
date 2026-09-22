# T030 — Rate limit de login

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T026

## Objetivo

Frenar fuerza bruta sobre login (MVP: en memoria).

## Alcance

- `src/server/rate-limit.ts`:
  - `checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number }` — ventana fija por key.
- Login: key `login:{email}` (y opcionalmente IP), p. ej. 5 intentos/minuto.

## Criterios de aceptación

- [ ] 6to intento dentro de la ventana es bloqueado con error de rate limit.
- [ ] Fuera de ventana vuelve a permitir.
- [ ] Keys distintas no comparten contador.

## Tests

- `rate-limit.test.ts`: ventana, bloqueo, independencia de keys.