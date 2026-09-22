# T031 — Wordlist de recovery phrase (12 palabras)

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T003

## Objetivo

Lista cerrada de palabras para frases de recuperación legibles.

## Alcance

- `src/lib/recovery-words.ts`: array de 256 palabras (minúsculas, ASCII, 3–8 letras, sin duplicados).
- `WORDLIST_COUNT === 256` (para 12 palabras × 8 bits = 96 bits de entropía... documentar: con 12 palabras de 256, entropía = 12 × log2(256) = 96 bits).

## Criterios de aceptación

- [ ] 256 palabras exactas, sin duplicados, todas ASCII lowercase.

## Tests

- `recovery-words.test.ts`: count, duplicados, charset.