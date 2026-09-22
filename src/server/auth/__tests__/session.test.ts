import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/__tests__/helpers";
import { type Session, sessions, type User, users } from "@/db/schema";
import { generateAccessToken, hashAccessToken } from "@/lib/crypto/token";
import { newId } from "@/lib/ids";
import { createSessionRow, resolveSessionUser } from "@/server/auth/service";

/**
 * T028 — resolver de sesión actual, contra DB real (SQLite temporal con las
 * migraciones de `drizzle/`). La lógica pura vive en `resolveSessionUser`
 * (`service.ts`): recibe el hash del token y la db, sin tocar cookies, así
 * que se testa directo. La capa de cookie (`session.ts`) es un glue delgado
 * que se cubre por inspección: cookie ausente → `null` sin tocar la DB,
 * cookie presente → `resolveSessionUser(db, hash)`.
 */

// `server-only` solo funciona dentro del bundler de Next; en Vitest (Node)
// lanza al importarse. Stub vacío solo para este test.
vi.mock("server-only", () => ({}));

describe("resolveSessionUser (T028)", () => {
  const { db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  /** Inserta un usuario directo en DB (sin pasar por registerUser). */
  async function insertUser(overrides: Partial<User> = {}): Promise<User> {
    const values = {
      id: overrides.id ?? newId(),
      email: overrides.email ?? `seed-${newId()}@example.com`,
      passwordHash:
        overrides.passwordHash ?? "scrypt$16384$8$1$seedSalt$seedHash",
      name: overrides.name ?? "Seed",
      ...overrides,
    };
    const inserted = await db.insert(users).values(values).returning();
    return inserted[0] as User;
  }

  /** Inserta una fila de sesión con expiry controlada. */
  async function insertSession(
    userId: string,
    overrides: Partial<Session> = {},
  ): Promise<{ row: Session; tokenHash: string }> {
    const tokenHash = overrides.id ?? generateAccessToken().hash;
    const now = Date.now();
    const values = {
      id: tokenHash,
      userId,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
      ...overrides,
    };
    const inserted = await db.insert(sessions).values(values).returning();
    return { row: inserted[0] as Session, tokenHash };
  }

  it("cookie con token válido → devuelve el user de la sesión", async () => {
    const user = await insertUser();
    const { row } = await insertSession(user.id);

    const resolved = await resolveSessionUser(db, row.id);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(user.id);
    expect(resolved?.email).toBe(user.email);
  });

  it("sesión expirada → null y NO autentica (lazy-delete borra la fila)", async () => {
    const user = await insertUser();
    const { row } = await insertSession(user.id, {
      expiresAt: Date.now() - 1000, // vencida hace 1s
    });

    // Expira NO autentica: devuelve null aunque la fila exista
    const resolved = await resolveSessionUser(db, row.id);
    expect(resolved).toBeNull();

    // Lazy-delete: la fila vencida se borró al consultarla
    const remaining = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, row.id));
    expect(remaining).toHaveLength(0);
  });

  it("token inexistente → null (y no borra otras sesiones)", async () => {
    const user = await insertUser();
    const { row } = await insertSession(user.id);

    const resolved = await resolveSessionUser(
      db,
      hashAccessToken("token-que-no-existe"),
    );
    expect(resolved).toBeNull();

    // La sesión válida sigue intacta
    const kept = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, row.id));
    expect(kept).toHaveLength(1);
  });

  it("sesión de otro user no cruza datos (id = hash, owner único)", async () => {
    const userA = await insertUser();
    const userB = await insertUser();
    const { row } = await insertSession(userA.id);

    const resolved = await resolveSessionUser(db, row.id);
    expect(resolved?.id).toBe(userA.id);
    expect(resolved?.id).not.toBe(userB.id);
  });

  it("el flujo real createSessionRow → hash del token resuelve al user", async () => {
    const user = await insertUser();
    const { token } = await createSessionRow(db, user.id);

    // Lo que haría getCurrentUser: hash del token crudo de la cookie
    const resolved = await resolveSessionUser(db, hashAccessToken(token));
    expect(resolved?.id).toBe(user.id);
  });
});
