import { randomInt } from "node:crypto";
import {
  isWordInList,
  RECOVERY_WORDLIST,
  WORDLIST_COUNT,
} from "./recovery-words";

/** Cantidad de palabras por frase de recuperación. */
const PHRASE_WORD_COUNT = 12;

/**
 * Genera una frase de recuperación de 12 palabras unidas por `-`.
 *
 * Cada palabra se elige de `RECOVERY_WORDLIST` (256 palabras) con CSPRNG
 * (`node:crypto` `randomInt`, con re-distribución por rechazo, sin sesgo
 * de módulo). Entropía: 12 × log2(256) = 96 bits.
 */
export function generateRecoveryPhrase(): string {
  const words: string[] = [];
  for (let i = 0; i < PHRASE_WORD_COUNT; i++) {
    const index = randomInt(0, WORDLIST_COUNT);
    words.push(RECOVERY_WORDLIST[index] as string);
  }
  return words.join("-");
}

const SEPARATOR_PATTERN = /[\s-]+/;

/**
 * Normaliza y valida una frase de recuperación ingresada por el usuario.
 *
 * - Separa por espacios y/o guiones (incluidos runs múltiples y mixtos).
 * - Case-insensitive: compara en minúsculas (la wordlist es ASCII lowercase).
 * - Válida solo si hay exactamente 12 palabras y todas están en la lista.
 *
 * Devuelve las palabras en minúsculas, o `null` si la frase es inválida.
 * Nunca lanza.
 */
export function parseRecoveryPhrase(input: string): string[] | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const words = trimmed
    .split(SEPARATOR_PATTERN)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);

  if (words.length !== PHRASE_WORD_COUNT) {
    return null;
  }

  for (const word of words) {
    if (!isWordInList(word)) {
      return null;
    }
  }

  return words;
}

/**
 * Conveniencia: indica si `input` es una frase de recuperación válida.
 * Nunca lanza.
 */
export function validateRecoveryPhrase(input: string): boolean {
  return parseRecoveryPhrase(input) !== null;
}
