import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll } from "vitest";

/**
 * DB de test para T021/T022: crea un archivo SQLite temporal único, aplica
 * las migraciones de `drizzle/` con el migrator de Drizzle (incluye el SQL
 * custom de triggers) y expone cliente libSQL + Drizzle. El directorio se
 * borra en `afterAll` (llamar dentro de `describe`, en el nivel superior).
 *
 * Cada llamada produce su propia DB => aislamiento entre tests.
 */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "chain-money-test-"));
  const url = `file:${join(dir, "test.db")}`;

  const client: Client = createClient({ url });
  const db = drizzle({ connection: { url } });

  let migrated = false;
  async function migrateOnce(): Promise<void> {
    if (migrated) return;
    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    migrated = true;
  }

  afterAll(async () => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return { client, db, migrateOnce, url };
}
