import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { boxAccess, boxTokens, transactions } from "@/db/schema";

/**
 * Humo del esquema T017/T018 contra la migración más reciente: verifica
 * que la SQL generada declara las tablas, uniques, FKs e índices pedidos,
 * y que la definición de Drizzle los expone. Las verificaciones contra
 * DB real viven en T021/T022.
 */
const migrationSqlByTag = (() => {
  const outDir = resolve(process.cwd(), "drizzle");
  const tags = readdirSync(outDir).filter((entry) => !entry.startsWith("."));
  return new Map(
    tags
      .sort()
      .map((tag) => [
        tag,
        readFileSync(`${outDir}/${tag}/migration.sql`, "utf8"),
      ]),
  );
})();

/** SQL de la migración más reciente que crea tablas (la última con DDL). */
const latestMigrationSql = (() => {
  for (const sql of [...migrationSqlByTag.values()].reverse()) {
    if (sql.includes("CREATE TABLE")) return sql;
  }
  throw new Error("No migration in drizzle/ creates tables");
})();

/** FKs indexadas por primera columna local de la definición de Drizzle. */
function fksByColumn(config: ReturnType<typeof getTableConfig>) {
  return Object.fromEntries(
    config.foreignKeys.map((fk) => {
      const reference = fk.reference();
      return [reference.columns[0].name, fk] as const;
    }),
  );
}

describe("schema: box_tokens", () => {
  const config = getTableConfig(boxTokens);

  it("declares tokenHash unique", () => {
    const column = config.columns.find((c) => c.name === "tokenHash");
    expect(column?.isUnique).toBe(true);
  });

  it("declares the boxId index", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "box_tokens_box_id_idx",
    );
    expect(
      index?.config.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["boxId"]);
    expect(index?.config.unique).toBe(false);
  });

  it("cascades box delete, keeps user references without cascade", () => {
    const fks = fksByColumn(config);
    expect(getTableName(fks.boxId?.reference().foreignTable)).toBe(
      "savings_boxes",
    );
    expect(fks.boxId?.onDelete).toBe("cascade");
    expect(getTableName(fks.createdBy?.reference().foreignTable)).toBe("users");
    expect(fks.createdBy?.onDelete).toBeUndefined();
    expect(getTableName(fks.redeemedBy?.reference().foreignTable)).toBe(
      "users",
    );
    expect(fks.redeemedBy?.onDelete).toBeUndefined();
  });

  it("is present in the generated migration", () => {
    expect(latestMigrationSql).toContain("CREATE TABLE `box_tokens`");
    expect(latestMigrationSql).toContain("`tokenHash` text NOT NULL UNIQUE");
    expect(latestMigrationSql).toContain(
      "CREATE INDEX `box_tokens_box_id_idx` ON `box_tokens` (`boxId`)",
    );
  });
});

describe("schema: box_access", () => {
  const config = getTableConfig(boxAccess);

  it("declares the composite unique (boxId, userId)", () => {
    const unique = config.uniqueConstraints.find(
      (u) => u.name === "box_access_box_user_unique",
    );
    expect(unique?.columns.map((c) => c.name)).toEqual(["boxId", "userId"]);
  });

  it("cascades box and user deletes, keeps tokenId plain", () => {
    const fks = fksByColumn(config);
    expect(fks.boxId?.onDelete).toBe("cascade");
    expect(fks.userId?.onDelete).toBe("cascade");
    expect(getTableName(fks.tokenId?.reference().foreignTable)).toBe(
      "box_tokens",
    );
    expect(fks.tokenId?.onDelete).toBeUndefined();
  });

  it("is present in the generated migration", () => {
    expect(latestMigrationSql).toContain("CREATE TABLE `box_access`");
    expect(latestMigrationSql).toContain(
      "CONSTRAINT `box_access_box_user_unique` UNIQUE(`boxId`,`userId`)",
    );
  });
});

describe("schema: transactions", () => {
  const config = getTableConfig(transactions);

  it("declares the composite (boxId, createdAt, id) index", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "transactions_box_created_at_id_idx",
    );
    expect(
      index?.config.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["boxId", "createdAt", "id"]);
    expect(index?.config.unique).toBe(false);
  });

  it("has no onDelete on boxId (restrict-like FK)", () => {
    const fks = fksByColumn(config);
    expect(getTableName(fks.boxId?.reference().foreignTable)).toBe(
      "savings_boxes",
    );
    expect(fks.boxId?.onDelete).toBeUndefined();
    expect(getTableName(fks.createdBy?.reference().foreignTable)).toBe("users");
  });

  it("has no updatedAt column", () => {
    expect(config.columns.some((c) => c.name === "updatedAt")).toBe(false);
  });

  it("is present in the generated migration without cascade", () => {
    expect(latestMigrationSql).toContain("CREATE TABLE `transactions`");
    expect(latestMigrationSql).toContain(
      "CONSTRAINT `fk_transactions_boxId_savings_boxes_id_fk` FOREIGN KEY (`boxId`) REFERENCES `savings_boxes`(`id`),",
    );
    expect(latestMigrationSql).toContain(
      "CREATE INDEX `transactions_box_created_at_id_idx` ON `transactions` (`boxId`,`createdAt`,`id`)",
    );
  });
});
