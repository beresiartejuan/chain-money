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
      reporter: ["text", "html"],
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
