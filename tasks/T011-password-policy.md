# T011 — Política de contraseña

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T010

## Objetivo

Validación de fortaleza compartida entre registro y recuperación.

## Alcance

- `validatePasswordStrength(plain: string): string[]` en `src/lib/crypto/password.ts`:
  - mínimo 8 caracteres,
  - máximo razonable (p. ej. 128) para no romper scrypt,
  - devuelve lista de violaciones (vacía = válida).

## Criterios de aceptación

- [ ] "abc" → no válida con mensaje claro.
- [ ] 8+ caracteres → válida.
- [ ] 200 chars → inválida (máximo).

## Tests

- `password-policy.test.ts`: límites inferior/superior, mensajes.