# T032 — Generación de recovery phrase

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T031

## Objetivo

Frases reproducibles de 12 palabras con entropía criptográfica.

## Alcance

- `src/lib/recovery.ts`: `generateRecoveryPhrase(): string` — 12 palabras aleatorias unidas por `-`, usando `node:crypto` random.
- `parseRecoveryPhrase(input: string): string[] | null` — normaliza espacios/`-`, valida 12 palabras de la lista.

## Criterios de aceptación

- [ ] Siempre 12 palabras de la wordlist, separadas por `-`.
- [ ] Parse acepta espacios o guiones, case-insensitive; rechaza palabras fuera de lista o cantidad incorrecta.

## Tests

- `recovery.test.ts`: formato, parseo normalizado, rechazo de inválidas.