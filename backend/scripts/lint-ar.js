#!/usr/bin/env node
// ═══ W4·G · BAYAN LINT ════════════════════════════════════════════════
// Arabic is written, not translated — and drift is a failing build.
// Reads frontend/src/locales/dict.ts and checks every Arabic value against
// glossary.json: banned transliterations and bureaucratic register, empty
// or untranslated values, English plural hacks, Latin punctuation.
//
// Deliberately checks VOCABULARY, NOT GRAMMAR. Case inflection is correct
// Arabic (العملاء المحتملون / مصدر العملاء المحتملين are both right); a
// linter that fails valid Arabic teaches contributors to disable it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const DICT = join(root, "frontend", "src", "locales", "dict.ts");
const GLOSSARY = join(root, "frontend", "src", "locales", "glossary.json");

const ARABIC = /[\u0600-\u06FF]/;
const LATIN_WORD = /[A-Za-z][A-Za-z.'-]*/g;

// Pull { key, ar, en } triples out of the dictionary source. The dict is a
// literal object of `key: { ar: "…", en: "…" }`, so a scan is sufficient and
// avoids compiling TypeScript in CI.
export function parseDict(src) {
  const out = [];
  const re = /(\w+)\s*:\s*\{\s*ar:\s*"((?:[^"\\]|\\.)*)"\s*,\s*en:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m;
  while ((m = re.exec(src))) out.push({ key: m[1], ar: m[2], en: m[3] });
  return out;
}

export function lint(entries, glossary) {
  const problems = [];
  const allowed = new Set((glossary.structural.allowLatin || []).map((w) => w.toLowerCase()));
  const add = (key, rule, detail) => problems.push({ key, rule, detail });

  for (const { key, ar, en } of entries) {
    if (!ar || !ar.trim()) { add(key, "empty", "Arabic value is empty"); continue; }

    for (const b of glossary.banned) {
      if (ar.includes(b.bad)) add(key, "banned", `«${b.bad}» → «${b.use}» — ${b.why}`);
    }
    for (const p of glossary.structural.bannedPunctuation || []) {
      if (ar.includes(p.bad)) add(key, "punctuation", `«${p.bad.trim()}» — ${p.why}`);
    }
    if (glossary.structural.requireArabicScript && !ARABIC.test(ar)) {
      // Values that are pure brand marks or acronyms are legitimately Latin.
      const words = ar.match(LATIN_WORD) || [];
      const ok = words.length > 0 && words.every((w) => allowed.has(w.toLowerCase()));
      if (!ok) add(key, "untranslated", `no Arabic script: "${ar}"`);
    } else {
      for (const w of ar.match(LATIN_WORD) || []) {
        // Single letters are path fragments (/f/), Admiralty grades (A–F) or
        // version/quarter markers (v2, Q1) — documented in glossary.json.
        if (w.length === 1) continue;
        if (!allowed.has(w.toLowerCase())) {
          add(key, "latin", `Latin word «${w}» inside Arabic — translate it or add it to allowLatin`);
        }
      }
    }
    if (ar === en && ARABIC.test(en) === false && (ar.match(LATIN_WORD) || []).length > 1) {
      add(key, "untranslated", "Arabic is identical to English");
    }
  }
  return problems;
}

function main() {
  const glossary = JSON.parse(readFileSync(GLOSSARY, "utf8"));
  const entries = parseDict(readFileSync(DICT, "utf8"));
  if (!entries.length) { console.error("✗ lint:ar found no dictionary entries — did dict.ts move?"); process.exit(1); }
  const problems = lint(entries, glossary);
  if (problems.length) {
    console.error(`✗ Bayan lint failed — ${problems.length} issue(s) across ${entries.length} entries:\n`);
    const byRule = new Map();
    for (const p of problems) { if (!byRule.has(p.rule)) byRule.set(p.rule, []); byRule.get(p.rule).push(p); }
    for (const [rule, list] of byRule) {
      console.error(`  ${rule.toUpperCase()} (${list.length})`);
      for (const p of list.slice(0, 12)) console.error(`    ${p.key}: ${p.detail}`);
      if (list.length > 12) console.error(`    … and ${list.length - 12} more`);
    }
    console.error("\n  See BAYAN.md for the charter. Terminology is decided in glossary.json.");
    process.exit(1);
  }
  console.log(`✓ Bayan lint passed — ${entries.length} entries, ${glossary.concepts.length} canonical terms`);
}

if (process.argv[1] && process.argv[1].endsWith("lint-ar.js")) main();
