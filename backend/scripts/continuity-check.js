#!/usr/bin/env node
// ═══ SEC·E · CONTINUITY CHECK ════════════════════════════════════════
// The runbook is only worth anything if it cannot quietly fall behind
// the repo. This gate fails CI unless CONTINUITY.md references, by
// literal name, every npm script and every root document — so a new
// operational command or a new brief cannot ship undocumented for a
// successor. Generated evidence packs (SOC2-EVIDENCE-*.md) are dated
// artifacts and are exempt.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const doc = readFileSync(join(root, "CONTINUITY.md"), "utf8");

const misses = [];

const scripts = Object.keys(JSON.parse(readFileSync(join(root, "backend/package.json"), "utf8")).scripts || {});
for (const s of scripts) if (!doc.includes(s)) misses.push(`script "${s}" (backend/package.json) is not in CONTINUITY.md`);

const docs = readdirSync(root).filter((f) => f.endsWith(".md") && !/^SOC2-EVIDENCE-/.test(f));
for (const f of docs) if (!doc.includes(f)) misses.push(`document "${f}" is not in CONTINUITY.md`);

if (!existsSync(join(root, "backend/scripts/continuity-drill.mjs"))) misses.push("the drill script is missing");
if (!/@electric-sql\/pglite/.test(readFileSync(join(root, "backend/package.json"), "utf8")))
  misses.push("the test harness dependency (@electric-sql/pglite) is not declared — a successor's `npm ci && npm test` would fail");

if (misses.length) {
  console.error(`✗ continuity check failed (${misses.length}):`);
  for (const m of misses) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`✓ continuity current — ${scripts.length} scripts and ${docs.length} documents all referenced; harness dependency declared`);
