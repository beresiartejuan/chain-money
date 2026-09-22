import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import {
  boxAccess,
  boxTokens,
  type SavingsBox,
  savingsBoxes,
  users,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { NotFoundError, PermissionError } from "@/server/errors";
import {
  ALL_PERMISSIONS,
  type EffectiveAccess,
  OWNER_PERMISSIONS,
  resolveEffectiveAccess,
  serializePermissionsJson,
} from "@/server/permissions/access";
import {
  assertPermission,
  canCreate,
  canReset,
  canView,
  requireBoxAccess,
} from "@/server/permissions/assert";

/**
 * T046/T047 — resolución de acceso efectivo y gate de autorización contra
 * DB real (SQLite temporal con las migraciones de `drizzle/`). Igual que en
 * el resto de los services, la db va por parámetro: no hay cookies ni
 * runtime de Next en el camino (los helpers de sesión viven en
 * `src/server/auth/` y no se cubren acá).
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío para este test (patrón de
// `src/server/boxes/__tests__/create-box.test.ts`).
vi.mock("server-only", () => ({}));

/** Usuario seed con email único por fila. */
async function insertUser(
  db: LibSQLDatabase,
  name: string,
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: `${name.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "scrypt$16384$8$1$seedSalt$seedHash",
      name,
    })
    .returning();
  const user = inserted[0];
  if (!user) {
    throw new Error("Failed to insert seed user");
  }
  return { id: user.id };
}

/** Crea una alcancía con `ownerId` y devuelve la fila completa. */
async function insertBox(
  db: LibSQLDatabase,
  ownerId: string,
  name: string,
): Promise<SavingsBox> {
  const inserted = await db
    .insert(savingsBoxes)
    .values({
      id: newId(),
      ownerId,
      name,
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
 * Otorga `permissions` (JSON string) a `userId` sobre `boxId` vía
 * `box_access`, creando antes el token requerido por la FK `tokenId`.
 */
async function grantAccess(
  db: LibSQLDatabase,
  boxId: string,
  userId: string,
  permissions: string,
): Promise<void> {
  const tokenId = newId();
  await db.insert(boxTokens).values({
    id: tokenId,
    boxId,
    tokenHash: `hash-${tokenId}`,
    tokenPrefix: "abcd1234",
    permissions,
    status: "redeemed",
    createdBy: userId,
  });
  await db.insert(boxAccess).values({
    id: newId(),
    boxId,
    userId,
    tokenId,
    permissions,
  });
}

/** Atajo: acceso efectivo como `EffectiveAccess`. */
function accessOf(
  db: LibSQLDatabase,
  userId: string,
  boxId: string,
): Promise<EffectiveAccess> {
  return resolveEffectiveAccess(db, userId, boxId);
}

/** Extrae el `code` estable de un AppError para los asserts. */
function codeOf(error: unknown): string {
  return (error as { code: string }).code;
}

describe("resolveEffectiveAccess (T046)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner → isOwner true, boxExists true, TODOS los permisos", async () => {
    const owner = await insertUser(db, "Owner");
    const box = await insertBox(db, owner.id, "Caja del owner");

    const access = await accessOf(db, owner.id, box.id);

    expect(access.isOwner).toBe(true);
    expect(access.boxExists).toBe(true);
    expect(access.permissions).toEqual([...OWNER_PERMISSIONS]);
    expect(access.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it("guest con access → exactamente su set, sin heredar owner", async () => {
    const owner = await insertUser(db, "Owner2");
    const guest = await insertUser(db, "Guest");
    const box = await insertBox(db, owner.id, "Caja compartida");
    await grantAccess(db, box.id, guest.id, '["view:transactions"]');

    const access = await accessOf(db, guest.id, box.id);

    expect(access.isOwner).toBe(false);
    expect(access.boxExists).toBe(true);
    expect(access.permissions).toEqual(["view:transactions"]);
  });

  it("guest con JSON corrupto (basura) → [] (tolerante, nunca lanza)", async () => {
    const owner = await insertUser(db, "Owner3");
    const guest = await insertUser(db, "GuestCorrupto");
    const box = await insertBox(db, owner.id, "Caja corrupta");
    await grantAccess(db, box.id, guest.id, "no-es-json{{{");

    const access = await accessOf(db, guest.id, box.id);

    expect(access.boxExists).toBe(true);
    expect(access.permissions).toEqual([]);
  });

  it("guest con valores fuera del catálogo → []", async () => {
    const owner = await insertUser(db, "Owner4");
    const guest = await insertUser(db, "GuestBasura");
    const box = await insertBox(db, owner.id, "Caja basura");
    await grantAccess(db, box.id, guest.id, '["admin:all",42,null]');

    const access = await accessOf(db, guest.id, box.id);

    expect(access.permissions).toEqual([]);
  });

  it("extraño → boxExists true, sin permisos (isOwner false)", async () => {
    const owner = await insertUser(db, "Owner5");
    const stranger = await insertUser(db, "Stranger");
    const box = await insertBox(db, owner.id, "Caja ajena");

    const access = await accessOf(db, stranger.id, box.id);

    expect(access.isOwner).toBe(false);
    expect(access.boxExists).toBe(true);
    expect(access.permissions).toEqual([]);
  });

  it("box inexistente → boxExists false y []", async () => {
    const stranger = await insertUser(db, "Stranger2");
    const access = await accessOf(db, stranger.id, newId());

    expect(access.boxExists).toBe(false);
    expect(access.isOwner).toBe(false);
    expect(access.permissions).toEqual([]);
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});

describe("assertPermission (T047)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner pasa cualquier permiso (no lanza)", async () => {
    const owner = await insertUser(db, "OwnerT047a");
    const box = await insertBox(db, owner.id, "Caja owner T047");

    for (const permission of ALL_PERMISSIONS) {
      await expect(
        assertPermission(db, owner.id, box.id, permission),
      ).resolves.toBeUndefined();
    }
  });

  it("guest con el permiso pedido pasa; el que falta → PermissionError", async () => {
    const owner = await insertUser(db, "OwnerT047b");
    const guest = await insertUser(db, "GuestT047b");
    const box = await insertBox(db, owner.id, "Caja guest T047");
    await grantAccess(
      db,
      box.id,
      guest.id,
      '["view:transactions","create:transactions"]',
    );

    await expect(
      assertPermission(db, guest.id, box.id, "view:transactions"),
    ).resolves.toBeUndefined();
    await expect(
      assertPermission(db, guest.id, box.id, "create:transactions"),
    ).resolves.toBeUndefined();

    await expect(
      assertPermission(db, guest.id, box.id, "reset:box"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PermissionError);
      expect((error as PermissionError).code).toBe("forbidden");
      return true;
    });
  });

  it("extraño con box existente → PermissionError (forbidden)", async () => {
    const owner = await insertUser(db, "OwnerT047c");
    const stranger = await insertUser(db, "StrangerT047c");
    const box = await insertBox(db, owner.id, "Caja extraño T047");

    await expect(
      assertPermission(db, stranger.id, box.id, "view:transactions"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PermissionError);
      expect((error as PermissionError).code).toBe("forbidden");
      return true;
    });
  });

  it("box inexistente → NotFoundError (not_found)", async () => {
    const user = await insertUser(db, "OwnerT047d");

    await expect(
      assertPermission(db, user.id, newId(), "view:transactions"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe("not_found");
      return true;
    });
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});

describe("requireBoxAccess (T047)", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("owner → box completa + isOwner + todos los permisos", async () => {
    const owner = await insertUser(db, "OwnerT047e");
    const box = await insertBox(db, owner.id, "Caja owner require");

    const result = await requireBoxAccess(db, owner.id, box.id);

    expect(result.box.id).toBe(box.id);
    expect(result.box.ownerId).toBe(owner.id);
    expect(result.box.name).toBe("Caja owner require");
    expect(result.isOwner).toBe(true);
    expect(result.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it("guest → box completa + su set", async () => {
    const owner = await insertUser(db, "OwnerT047f");
    const guest = await insertUser(db, "GuestT047f");
    const box = await insertBox(db, owner.id, "Caja guest require");
    await grantAccess(db, box.id, guest.id, '["view:transactions"]');

    const result = await requireBoxAccess(db, guest.id, box.id);

    expect(result.box.id).toBe(box.id);
    expect(result.isOwner).toBe(false);
    expect(result.permissions).toEqual(["view:transactions"]);
  });

  it("extraño → NotFoundError (oculta la existencia)", async () => {
    const owner = await insertUser(db, "OwnerT047g");
    const stranger = await insertUser(db, "StrangerT047g");
    const box = await insertBox(db, owner.id, "Caja oculta");

    await expect(requireBoxAccess(db, stranger.id, box.id)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).code).toBe("not_found");
        return true;
      },
    );
  });

  it("box inexistente → NotFoundError", async () => {
    const user = await insertUser(db, "OwnerT047h");

    await expect(requireBoxAccess(db, user.id, newId())).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(NotFoundError);
        expect(codeOf(error)).toBe("not_found");
        return true;
      },
    );
  });

  it("cierra la db temporal", () => {
    expect(client).toBeDefined();
  });
});

describe("helpers de UI: canView / canCreate / canReset (T047)", () => {
  it("owner pasa todo sin importar permissions", () => {
    const access: EffectiveAccess = {
      isOwner: true,
      boxExists: true,
      permissions: [],
    };
    expect(canView(access)).toBe(true);
    expect(canCreate(access)).toBe(true);
    expect(canReset(access)).toBe(true);
  });

  it("guest pasa solo con el permiso correspondiente", () => {
    const access: EffectiveAccess = {
      isOwner: false,
      boxExists: true,
      permissions: ["view:transactions", "create:transactions"],
    };
    expect(canView(access)).toBe(true);
    expect(canCreate(access)).toBe(true);
    expect(canReset(access)).toBe(false);
  });

  it("sin permisos no puede nada", () => {
    const access: EffectiveAccess = {
      isOwner: false,
      boxExists: true,
      permissions: [],
    };
    expect(canView(access)).toBe(false);
    expect(canCreate(access)).toBe(false);
    expect(canReset(access)).toBe(false);
  });

  it("grantAccess inserta filas consistentes (sanity de los seeds)", async () => {
    const { db: sanityDb, migrateOnce: migrate } = createTestDb();
    await migrate();

    const owner = await insertUser(sanityDb, "Sanity");
    const guest = await insertUser(sanityDb, "SanityGuest");
    const box = await insertBox(sanityDb, owner.id, "Caja sanity");
    await grantAccess(
      sanityDb,
      box.id,
      guest.id,
      serializePermissionsJson(["view:transactions"]),
    );

    const rows = await sanityDb
      .select()
      .from(boxAccess)
      .where(eq(boxAccess.boxId, box.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to read seed row");
    }
    expect(row.userId).toBe(guest.id);
    expect(row.permissions).toBe('["view:transactions"]');
  });
});
