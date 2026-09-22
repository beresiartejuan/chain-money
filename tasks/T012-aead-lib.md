# T012 — AES-256-GCM encrypt/decrypt (`src/lib/crypto/aead.ts`)

- **Fase:** 0 · Fundaciones
- **Estado:** ⬜
- **Depende de:** T001

## Objetivo

Encriptación autenticada para la recovery phrase.

## Alcance

- `src/lib/crypto/aead.ts`:
  - `encrypt(plaintext: string, key: Buffer): string` → `v1$iv$tag$ciphertext` (base64), IV 12 bytes aleatorio.
  - `decrypt(payload: string, key: Buffer): string` → lanza `AeadError` si tag/ formato inválido.
- Validación de longitud de key (32 bytes).

## Criterios de aceptación

- [ ] Roundtrip encrypt→decrypt devuelve el original.
- [ ] Un byte alterado hace fallar decrypt (authenticity).
- [ ] Dos encrypts del mismo texto difieren (IV aleatorio).
- [ ] Key de 16 bytes lanza error claro.

## Tests

- `aead.test.ts`: roundtrip, tamper, IV único, key inválida.