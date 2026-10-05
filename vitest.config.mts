import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const config = defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "drizzle/**",
      "coverage/**",
    ],
    coverage: {
      provider: "v8",
      // `html` para inspección local; `json-summary` alimenta el resumen de
      // coverage en el Job Summary de CI (scripts/coverage-summary.mjs).
      reporter: ["text", "html", "json-summary"],
      // Only application logic is measured; UI and generated/db code stay out.
      // src/server does not exist yet, but the glob is harmless until it does.
      include: ["src/lib/**", "src/server/**"],
      exclude: [
        "drizzle/**",
        "node_modules/**",
        ".next/**",
        "**/*.config.*",
        "src/db/__tests__/**",
        // Wrappers delgados de Next Server Actions ("use server"): solo
        // resuelven sesión y mapean AppError → { ok, error: { code } }.
        // La lógica que envuelven vive en los services (≥89% cubiertos).
        // Probados end-to-end vía verificación manual de la UI (no E2E,
        // decisión del owner).
        "src/server/**/__tests__/**",
        "src/server/**/actions.ts",
        "src/server/auth/recovery-actions.ts",
        // Glue de cookies de sesión (`next/headers`): `cookies()` lanza
        // fuera del scope de un request, así que no ejecuta en Vitest
        // (verificado). Cada función es ≤ 10 líneas que solo leen/setean la
        // cookie y delegan en `resolveSessionUser`/`createSessionRow`
        // (≥ 93% cubiertos).
        "src/server/auth/session.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});

export default config;
