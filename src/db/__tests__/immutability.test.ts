import { strict as assert } from "node:assert";
import type { Client } from "@libsql/client";
import { beforeAll, describe, expect, it } from "vitest";
import { savingsBoxes, transactions, users } from "@/db/schema";
import { createTestDb } from "./helpers";

/**
 * T022 — Inmutabilidad de `transactions` como contrato testeado a nivel DB.
 *
 * Los triggers `transactions_no_update` / `transactions_no_delete`
 * (migración custom `drizzle/20260918234547_immutability_triggers`) lanzan
 * `RAISE(ABORT, 'transactions are immutable')` en cualquier UPDATE/DELETE.
 * Acá se verifica contra una DB SQLite real (archivo temporal): el INSERT
 * funciona (control positivo), UPDATE y DELETE crudos vía cliente libSQL
 * fallan con el mensaje del trigger, y la fila queda intacta.
 */

const testUser = {
  id: "0199bbbb-1111-7333-b111-000000000001",
  email: "immutable-user@example.com",
  passwordHash: "hash",
  name: "User",
};
const testBox = {
  id: "0199bbbb-2222-7333-b222-000000000002",
  ownerId: testUser.id,
  name: "Box",
  currency: "ARS",
};
const txId = "0199bbbb-5555-7333-b555-000000000005";
const txAmountMinor = 1000;

function expectImmutableViolation(error: unknown, label: string) {
  assert(error instanceof Error, `${label}: expected an error`);
  // El mensaje real de SQLite vive en `message` (el cliente crudo de libSQL
  // no lo envuelve), pero por si algún wrapper lo mete en `cause` también lo
  // contemplamos (mismo patrón que schema-db.test.ts usa con Drizzle).
  const cause = (error as { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : error.message;
  expect(message).toMatch(/transactions are immutable/);
}

async function selectAmountMinor(client: Client): Promise<number | undefined> {
  const rows = await client.execute({
    sql: "SELECT amountMinor FROM transactions WHERE id = ?",
    args: [txId],
  });
  return rows.rows[0]?.amountMinor as number | undefined;
}

describe("immutability: triggers sobre transactions", () => {
  const { client, db, migrateOnce } = createTestDb();

  beforeAll(async () => {
    await migrateOnce();
  });

  it("inserts a valid transaction (positive control)", async () => {
    await db.insert(users).values(testUser);
    await db.insert(savingsBoxes).values(testBox);
    await db.insert(transactions).values({
      id: txId,
      boxId: testBox.id,
      type: "deposit",
      amountMinor: txAmountMinor,
      note: "seed",
      createdBy: testUser.id,
    });

    const amount = await selectAmountMinor(client);
    assert(amount === txAmountMinor, "seeded transaction must be readable");
  });

  it("rejects UPDATE with the trigger message", async () => {
    let error: unknown;
    try {
      await client.execute({
        sql: "UPDATE transactions SET amountMinor = 999 WHERE id = ?",
        args: [txId],
      });
    } catch (e) {
      error = e;
    }
    expectImmutableViolation(error, "raw UPDATE");
  });

  it("rejects DELETE with the trigger message", async () => {
    let error: unknown;
    try {
      await client.execute({
        sql: "DELETE FROM transactions WHERE id = ?",
        args: [txId],
      });
    } catch (e) {
      error = e;
    }
    expectImmutableViolation(error, "raw DELETE");
  });

  it("leaves the row intact after both rejected statements", async () => {
    const amount = await selectAmountMinor(client);
    assert(amount !== undefined, "row must still exist");
    expect(amount).toBe(txAmountMinor);
  });

  it("documents that a non-matching UPDATE/DELETE skips the trigger in this libsql version", async () => {
    // HALLAZGO (T022): un UPDATE/DELETE cuyo WHERE no matchea ninguna fila NO
    // dispara el trigger BEFORE (SQLite/libsql salta el cuerpo del trigger
    // cuando no hay filas que tocar): la sentencia termina OK con
    // rowsAffected = 0 y el RAISE nunca se evalúa. La inmutabilidad por
    // trigger solo protege contra sentencias que matchean filas existentes.
    // Este test fija el comportamiento observado; si una versión futura de
    // libsql empieza a disparar el trigger, fallará y avisará del cambio.
    const update = await client.execute({
      sql: "UPDATE transactions SET amountMinor = 999 WHERE id = ?",
      args: ["id-that-does-not-exist"],
    });
    expect(update.rowsAffected).toBe(0);

    const remove = await client.execute({
      sql: "DELETE FROM transactions WHERE id = ?",
      args: ["id-that-does-not-exist"],
    });
    expect(remove.rowsAffected).toBe(0);

    // La fila seed sigue intacta (los no-match no la tocaron).
    const amount = await selectAmountMinor(client);
    assert(amount !== undefined, "row must still exist");
    expect(amount).toBe(txAmountMinor);
  });
});
