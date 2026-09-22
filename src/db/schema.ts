import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Timestamps en unix ms (epoch millis), asignados por la app.
 */
const timestamps = {
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
};

/**
 * Timestamp para tablas inmutables: solo `createdAt`, sin `updatedAt`.
 */
const createdAtOnly = {
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
};

/**
 * Usuarios de la app. `id` es un UUIDv7 generado por la app
 * (ver `src/lib/ids.ts`); no hay default en la base de datos.
 */
export const users = sqliteTable("users", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  name: text().notNull(),
  recoveryPhraseEncrypted: text(),
  recoveryPhraseHash: text(),
  ...timestamps,
});

/**
 * Sesiones de usuario. `id` es el hash SHA-256 del token de sesión,
 * generado por la app (nunca se persiste el token en claro).
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer().notNull(),
    createdAt: integer().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * Alcancías de ahorro. Sin constraint de límite de 5 por usuario:
 * ese límite es lógica de acción, no de base de datos.
 */
export const savingsBoxes = sqliteTable(
  "savings_boxes",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    currency: text().notNull(),
    ...timestamps,
  },
  (table) => [index("savings_boxes_owner_id_idx").on(table.ownerId)],
);

/**
 * Tipos de permiso que puede otorgar un token de acceso compartido.
 */
export type Permission =
  | "view:transactions"
  | "create:transactions"
  | "reset:box";

/**
 * Estados de un token de acceso: activo (canjeable), expirado o canjeado.
 */
export type BoxTokenStatus = "active" | "expired" | "redeemed";

/**
 * Tokens de un solo uso para compartir una alcancía. Solo se persiste el
 * hash SHA-256 del token (nunca el token en claro); `tokenPrefix` queda
 * para identificar el token en UI/logs. `permissions` es un JSON string[]
 * (ej. `'["view:transactions"]'`).
 */
export const boxTokens = sqliteTable(
  "box_tokens",
  {
    id: text().primaryKey(),
    boxId: text()
      .notNull()
      .references(() => savingsBoxes.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    tokenPrefix: text().notNull(),
    permissions: text().notNull(),
    status: text().notNull(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    ...createdAtOnly,
    redeemedAt: integer(),
    redeemedBy: text().references(() => users.id),
  },
  (table) => [index("box_tokens_box_id_idx").on(table.boxId)],
);

/**
 * Acceso otorgado a un usuario sobre una alcancía tras canjear un token.
 * Un usuario tiene como máximo un acceso por alcancía
 * (`box_access_box_user_unique`); un nuevo canje actualiza permisos en
 * lugar de crear otra fila. `permissions` es un JSON string[].
 */
export const boxAccess = sqliteTable(
  "box_access",
  {
    id: text().primaryKey(),
    boxId: text()
      .notNull()
      .references(() => savingsBoxes.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: text()
      .notNull()
      .references(() => boxTokens.id),
    permissions: text().notNull(),
    ...createdAtOnly,
  },
  (table) => [
    unique("box_access_box_user_unique").on(table.boxId, table.userId),
  ],
);

/**
 * Transacciones de una alcancía: historial inmutable y completo. Sin
 * `updatedAt`/`deletedAt` (no aplican) y sin `ON DELETE CASCADE` en
 * `boxId`: borrar una alcancía no borra su historial (FK restrictiva).
 * `amountMinor` es el monto entero en unidades menores de la moneda;
 * en `reset` vale 0. `counterparty` es opcional y `note` es texto plano.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: text().primaryKey(),
    boxId: text()
      .notNull()
      .references(() => savingsBoxes.id),
    type: text().notNull(),
    amountMinor: integer().notNull(),
    counterparty: text(),
    note: text().notNull(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    ...createdAtOnly,
  },
  (table) => [
    index("transactions_box_created_at_id_idx").on(
      table.boxId,
      table.createdAt,
      table.id,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SavingsBox = typeof savingsBoxes.$inferSelect;
export type NewSavingsBox = typeof savingsBoxes.$inferInsert;
export type BoxToken = typeof boxTokens.$inferSelect;
export type NewBoxToken = typeof boxTokens.$inferInsert;
export type BoxAccess = typeof boxAccess.$inferSelect;
export type NewAccess = typeof boxAccess.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionType = "deposit" | "withdraw" | "reset";
