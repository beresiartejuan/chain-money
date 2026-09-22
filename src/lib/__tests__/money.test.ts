import { describe, expect, it } from "vitest";
import { formatFromMinorUnits, parseAmountToMinorUnits } from "@/lib/money";

describe("parseAmountToMinorUnits", () => {
  it("parses a valid decimal with 2 decimals", () => {
    expect(parseAmountToMinorUnits("12.34", 2)).toBe(1234);
  });

  it("accepts a value without decimals and pads with zeros", () => {
    expect(parseAmountToMinorUnits("12", 2)).toBe(1200);
    expect(parseAmountToMinorUnits("12", 0)).toBe(12);
  });

  it("accepts the exact decimal limit", () => {
    expect(parseAmountToMinorUnits("12.3", 2)).toBe(1230);
    expect(parseAmountToMinorUnits("0.99", 2)).toBe(99);
    expect(parseAmountToMinorUnits("0.5", 1)).toBe(5);
    expect(parseAmountToMinorUnits("1.05", 2)).toBe(105);
  });

  it("rejects more decimals than the exponent allows", () => {
    expect(() => parseAmountToMinorUnits("12.345", 2)).toThrowError();
  });

  it("rejects negative values", () => {
    expect(() => parseAmountToMinorUnits("-12.34", 2)).toThrowError();
  });

  it("rejects zero", () => {
    expect(() => parseAmountToMinorUnits("0", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("0.00", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("0.0", 1)).toThrowError();
  });

  it("rejects non-numeric strings and NaN-like input", () => {
    expect(() => parseAmountToMinorUnits("abc", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("NaN", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("12.34.56", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("1 000", 2)).toThrowError();
    expect(() => parseAmountToMinorUnits("12,", 2)).toThrowError();
  });

  it("rejects non-integer or negative exponent", () => {
    expect(() => parseAmountToMinorUnits("12.34", -1)).toThrowError();
    expect(() => parseAmountToMinorUnits("12.34", 1.5)).toThrowError();
  });

  it("supports exponent 0", () => {
    expect(parseAmountToMinorUnits("1200", 0)).toBe(1200);
    expect(() => parseAmountToMinorUnits("12.0", 0)).toThrowError();
  });

  it("rejects values beyond the safe integer range", () => {
    expect(() =>
      parseAmountToMinorUnits("123456789012345678", 2),
    ).toThrowError();
  });
});

describe("formatFromMinorUnits", () => {
  it("formats 1234 with exponent 2 as 12.34", () => {
    expect(formatFromMinorUnits(1234, 2)).toBe("12.34");
  });

  it("formats 1200 with exponent 0 as 1200", () => {
    expect(formatFromMinorUnits(1200, 0)).toBe("1200");
  });

  it("round-trips values parsed by parseAmountToMinorUnits", () => {
    expect(formatFromMinorUnits(parseAmountToMinorUnits("12.34", 2), 2)).toBe(
      "12.34",
    );
    expect(formatFromMinorUnits(parseAmountToMinorUnits("12", 2), 2)).toBe(
      "12.00",
    );
    expect(formatFromMinorUnits(parseAmountToMinorUnits("0.05", 2), 2)).toBe(
      "0.05",
    );
  });

  it("rejects negative or non-integer minor units", () => {
    expect(() => formatFromMinorUnits(-1234, 2)).toThrowError();
    expect(() => formatFromMinorUnits(12.5, 2)).toThrowError();
  });

  it("rejects non-integer or negative exponent", () => {
    expect(() => formatFromMinorUnits(1234, -1)).toThrowError();
    expect(() => formatFromMinorUnits(1234, 1.5)).toThrowError();
  });
});
