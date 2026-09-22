import { describe, expect, it } from "vitest";
import { isUuidV7, newId } from "@/lib/ids";

describe("newId", () => {
  it("produces a valid UUIDv7", () => {
    const id = newId();
    expect(isUuidV7(id)).toBe(true);
  });

  it("produces 1000 unique ids (no collisions)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(newId());
    }
    expect(ids.size).toBe(1000);
  });

  it("produces temporally ordered ids (consecutive ids do not decrease lexicographically)", () => {
    let previous = newId();
    for (let i = 0; i < 1000; i++) {
      const current = newId();
      expect(current >= previous).toBe(true);
      previous = current;
    }
  });
});

describe("isUuidV7", () => {
  it("accepts ids produced by newId", () => {
    for (let i = 0; i < 50; i++) {
      expect(isUuidV7(newId())).toBe(true);
    }
  });

  it("rejects non-uuid strings", () => {
    expect(isUuidV7("")).toBe(false);
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7("01a0b6c8-6d1f-710e-a8af-0e58ea35a47")).toBe(false);
    expect(isUuidV7("01a0b6c8-6d1f-710e-a8af-0e58ea35a47d-extra")).toBe(false);
  });

  it("rejects valid-format uuids of other versions", () => {
    // v4
    expect(isUuidV7("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")).toBe(false);
    // v1
    expect(isUuidV7("c9bf9e57-1685-4c89-bafb-ff5af830be8a")).toBe(false);
  });
});
