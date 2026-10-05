#!/usr/bin/env node
/**
 * Convierte `coverage/coverage-summary.json` (de `vitest --coverage
 * --coverage.reporter=json-summary`) en una tabla Markdown y la agrega al
 * Job Summary de GitHub Actions (`$GITHUB_STEP_SUMMARY`). Uso solo en CI;
 * localmente el reporter `text`/`html` ya muestra lo mismo.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const summaryPath = "coverage/coverage-summary.json";
const outPath = process.env.GITHUB_STEP_SUMMARY;

if (!existsSync(summaryPath)) {
  // Los tests fallaron antes de generar coverage: no enmascarar el fallo,
  // solo anotarlo en el summary y salir 0 (el job ya falla por los tests).
  const note = "### Cobertura de tests\n\n_No generada: los tests fallaron._\n";
  if (outPath) {
    appendFileSync(outPath, note);
  } else {
    console.log(note);
  }
  process.exit(0);
}

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
