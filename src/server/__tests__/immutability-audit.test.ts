import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * T082 — auditoría anti-edición/borrado a nivel superficie de API. La
 * inmutabilidad de las filas de `transactions` ya está enforceada y testeada
 * a nivel DB (T022, triggers); acá se verifica que ni las actions ni el
 * service de transacciones exponen ninguna función de edición/borrado
 * (`updateTransaction`/`deleteTransaction` ni variantes): si alguien añadiera
 * un export de ese estilo, este test lo detecta en `pnpm test`.
 */

vi.mock("server-only", () => ({}));

// `@/db` se mockea (requiere TURSO_DATABASE_URL y dotenv); a las actions no
// les importa: solo necesitan que el import del módulo resuelva.
vi.mock("@/db", () => ({ db: {} }));

// `session.ts` importa `next/headers`, que no existe fuera del bundler de
// Next (mismo patrón que `incremental-endpoint.test.ts`).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/** Exportes que jamás deben existir en la API de transacciones. */
const FORBIDDEN =
  /updateTransaction|deleteTransaction|removeTransaction|editTransaction/;

describe("immutability audit: API de transacciones (T082)", () => {
  let actionExports: string[];
  let serviceExports: string[];

  beforeAll(async () => {
    const [actions, service] = await Promise.all([
      import("@/server/transactions/actions"),
      import("@/server/transactions/service"),
    ]);
    actionExports = Object.keys(actions);
    serviceExports = Object.keys(service);
  });

  it("actions.ts y service.ts no exportan nada tipo update/delete de transacciones", () => {
    expect(actionExports).not.toContainEqual(expect.stringMatching(FORBIDDEN));
    expect(serviceExports).not.toContainEqual(expect.stringMatching(FORBIDDEN));
  });
});
