import { describe, expect, it } from "vitest";
import {
  CURRENCY_EXPONENTS,
  type CurrencyCode,
  currencyExponent,
  isSupportedCurrency,
} from "../currency";

const supportedCodes = Object.keys(CURRENCY_EXPONENTS);

describe("isSupportedCurrency", () => {
  it("accepts every code in the catalog", () => {
    for (const code of supportedCodes) {
      expect(isSupportedCurrency(code), `code: ${code}`).toBe(true);
    }
  });

  it("accepts representative fiat currencies", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("ARS")).toBe(true);
    expect(isSupportedCurrency("JPY")).toBe(true);
  });

  it("rejects lowercase input (case-sensitive, documented)", () => {
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("Ars")).toBe(false);
  });

  it("rejects unknown codes", () => {
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(isSupportedCurrency("BTC")).toBe(false);
    expect(isSupportedCurrency("USDD")).toBe(false);
  });

  it("rejects empty and non-code strings", () => {
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(" US")).toBe(false);
  });
});

describe("currencyExponent", () => {
  it("returns 2 for two-decimal currencies", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("ARS")).toBe(2);
    expect(currencyExponent("UYU")).toBe(2);
  });

  it("returns 0 for zero-decimal currencies", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("CLP")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("PYG")).toBe(0);
  });

  it("throws a clear error for unsupported codes", () => {
    expect(() => currencyExponent("usd")).toThrowError(/usd/);
    expect(() => currencyExponent("BTC")).toThrowError(/Unsupported currency/);
  });
});

describe("CurrencyCode", () => {
  it("is a union of catalog keys, usable as a type", () => {
    const codes: CurrencyCode[] = supportedCodes.map(
      (code) => code as CurrencyCode,
    );
    expect(codes).toHaveLength(supportedCodes.length);
  });
});
