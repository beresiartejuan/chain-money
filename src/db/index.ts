import "server-only";
import "dotenv/config";
import { drizzle } from "drizzle-orm/libsql";

const databaseUrl = process.env.TURSO_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing TURSO_DATABASE_URL environment variable");
}

export const db = drizzle({
  connection: {
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
