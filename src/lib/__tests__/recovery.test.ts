import { describe, expect, it } from "vitest";
import {
  generateRecoveryPhrase,
  parseRecoveryPhrase,
  validateRecoveryPhrase,
} from "../recovery";
import { RECOVERY_WORDLIST } from "../recovery-words";

describe("generateRecoveryPhrase", () => {
  it("devuelve exactamente 12 palabras separadas por `-`", () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.split("-");
    expect(words).toHaveLength(12);
    expect(phrase).toMatch(/^[a-z]+(-[a-z]+){11}$/);
  });

  it("usa solo palabras de la wordlist", () => {
    const list = new Set(RECOVERY_WORDLIST);
    for (let i = 0; i < 20; i++) {
      const words = generateRecoveryPhrase().split("-");
      for (const word of words) {
        expect(list.has(word), `palabra: ${word}`).toBe(true);
      }
    }
  });

  it("genera frases distintas en llamadas consecutivas", () => {
    // Probabilidad de colisión total de 20 frases idénticas: 256^-12^19 ≈ 0.
    // (12 palabras × 8 bits = 96 bits por frase; si todas coincidieran sería
    // un fallo determinista del generador, no azar).
    const phrases = new Set<string>();
    for (let i = 0; i < 20; i++) {
      phrases.add(generateRecoveryPhrase());
    }
    expect(phrases.size).toBeGreaterThan(1);
  });
});

describe("parseRecoveryPhrase", () => {
  const phrase = generateRecoveryPhrase();
  const words = phrase.split("-");

  it("acepta la frase canónica con guiones", () => {
    expect(parseRecoveryPhrase(phrase)).toEqual(words);
  });

  it("acepta espacios como separador", () => {
    expect(parseRecoveryPhrase(words.join(" "))).toEqual(words);
  });

  it("acepta separadores mixtos y runs múltiples", () => {
    expect(
      parseRecoveryPhrase(
        `${words[0]}  ${words[1]}-${words[2]} - ${words[3]}\t${words[4]} ${words.slice(5).join("-")}`,
      ),
    ).toEqual(words);
  });

  it("es case-insensitive y tolera espacios alrededor", () => {
    const upper = `  ${words.join(" ").toUpperCase()}  `;
    expect(parseRecoveryPhrase(upper)).toEqual(words);
  });

  it("rechaza 11 palabras", () => {
    expect(parseRecoveryPhrase(words.slice(0, 11).join("-"))).toBeNull();
  });

  it("rechaza 13 palabras", () => {
    expect(parseRecoveryPhrase([...words, "casa"].join("-"))).toBeNull();
  });

  it("rechaza palabras fuera de la wordlist", () => {
    const bad = [...words.slice(0, 11), "chocolate"];
    expect(parseRecoveryPhrase(bad.join("-"))).toBeNull();
    expect(parseRecoveryPhrase(bad.join(" "))).toBeNull();
  });

  it("rechaza entrada vacía, solo separadores y no-strings", () => {
    expect(parseRecoveryPhrase("")).toBeNull();
    expect(parseRecoveryPhrase("   ")).toBeNull();
    expect(parseRecoveryPhrase("---")).toBeNull();
    expect(parseRecoveryPhrase(" -  - ")).toBeNull();
    // Nunca lanza, incluso con tipos inesperados en runtime.
    expect(parseRecoveryPhrase(undefined as unknown as string)).toBeNull();
    expect(parseRecoveryPhrase(null as unknown as string)).toBeNull();
  });

  it("rechaza mayúsculas raras solo si la palabra no existe en la lista", () => {
    // La comparación es case-insensitive, así que mayúsculas son válidas…
    expect(parseRecoveryPhrase(words.join(" ").toUpperCase())).not.toBeNull();
    // …pero tildes no (la wordlist es ASCII): "árbol" no es "arbol".
    const accented = [...words.slice(0, 11), "árbol"].join("-");
    expect(parseRecoveryPhrase(accented)).toBeNull();
  });
});

describe("validateRecoveryPhrase", () => {
  it("devuelve true para frases válidas con cualquier separador", () => {
    const words = generateRecoveryPhrase().split("-");
    expect(validateRecoveryPhrase(words.join("-"))).toBe(true);
    expect(validateRecoveryPhrase(words.join(" "))).toBe(true);
    expect(validateRecoveryPhrase(words.join(" ").toUpperCase())).toBe(true);
  });

  it("devuelve false para frases inválidas", () => {
    expect(validateRecoveryPhrase("abaco abrazo aceite")).toBe(false);
    expect(validateRecoveryPhrase("")).toBe(false);
    expect(
      validateRecoveryPhrase("zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz"),
    ).toBe(false);
  });
});
