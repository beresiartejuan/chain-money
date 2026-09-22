import { describe, expect, it } from "vitest";
import {
  isWordInList,
  RECOVERY_WORDLIST,
  WORDLIST_COUNT,
} from "../recovery-words";

describe("RECOVERY_WORDLIST", () => {
  it("tiene exactamente 256 palabras (12 palabras × 8 bits = 96 bits)", () => {
    expect(RECOVERY_WORDLIST).toHaveLength(256);
    expect(WORDLIST_COUNT).toBe(256);
  });

  it("no tiene duplicados", () => {
    expect(new Set(RECOVERY_WORDLIST).size).toBe(RECOVERY_WORDLIST.length);
  });

  it("contiene solo ASCII lowercase de 3 a 8 letras", () => {
    for (const word of RECOVERY_WORDLIST) {
      expect(word, `palabra: ${word}`).toMatch(/^[a-z]{3,8}$/);
    }
  });

  it("no contiene groserías ni palabras incómodas", () => {
    const awkward = ["ano", "culo", "pene", "puta", "puto", "pedo"];
    for (const word of awkward) {
      expect(RECOVERY_WORDLIST).not.toContain(word);
    }
  });
});

describe("isWordInList", () => {
  it("acepta palabras de la lista", () => {
    expect(isWordInList("abaco")).toBe(true);
    expect(isWordInList("zafiro")).toBe(true);
    expect(isWordInList("casa")).toBe(true);
  });

  it("rechaza palabras fuera de la lista y variantes no normalizadas", () => {
    expect(isWordInList("chocolate")).toBe(false);
    expect(isWordInList("zzz")).toBe(false);
    expect(isWordInList("")).toBe(false);
    // Sensible a mayúsculas: el caller debe normalizar antes.
    expect(isWordInList("ABACO")).toBe(false);
    expect(isWordInList("Abaco")).toBe(false);
    // Con tildes no está en la lista (la lista es ASCII).
    expect(isWordInList("árbol")).toBe(false);
  });
});
