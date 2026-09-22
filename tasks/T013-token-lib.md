# T013 — Generación/hash de tokens de acceso

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Primitivas para tokens de alcancía y de sesión: valor crudo efímero, hash persistido.

## Alcance

- `src/lib/crypto/token.ts`:
  - `generateAccessToken(): { token: string; hash: string; prefix: string }` — 32 bytes base64url; hash SHA-256 hex; prefix primeros 8 chars.
  - `hashAccessToken(raw: string): string` — SHA-256 hex.
  - `constantTimeEqual(a: string, b: string): boolean`.

## Criterios de aceptación

- [ ] 1000 generaciones: sin duplicados, todos con prefix de 8 chars.
- [ ] `hashAccessToken` determinista.
- [ ] El raw nunca queda en el objeto persistible (solo hash/prefix).

## Tests

- `token.test.ts`: unicidad, determinismo, prefix, equal.