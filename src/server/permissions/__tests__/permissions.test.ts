import { describe, expect, it, vi } from "vitest";
import type { Permission } from "@/db/schema";
import {
  ALL_PERMISSIONS,
  combinePermissions,
  isPermission,
  OWNER_PERMISSIONS,
  parsePermissionsJson,
  serializePermissionsJson,
} from "@/server/permissions/access";

/**
 * T046 — tests puros del módulo de permisos (sin DB): catálogo, unión de
 * sets y parseo/serialización tolerante del JSON de `permissions`.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío (mismo patrón que el resto de los tests de
// server). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

describe("ALL_PERMISSIONS / OWNER_PERMISSIONS (T046)", () => {
  it("expone el catálogo canónico de 3 permisos", () => {
    expect(ALL_PERMISSIONS).toEqual([
      "view:transactions",
      "create:transactions",
      "reset:box",
    ]);
  });

  it("OWNER_PERMISSIONS = todas", () => {
    expect(OWNER_PERMISSIONS).toEqual(ALL_PERMISSIONS);
  });

  it("isPermission acepta catálogo y rechaza desconocidos/no-strings", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(isPermission(permission)).toBe(true);
    }
    for (const bad of ["admin:all", "VIEW:TRANSACTIONS", "", 7, null, {}]) {
      expect(isPermission(bad)).toBe(false);
    }
  });
});

describe("combinePermissions (T046)", () => {
  it("une dos sets deduplicando", () => {
    expect(
      combinePermissions([
        ["view:transactions", "create:transactions"],
        ["create:transactions", "reset:box"],
      ]),
    ).toEqual(["view:transactions", "create:transactions", "reset:box"]);
  });

  it("unión de 0 sets → []", () => {
    expect(combinePermissions([])).toEqual([]);
  });

  it("sets vacíos → []", () => {
    expect(combinePermissions([[], []])).toEqual([]);
  });

  it("preserva orden de primera aparición y no muta entradas", () => {
    const a = ["reset:box", "view:transactions"] as const;
    const b = ["view:transactions"] as const;
    expect(combinePermissions([a, b])).toEqual([
      "reset:box",
      "view:transactions",
    ]);
    expect(a).toEqual(["reset:box", "view:transactions"]);
    expect(b).toEqual(["view:transactions"]);
  });

  it("un solo set sale igual (dedup interno idempotente)", () => {
    expect(
      combinePermissions([
        ["view:transactions", "view:transactions", "reset:box"],
      ]),
    ).toEqual(["view:transactions", "reset:box"]);
  });
});

describe("parsePermissionsJson (T046)", () => {
  it("parsea un JSON válido del catálogo", () => {
    expect(parsePermissionsJson('["view:transactions","reset:box"]')).toEqual([
      "view:transactions",
      "reset:box",
    ]);
  });

  it("JSON inválido → [] (nunca lanza)", () => {
    for (const garbage of ["", "no-json", "{", "null", "undefined", "["]) {
      expect(parsePermissionsJson(garbage)).toEqual([]);
    }
  });

  it("no-array (objeto, número, string) → []", () => {
    expect(parsePermissionsJson('{"view:transactions":true}')).toEqual([]);
    expect(parsePermissionsJson("3")).toEqual([]);
    expect(parsePermissionsJson('"view:transactions"')).toEqual([]);
  });

  it("ignora valores fuera del catálogo y duplicados, conservando válidos", () => {
    expect(
      parsePermissionsJson(
        '["view:transactions","admin:all","view:transactions","nope"]',
      ),
    ).toEqual(["view:transactions"]);
  });

  it("acepta mezcla con tipos no-string (se ignoran)", () => {
    expect(parsePermissionsJson('[1,null,"reset:box",{}]')).toEqual([
      "reset:box",
    ]);
  });

  it("array vacío → []", () => {
    expect(parsePermissionsJson("[]")).toEqual([]);
  });
});

describe("serializePermissionsJson (T046)", () => {
  it("serializa a JSON string[] canónico", () => {
    expect(serializePermissionsJson(["reset:box", "view:transactions"])).toBe(
      '["reset:box","view:transactions"]',
    );
  });

  it("deduplica al serializar", () => {
    expect(
      serializePermissionsJson(["view:transactions", "view:transactions"]),
    ).toBe('["view:transactions"]');
  });

  it("vacío → '[]'", () => {
    expect(serializePermissionsJson([])).toBe("[]");
  });

  it("round-trip: serialize → parse devuelve el mismo set", () => {
    const cases: readonly Permission[][] = [
      [],
      ["view:transactions"],
      ["reset:box", "create:transactions", "view:transactions"],
    ];
    for (const permissions of cases) {
      expect(
        parsePermissionsJson(serializePermissionsJson(permissions)),
      ).toEqual(permissions);
    }
  });
});
