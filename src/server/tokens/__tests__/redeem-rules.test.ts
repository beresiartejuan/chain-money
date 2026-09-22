import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import {
  boxAccess,
  boxTokens,
  type SavingsBox,
  savingsBoxes,
  users,
} from "@/db/schema";
import { hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import {
  OwnBoxRedeemError,
  RateLimitError,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  TokenInvalidError,
} from "@/server/errors";
import { resetRateLimit } from "@/server/rate-limit";
import {
  REDEEM_RATE_LIMIT,
  redeemRateLimitKey,
  redeemToken,
} from "@/server/tokens/service";

/**
 * T054 — matriz consolidada de reglas de canje: la tabla completa de casos
 * de `redeemToken` en UN solo lugar (test parametrizado). Cada caso siembra
 * su propio estado (users/box/token con `newId` + emails aleatorios, así que
 * no hay colisiones de hash ni de rate limit entre casos) y se evalúa contra
 * el mismo contrato: error de dominio esperado, o canje exitoso con
 * `box_access` creado y token marcado `redeemed`.
 *
 * Es una CONSOLIDACIÓN: varios casos ya están cubiertos en
 * `redeem-token.test.ts` / `redeem-concurrent.test.ts`; acá se repiten como
 * matriz de referencia completa.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test (patrón de
// `redeem-token.test.ts`). Vitest hoistea `vi.mock` al tope del archivo.
vi.mock("server-only", () => ({}));

/** Tipo de db esperado por el service (lo que produce `drizzle()` libsql). */
type Db = Parameters<typeof redeemToken>[0];

/** Constructores de los errores de dominio que la matriz puede esperar. */
type RedeemErrorConstructor =
  | typeof TokenInvalidError
  | typeof TokenAlreadyRedeemedError
  | typeof TokenExpiredError
  | typeof OwnBoxRedeemError
  | typeof RateLimitError;

/** Estado seedeado por un caso + aserciones extra opcionales. */
type SeedResult = {
  /** Caller del canje (guest, owner según el caso). */
  userId: string;
  /** Token crudo que se pasa a `redeemToken` en la llamada del caso. */
  rawToken: string;
  /** Si está definido: tras un error, (boxId, userId) NO debe tener access. */
  boxId?: string;
  /** Si está definido: tras el error, el token debe seguir en este status. */
  tokenRowId?: string;
  expectedTokenStatus?: "active" | "redeemed" | "expired";
  /** Key de rate limit a limpiar entre casos (`resetRateLimit`). */
  rateLimitKey?: string;
};

/** Un caso de la matriz: seed propio + error esperado (`null` = éxito). */
type RedeemCase = {
  name: string;
  seed: (db: Db) => Promise<SeedResult>;
  expectedError: RedeemErrorConstructor | null;
};

/** Usuario seed genérico con email único. */
async function insertUser(db: Db, email: string): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email,
      passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
      name: "Seed",
    })
    .returning();
  const user = inserted[0];
  if (!user) {
    throw new Error("Failed to insert seed user");
  }
  return { id: user.id };
}

async function insertBox(db: Db, ownerId: string): Promise<SavingsBox> {
  const inserted = await db
    .insert(savingsBoxes)
    .values({
      id: newId(),
      ownerId,
      name: "Caja compartida",
      currency: "USD",
    })
    .returning();
  const box = inserted[0];
  if (!box) {
    throw new Error("Failed to insert seed box");
  }
  return box;
}

/**
 * Fila de token directamente en DB (sin `createToken`), con hash derivado de
 * `rawToken` para controlar el status inicial exacto de cada caso.
 */
async function insertTokenRow(
  db: Db,
  input: {
    boxId: string;
    createdBy: string;
    rawToken: string;
    permissions: string[];
    status: "active" | "expired" | "redeemed";
  },
) {
  const inserted = await db
    .insert(boxTokens)
    .values({
      id: newId(),
      boxId: input.boxId,
      tokenHash: hashAccessToken(input.rawToken),
      tokenPrefix: input.rawToken.slice(0, 8),
      permissions: JSON.stringify(input.permissions),
      status: input.status,
      createdBy: input.createdBy,
      redeemedAt: input.status === "redeemed" ? Date.now() : null,
      redeemedBy: input.status === "redeemed" ? input.createdBy : null,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert seed token");
  }
  return row;
}

/** Token crudo de 43 chars (mismo shape que `generateAccessToken`). */
function makeRawToken(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("base64url");
}

/** La matriz completa de reglas de canje (T054), un caso por fila. */
const cases: RedeemCase[] = [
  {
    name: "token activo válido → canjea (box_access creado)",
    expectedError: null,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-ok-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `t054-guest-ok-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-activo");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions", "create:transactions"],
        status: "active",
      });
      return {
        userId: guest.id,
        rawToken: raw,
        boxId: box.id,
        tokenRowId: row.id,
      };
    },
  },
  {
    name: "token alterado (1 char cambiado) → TokenInvalidError",
    expectedError: TokenInvalidError,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-alt-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `t054-guest-alt-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-alterado");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "active",
      });
      // Mismo largo (43), un char distinto: el hash no matchea → inválido.
      const tampered =
        raw.slice(0, 10) + (raw[10] === "A" ? "B" : "A") + raw.slice(11);
      return {
        userId: guest.id,
        rawToken: tampered,
        boxId: box.id,
        tokenRowId: row.id,
        expectedTokenStatus: "active",
      };
    },
  },
  {
    name: "status redeemed → TokenAlreadyRedeemedError",
    expectedError: TokenAlreadyRedeemedError,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-red-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `t054-guest-red-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-redeemed");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "redeemed",
      });
      return {
        userId: guest.id,
        rawToken: raw,
        boxId: box.id,
        tokenRowId: row.id,
        expectedTokenStatus: "redeemed",
      };
    },
  },
  {
    name: "status expired → TokenExpiredError",
    expectedError: TokenExpiredError,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-exp-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `t054-guest-exp-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-expired");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "expired",
      });
      return {
        userId: guest.id,
        rawToken: raw,
        boxId: box.id,
        tokenRowId: row.id,
        expectedTokenStatus: "expired",
      };
    },
  },
  {
    name: "owner canjeando propio → OwnBoxRedeemError",
    expectedError: OwnBoxRedeemError,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-own-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-propietario");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "active",
      });
      // El caller del caso es el PROPIO owner.
      return {
        userId: owner.id,
        rawToken: raw,
        boxId: box.id,
        tokenRowId: row.id,
        expectedTokenStatus: "active",
      };
    },
  },
  {
    name: "sin formato (string vacío) → TokenInvalidError",
    expectedError: TokenInvalidError,
    seed: async (db) => {
      const guest = await insertUser(
        db,
        `t054-guest-empty-${Math.random()}@example.com`,
      );
      // Sin box ni token: el pre-filtro de formato rechaza antes del lookup.
      return { userId: guest.id, rawToken: "" };
    },
  },
  {
    name: "rate limit agotado (11 llamadas) → RateLimitError",
    expectedError: RateLimitError,
    seed: async (db) => {
      const owner = await insertUser(
        db,
        `t054-owner-rl-${Math.random()}@example.com`,
      );
      const guest = await insertUser(
        db,
        `t054-guest-rl-${Math.random()}@example.com`,
      );
      const box = await insertBox(db, owner.id);
      const raw = makeRawToken("t054-cupo-agotado");
      const row = await insertTokenRow(db, {
        boxId: box.id,
        createdBy: owner.id,
        rawToken: raw,
        permissions: ["view:transactions"],
        status: "active",
      });
      const key = redeemRateLimitKey(guest.id);
      resetRateLimit(key); // ventana limpia para este caso
      // Las primeras REDEEM_RATE_LIMIT llamadas agotan el cupo (fallan por
      // formato, pero cuentan): la llamada del caso es la número 11.
      for (let i = 0; i < REDEEM_RATE_LIMIT; i += 1) {
        await expect(
          redeemToken(db, guest.id, `corto-${i}`),
        ).rejects.toBeInstanceOf(TokenInvalidError);
      }
      return {
        userId: guest.id,
        rawToken: raw,
        boxId: box.id,
        tokenRowId: row.id,
        expectedTokenStatus: "active",
        rateLimitKey: key,
      };
    },
  },
];

describe("redeemToken — matriz de reglas de canje (T054)", () => {
  const { client, db, migrateOnce } = createTestDb();

  /** Key del último caso, para el `resetRateLimit` entre casos. */
  let currentRateLimitKey: string | null = null;

  beforeAll(async () => {
    await migrateOnce();
  });

  afterEach(() => {
    // El cupo no se arrastra entre casos (cada caso usa un userId nuevo con
    // key propia, pero el reset explícito deja la garantía en evidencia).
    if (currentRateLimitKey !== null) {
      resetRateLimit(currentRateLimitKey);
      currentRateLimitKey = null;
    }
  });

  it.each(cases)("$name", async (testCase) => {
    const seeded = await testCase.seed(db);
    currentRateLimitKey =
      seeded.rateLimitKey ?? redeemRateLimitKey(seeded.userId);

    if (testCase.expectedError === null) {
      // Caso de éxito: el canje devuelve el boxId, crea el box_access con
      // los permisos del token y marca el token como redeemed.
      if (seeded.boxId === undefined || seeded.tokenRowId === undefined) {
        throw new Error("El caso de éxito debe seedear boxId y tokenRowId.");
      }
      const result = await redeemToken(db, seeded.userId, seeded.rawToken);
      expect(result.boxId).toBe(seeded.boxId);

      const access = await db
        .select()
        .from(boxAccess)
        .where(
          and(
            eq(boxAccess.boxId, seeded.boxId),
            eq(boxAccess.userId, seeded.userId),
          ),
        );
      expect(access).toHaveLength(1);
      expect(JSON.parse(access[0]?.permissions ?? "null")).toEqual([
        "view:transactions",
        "create:transactions",
      ]);

      const tokenRow = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, seeded.tokenRowId))
        .limit(1);
      expect(tokenRow[0]?.status).toBe("redeemed");
      return;
    }

    // Caso de error: el rechazo es el error de dominio esperado.
    await expect(
      redeemToken(db, seeded.userId, seeded.rawToken),
    ).rejects.toBeInstanceOf(testCase.expectedError);

    // Sin éxito no hay acceso otorgado.
    if (seeded.boxId !== undefined) {
      const access = await db
        .select()
        .from(boxAccess)
        .where(
          and(
            eq(boxAccess.boxId, seeded.boxId),
            eq(boxAccess.userId, seeded.userId),
          ),
        );
      expect(access).toHaveLength(0);
    }
    // Y el token no mutó de status (el rechazo no consume el token).
    if (seeded.tokenRowId !== undefined) {
      const tokenRow = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.id, seeded.tokenRowId))
        .limit(1);
      expect(tokenRow[0]?.status).toBe(seeded.expectedTokenStatus);
    }
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});
