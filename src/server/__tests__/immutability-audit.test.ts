import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T082 — auditoría anti-edición/borrado a nivel superficie de API. La
 * inmutabilidad de las filas de `transactions` ya está enforceada y testeada
 * a nivel DB (T022, triggers); acá se verifica que ni las actions ni el
 * service de transacciones exponen ninguna función de edición/borrado
 * (`updateTransaction`/`deleteTransaction` ni variantes): si alguien añadiera
 * un export de ese estilo, este test lo detecta en `pnpm test`.
 *
 * Auditoría ESTÁTICA (lee los fuentes, no los importa): determinista en
 * cualquier entorno — no depende de mocks de `server-only`/`next/headers`,
 * que son frágiles fuera del bundler de Next (falló en CI).
 */

/** Exportes que jamás deben existir en la API de transacciones. */
const FORBIDDEN =
  /updateTransaction|deleteTransaction|removeTransaction|editTransaction/;

/**
 * Nombres exportados con valor de runtime (funciones y consts) del archivo.
 * Los `export type`/`interface` se ignoran: un tipo no puede borrar filas.
 */
function exportedRuntimeNames(relativePath: string): string[] {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const names: string[] = [];
  for (const match of source.matchAll(
    /\bexport\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

describe("immutability audit: API de transacciones (T082)", () => {
  it("actions.ts no exporta nada tipo update/delete de transacciones", () => {
    const names = exportedRuntimeNames("src/server/transactions/actions.ts");
    expect(names.length).toBeGreaterThan(0); // el archivo existe y exporta
    expect(names.filter((name) => FORBIDDEN.test(name))).toEqual([]);
  });

  it("service.ts no exporta nada tipo update/delete de transacciones", () => {
    const names = exportedRuntimeNames("src/server/transactions/service.ts");
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => FORBIDDEN.test(name))).toEqual([]);
  });
});
