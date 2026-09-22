import { eq } from "drizzle-orm";
import {
  boxAccess,
  boxTokens,
  type Transaction,
  transactions,
  users,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import type { createBox } from "@/server/boxes/service";

/**
 * Helpers compartidos de los tests de transacciones (T057–T059): seed de
 * user/box/access e inserciones directas para armar estados que el service
 * no permite crear por input (p. ej. transacciones `reset` manuales).
 * Patrón de `create-transaction.test.ts`.
 */

/** Usuario seed con email único, devuelto para usar como owner/guest. */
export async function insertUser(
  db: Parameters<typeof createBox>[0],
): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: `seed-${Date.now()}-${Math.random()}@example.com`,
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

/** Fila de `box_tokens` (FK obligatoria de `box_access`). */
async function insertToken(
  db: Parameters<typeof createBox>[0],
  boxId: string,
  ownerId: string,
  permissions: string,
): Promise<{ id: string }> {
  const id = newId();
  await db.insert(boxTokens).values({
    id,
    boxId,
    tokenHash: `token-hash-${id}`,
    tokenPrefix: id.slice(0, 8),
    permissions,
    status: "redeemed",
    createdBy: ownerId,
  });
  return { id };
}

/** Fila de `box_access` sobre `boxId` para `userId` (via token del owner). */
export async function insertAccess(
  db: Parameters<typeof createBox>[0],
  boxId: string,
  userId: string,
  ownerId: string,
  permissions: string,
): Promise<void> {
  const token = await insertToken(db, boxId, ownerId, permissions);
  await db.insert(boxAccess).values({
    id: newId(),
    boxId,
    userId,
    tokenId: token.id,
    permissions,
  });
}

/**
 * Balance de la alcancía `boxId` calculado en el caller (fuera del
 * service): deposit suma, withdraw resta, reset suma su valor.
 */
export async function sumBalance(
  db: Parameters<typeof createBox>[0],
  boxId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.boxId, boxId));
  return rows.reduce(
    (total, row) =>
      total + (row.type === "withdraw" ? -row.amountMinor : row.amountMinor),
    0,
  );
}

/** Inserta una transacción cruda (seed directo, sin pasar por el service). */
export async function insertRawTransaction(
  db: Parameters<typeof createBox>[0],
  values: {
    boxId: string;
    type: string;
    amountMinor: number;
    counterparty?: string | null;
    note: string;
    createdBy: string;
    /** Forzado para tests de sync (T063): default es server time. */
    createdAt?: number;
    /** Forzado para tests de desempate por id (T063): default es UUIDv7. */
    id?: string;
  },
): Promise<Transaction> {
  const inserted = await db
    .insert(transactions)
    .values({
      id: values.id ?? newId(),
      boxId: values.boxId,
      type: values.type,
      amountMinor: values.amountMinor,
      counterparty: values.counterparty ?? null,
      note: values.note,
      createdBy: values.createdBy,
      createdAt: values.createdAt,
    })
    .returning();
  const transaction = inserted[0];
  if (!transaction) {
    throw new Error("Failed to insert seed transaction");
  }
  return transaction;
}
