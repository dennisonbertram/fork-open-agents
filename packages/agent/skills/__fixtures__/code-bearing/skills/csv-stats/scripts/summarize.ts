#!/usr/bin/env bun
/**
 * Bundled skill script: compute summary stats for a CSV file.
 *
 * Deliberately written with only node:fs + process so the same file runs under
 * bun, node, or tsx — i.e. it behaves like a real bundled skill script that the
 * agent executes via bash, not like application code. Only its stdout (JSON)
 * flows back into the conversation.
 *
 * Usage: summarize.ts <path-to-csv>
 * Output: {"rows": N, "columns": {"col": {"mean": x, "min": y, "max": z}}}
 */
import { readFileSync } from "node:fs";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  fail("usage: summarize.ts <path-to-csv>");
}

const raw = readFileSync(csvPath, "utf-8").trim();
const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
const headerLine = lines.at(0);
const dataLines = lines.slice(1);
if (headerLine === undefined || dataLines.length === 0) {
  fail("csv must have a header row and at least one data row");
}

const header = headerLine.split(",").map((cell) => cell.trim());
const rows = dataLines.map((line) => line.split(",").map((c) => c.trim()));

const columns: Record<string, { mean: number; min: number; max: number }> = {};

for (let col = 0; col < header.length; col++) {
  const name = header[col];
  if (name === undefined) {
    continue;
  }
  const cells = rows.map((row) => row[col] ?? "").filter((c) => c.length > 0);
  if (cells.length === 0) {
    continue;
  }
  const numbers = cells.map(Number);
  const allNumeric = numbers.every((n) => Number.isFinite(n));
  if (!allNumeric) {
    continue; // non-numeric column — skipped
  }
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  columns[name] = {
    mean: Number((sum / numbers.length).toFixed(2)),
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

process.stdout.write(`${JSON.stringify({ rows: rows.length, columns })}\n`);
