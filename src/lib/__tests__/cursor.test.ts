import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { type Cursor, compareTuples, makeCursor, parseCursor } from "../cursor";

function cursorOf(createdAtMs: number, id: string): Cursor {
  return { createdAtMs, id };
}

// Referencia explícita al Buffer real: los tests de dual-runtime ocultan el
// global `Buffer` para simular el navegador, así que esta importación es la
// única fuente confiable para restaurarlo (un `globalThis.Buffer = Buffer`
// leería el shadoweado, quedándose sin Buffer para siempre).
const REAL_BUFFER = Buffer;

/** Oculta el global Buffer para forzar el camino btoa/atob del navegador. */
function hideBuffer(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  if (!descriptor?.configurable) {
    throw new Error("Buffer global no configurable");
  }
  // @ts-expect-error -- asignamos deliberadamente un valor no-Buffer
  globalThis.Buffer = undefined;
}

/** Restaura el global Buffer real después de `hideBuffer()`. */
function restoreBuffer(): void {
  globalThis.Buffer = REAL_BUFFER;
}

afterEach(() => {
  restoreBuffer();
});

describe("makeCursor + parseCursor roundtrip", () => {
  it("is identity for a simple cursor", () => {
    const cursor = cursorOf(1_726_000_000_000, "tx_1");
    expect(parseCursor(makeCursor(cursor.createdAtMs, cursor.id))).toEqual(
      cursor,
    );
  });

  it("is identity for epoch zero and unicode ids", () => {
    const cases: Cursor[] = [
      cursorOf(0, ""),
      cursorOf(1_726_000_000_000, "id-with-ñ-and-日本"),
    ];

    for (const cursor of cases) {
      expect(parseCursor(makeCursor(cursor.createdAtMs, cursor.id))).toEqual(
        cursor,
      );
    }
  });

  it("encodes base64url without padding", () => {
    const encoded = makeCursor(1_726_000_000_000, "tx_1");
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("parseCursor", () => {
  it("returns null for garbage input", () => {
    expect(parseCursor("garbage")).toBeNull();
    expect(parseCursor("")).toBeNull();
    expect(parseCursor("!!!")).toBeNull();
  });

  it("returns null for valid base64 of invalid JSON", () => {
    const notJson = Buffer.from("not-json", "utf8").toString("base64url");
    expect(parseCursor(notJson)).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    const cases = ["null", "42", '"text"', "[]", "true"];

    for (const json of cases) {
      expect(
        parseCursor(Buffer.from(json, "utf8").toString("base64url")),
      ).toBeNull();
    }
  });

  it("returns null for wrong field types", () => {
    const cases = [
      { t: "1_726_000_000_000", i: "tx_1" },
      { t: 1_726_000_000_000, i: 42 },
      { t: true, i: "tx_1" },
      { t: Number.NaN, i: "tx_1" },
      { t: Number.POSITIVE_INFINITY, i: "tx_1" },
    ];

    for (const payload of cases) {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
        "base64url",
      );
      expect(parseCursor(encoded), JSON.stringify(payload)).toBeNull();
    }
  });

  it("returns null for missing fields", () => {
    const cases = [{}, { t: 1_726_000_000_000 }, { i: "tx_1" }];

    for (const payload of cases) {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
        "base64url",
      );
      expect(parseCursor(encoded), JSON.stringify(payload)).toBeNull();
    }
  });

  it("tolerates unknown extra fields", () => {
    const encoded = Buffer.from(
      JSON.stringify({ t: 1_726_000_000_000, i: "tx_1", extra: true }),
      "utf8",
    ).toString("base64url");

    expect(parseCursor(encoded)).toEqual(cursorOf(1_726_000_000_000, "tx_1"));
  });
});

describe("compareTuples", () => {
  it("orders by createdAtMs", () => {
    const older = cursorOf(1_000, "b");
    const newer = cursorOf(2_000, "a");

    expect(compareTuples(older, newer)).toBeLessThan(0);
    expect(compareTuples(newer, older)).toBeGreaterThan(0);
  });

  it("breaks ties by id lexicographically", () => {
    const a = cursorOf(1_000, "a");
    const b = cursorOf(1_000, "b");

    expect(compareTuples(a, b)).toBeLessThan(0);
    expect(compareTuples(b, a)).toBeGreaterThan(0);
    expect(compareTuples(a, cursorOf(1_000, "a"))).toBe(0);
  });

  it("sorts a mixed array into a stable total order", () => {
    const expected: Cursor[] = [
      cursorOf(1_000, "a"),
      cursorOf(1_000, "b"),
      cursorOf(1_000, "c"),
      cursorOf(2_000, "a"),
      cursorOf(2_000, "z"),
      cursorOf(3_000, "a"),
    ];

    const actual = [...expected].sort(() => Math.random() - 0.5);
    const sorted = actual.sort(compareTuples);

    expect(sorted).toEqual(expected);
  });
});

describe("dual-runtime (camino navegador, sin Buffer)", () => {
  // El módulo elige `Buffer` si existe y si no `btoa`/`atob` + TextEncoder/
  // TextDecoder (lo que corre en el cliente). El código sin Buffer es la
  // mitad del motivo del módulo: sin esta prueba podría romperse en el
  // navegador aunque los roundtrips pasen en Node.

  it("makeCursor/parseCursor roundtrip vía btoa/atob", () => {
    hideBuffer();

    const cursor = cursorOf(1_726_000_000_000, "id-con-ñ-y-日本");
    expect(parseCursor(makeCursor(cursor.createdAtMs, cursor.id))).toEqual(
      cursor,
    );
  });

  it("codifica sin padding y sin +/-/ en modo navegador, igual que en Node", () => {
    hideBuffer();

    const encoded = makeCursor(1_726_000_000_000, "tx_1");
    expect(encoded).not.toMatch(/[+/=]/);

    // El camino btoa/atob debe producir exactamente el mismo string que el
    // camino Buffer: el backend no puede distinguir qué runtime codificó.
    restoreBuffer();
    expect(encoded).toBe(makeCursor(1_726_000_000_000, "tx_1"));
  });

  it("parseCursor devuelve null con base64 inválido en modo navegador", () => {
    hideBuffer();

    // "!!!" no es base64 válido: atob lanza y decodeBase64Url devuelve null.
    expect(parseCursor("!!!")).toBeNull();

    // base64 válido cuyo decodificado no es JSON: cae en el camino de JSON.
    expect(parseCursor(btoa("not-json"))).toBeNull();
  });
});
