import { describe, expect, it } from "vitest";
import { add } from "@/lib/__tests__/helpers";

describe("smoke", () => {
  it("runs under the node environment", () => {
    expect(typeof process.versions.node).toBe("string");
  });

  it("does plain arithmetic", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("resolves the @ alias to ./src", () => {
    expect(add(40, 2)).toBe(42);
  });
});
