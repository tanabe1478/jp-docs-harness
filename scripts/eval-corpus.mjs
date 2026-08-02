import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { compareReviewResults } from "../lib/eval/compare-review-results.mjs";

const corpusRoot = path.resolve(process.argv[2] ?? "eval/cases");
const entries = await readdir(corpusRoot, { withFileTypes: true });
const cases = [];

for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const goldPath = path.join(corpusRoot, entry.name, "gold.json");
  const gold = JSON.parse(await readFile(goldPath, "utf8"));
  const comparison = compareReviewResults(gold, gold);
  cases.push({ id: entry.name, dimensions: comparison.dimensions });
}

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, cases }, null, 2)}\n`);
