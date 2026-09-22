import { strict as assert } from "node:assert";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  boxAccess,
  boxTokens,
  savingsBoxes,
  sessions,
  transactions,
  users,
} from "@/db/schema";
import { createTestDb } from "./helpers";

/**
 * T021 — Contrato del esquema contra una DB SQLite real (archivo temporal).
 * Aplica las migraciones de `drizzle/` (incluida la migración custom de
 * triggers de T019) y verifica: creación de todas las tablas vía ORM,
 * uniques (email, tokenHash, box_access box/user) y la FK restrictiva de
 * transactions hacia savings_boxes. Cada test usa su propia DB temporal.
 */

const testUser = {
  id: "0199aaaa-1111-7333-b111-000000000001",
  email: "user@example.com",
  passwordHash: "hash",
  name: "User",
};
const testBox = {
  id: "0199aaaa-2222-7333-b222-000000000002",
  ownerId: testUser.id,
  name: "Box",
  currency: "ARS",
};

function expectUniqueViolation(error: unknown, label: string) {
  assert(error instanceof Error, `${label}: expected an error`);
  // Drizzle envuelve el error en "Failed query: ..." y el mensaje original
  // de SQLite vive en `cause`.
  const cause = (error as { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : error.message;
  expect(message).toMatch(/UNIQUE constraint failed/);
}

describe("schema-db: migraciones en DB real", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("creates every table", async () => {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.rows.map((row) => row.name as string);
    for (const table of [
      "users",
      "sessions",
      "savings_boxes",
      "box_tokens",
      "box_access",
      "transactions",
    ]) {
      expect(names, `missing table: ${table}`).toContain(table);
    }
  });

  it("keeps the immutability triggers registered (T019 ordering)", async () => {
    const triggers = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    );
    const names = triggers.rows.map((row) => row.name as string);
    expect(names).toEqual(
      expect.arrayContaining([
        "transactions_no_update",
        "transactions_no_delete",
      ]),
    );
  });

  it("inserts the full chain: user → box → session → box_token → box_access → transaction", async () => {
    await db.insert(users).values(testUser);
    await db.insert(savingsBoxes).values(testBox);
    await db.insert(sessions).values({
      id: "session-hash",
      userId: testUser.id,
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });
    await db.insert(boxTokens).values({
      id: "0199aaaa-3333-7333-b333-000000000003",
      boxId: testBox.id,
      tokenHash: "token-hash-1",
      tokenPrefix: "prefix",
      permissions: '["view:transactions"]',
      status: "active",
      createdBy: testUser.id,
    });
    const [token] = await db
      .select()
      .from(boxTokens)
      .where(eq(boxTokens.tokenHash, "token-hash-1"));
    assert(token, "token just inserted must exist");
    await db.insert(boxAccess).values({
      id: "0199aaaa-4444-7333-b444-000000000004",
      boxId: testBox.id,
      userId: testUser.id,
      tokenId: token.id,
      permissions: '["view:transactions"]',
    });
    await db.insert(transactions).values({
      id: "0199aaaa-5555-7333-b555-000000000005",
      boxId: testBox.id,
      type: "deposit",
      amountMinor: 1000,
      note: "note",
      createdBy: testUser.id,
    });

    const rows = await client.execute("SELECT count(*) AS n FROM transactions");
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("rejects a duplicated user email", async () => {
    const duplicate = { ...testUser, id: "another-id" };
    let error: unknown;
    try {
      await db.insert(users).values(duplicate);
    } catch (e) {
      error = e;
    }
    expectUniqueViolation(error, "duplicate email");
  });

  it("rejects a duplicated box token hash", async () => {
    let error: unknown;
    try {
      await db.insert(boxTokens).values({
        id: "other-token-id",
        boxId: testBox.id,
        tokenHash: "token-hash-1",
        tokenPrefix: "prefix",
        permissions: '["view:transactions"]',
        status: "active",
        createdBy: testUser.id,
      });
    } catch (e) {
      error = e;
    }
    expectUniqueViolation(error, "duplicate tokenHash");
  });

  it("rejects a duplicated (boxId, userId) in box_access", async () => {
    let error: unknown;
    try {
      const [token] = await db
        .select()
        .from(boxTokens)
        .where(eq(boxTokens.tokenHash, "token-hash-1"));
      assert(token, "token from the chain test must exist");
      await db.insert(boxAccess).values({
        id: "other-access-id",
        boxId: testBox.id,
        userId: testUser.id,
        tokenId: token.id,
        permissions: '["create:transactions"]',
      });
    } catch (e) {
      error = e;
    }
    expectUniqueViolation(error, "duplicate (boxId, userId)");
  });

  it("rejects a transaction pointing to a missing box (restrictive FK)", async () => {
    let error: unknown;
    try {
      await db.insert(transactions).values({
        id: "orphan-tx",
        boxId: "0199aaaa-9999-7333-b999-000000000009",
        type: "deposit",
        amountMinor: 1,
        note: "orphan",
        createdBy: testUser.id,
      });
    } catch (e) {
      error = e;
    }
    assert(error instanceof Error, "expected an error");
    // Drizzle envuelve el error; el mensaje de SQLite vive en `cause`.
    const cause = (error as { cause?: unknown }).cause;
    const message = cause instanceof Error ? cause.message : error.message;
    expect(message).toMatch(/FOREIGN KEY constraint failed/);
  });
});
