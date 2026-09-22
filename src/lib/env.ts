import { z } from "zod";

const envSchema = z.object({
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
});

type EnvSource = z.infer<typeof envSchema>;

export interface Env {
  readonly tursoDatabaseUrl: string;
  readonly tursoAuthToken: string | undefined;
  readonly encryptionKey: string | undefined;
}

function formatEnvIssues(error: z.ZodError<EnvSource>): string {
  return error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

function resolveNodeEnv(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const nodeEnv = source.NODE_ENV;
  return nodeEnv === undefined || nodeEnv === "" ? "development" : nodeEnv;
}

function normalizeOptional(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Valida un diccionario de variables de entorno y devuelve `Env`.
 *
 * Función pura: no lee `process.env` directamente, así se puede testear con
 * objetos literales. El export `env` la ejecuta sobre `process.env` al
 * importar el módulo.
 */
export function parseEnv(
  source: Readonly<Record<string, string | undefined>>,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${formatEnvIssues(parsed.error)}`,
    );
  }

  const encryptionKey = parsed.data.ENCRYPTION_KEY;
  if (
    resolveNodeEnv(source) === "production" &&
    normalizeOptional(encryptionKey) === undefined
  ) {
    throw new Error("ENCRYPTION_KEY is required when NODE_ENV is production");
  }

  return Object.freeze({
    tursoDatabaseUrl: parsed.data.TURSO_DATABASE_URL,
    tursoAuthToken: normalizeOptional(parsed.data.TURSO_AUTH_TOKEN),
    encryptionKey: normalizeOptional(encryptionKey),
  } satisfies Env);
}

export const env: Env = parseEnv(process.env);
