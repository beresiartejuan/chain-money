#!/usr/bin/env node
/**
 * Convierte `coverage/coverage-summary.json` (de `vitest --coverage
 * --coverage.reporter=json-summary`) en una tabla Markdown y la agrega al
 * Job Summary de GitHub Actions (`$GITHUB_STEP_SUMMARY`). Uso solo en CI;
 * localmente el reporter `text`/`html` ya muestra lo mismo.
 */
import { appendFileSync, readFileSync } from "node:fs";

const summaryPath = "coverage/coverage-summary.json";
const outPath = process.env.GITHUB_STEP_SUMMARY;

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const total = summary.total;
if (!total) {
  throw new Error(`${summaryPath} no tiene la clave "total"`);
}

const pct = (value) => `${value.toFixed(2)}%`;
const table = [
  "| Métrica | Total | Umbral |",
  "| --- | --- | --- |",
  `| Líneas | ${pct(total.lines.pct)} | 80% |`,
  `| Ramas | ${pct(total.branches.pct)} | 70% |`,
  `| Funciones | ${pct(total.functions.pct)} | 80% |`,
  `| Sentencias | ${pct(total.statements.pct)} | — |`,
].join("\n");

if (!outPath) {
  // Fuera de CI: imprime la tabla (útil para chequear el script a mano).
  console.log(table);
} else {
  appendFileSync(outPath, `### Cobertura de tests\n${table}\n`);
}
