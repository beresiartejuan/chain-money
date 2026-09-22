import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  generateAccessToken,
  hashAccessToken,
} from "@/lib/crypto/token";

const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

describe("generateAccessToken", () => {
  it("genera 1000 tokens únicos, todos con prefix de 8 chars", () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { token, hash, prefix } = generateAccessToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(prefix).toHaveLength(8);
      expect(hash).toMatch(HEX_SHA256_PATTERN);
      tokens.add(token);
      hashes.add(hash);
    }
    expect(tokens.size).toBe(1000);
    expect(hashes.size).toBe(1000);
  });

  it("el hash corresponde al SHA-256 del token", () => {
    const { token, hash } = generateAccessToken();
    expect(hash).toBe(hashAccessToken(token));
  });

  it("el prefix son los primeros 8 chars del token", () => {
    const { token, prefix } = generateAccessToken();
    expect(prefix).toBe(token.slice(0, 8));
  });
});

describe("hashAccessToken", () => {
  it("es determinista", () => {
    expect(hashAccessToken("raw-token")).toBe(hashAccessToken("raw-token"));
  });

  it("produce SHA-256 hex correcto", () => {
    expect(hashAccessToken("raw-token")).toMatch(HEX_SHA256_PATTERN);
    expect(hashAccessToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("distingue entradas distintas", () => {
    expect(hashAccessToken("a")).not.toBe(hashAccessToken("b"));
  });
});

describe("constantTimeEqual", () => {
  it("devuelve true para strings iguales", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("devuelve false para strings distintos", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "")).toBe(false);
  });

  it("devuelve false (sin lanzar) con longitudes distintas", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("a", "abc")).toBe(false);
  });
});
