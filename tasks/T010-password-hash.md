# T010 — Hash/verify de password (scrypt)

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Persistir passwords de forma segura con `node:crypto` (scrypt).

## Alcance

- `src/lib/crypto/password.ts`:
  - `hashPassword(plain: string): Promise<string>` → formato `scrypt$N$r$p$salt$hash` (base64), salt aleatoria 16 bytes.
  - `verifyPassword(plain: string, stored: string): Promise<boolean>` → `timingSafeEqual`.
- Sin dependencias externas.

## Criterios de aceptación

- [ ] Dos hashes del mismo password difieren (salt aleatoria).
- [ ] verify true con el original, false con cualquier variación.
- [ ] Hash corrupto/truncado → false (no lanza).

## Tests

- `password.test.ts`: roundtrip, unicidad por salt, corrupted hash.