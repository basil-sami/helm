#!/usr/bin/env node
// ═══ NAV·CHECK · THE MENU RECONCILIATION GATE ═════════════════════════
// The sidebar is a contract with three other artifacts: the router, the
// dictionary, and the module vocabulary. This gate holds all four to
// each other: every route has a menu door (or a named reason), every
// menu door has a route, every label exists in both languages, every
// flag is a real module the System page can actually switch, every icon
// has a drawing, no path appears twice, and the seven groups stand in
// their canonical order. Disorder is a failing build, not a taste note.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MODULE_KEYS } from "../src/flags.js";
import { PERM_MODULES } from "../src/auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const app = readFileSync(join(root, "frontend/src/App.tsx"), "utf8");
const layout = readFileSync(join(root, "frontend/src/components/Layout.tsx"), "utf8");
const dict = readFileSync(join(root, "frontend/src/locales/dict.ts"), "utf8");

// Routes that legitimately live outside the menu, each with its reason.
const ROUTE_ALLOW = {
  "/": "the dashboard — first item of the first group, matched exactly",
  "/imports": "alias of the Operations page (/operations) — same menu door, second route",
};

const CANON = ["navg_day", "navg_plan", "navg_create", "navg_capture", "navg_insight", "navg_partners", "navg_admin"];

const problems = [];

// ── parse the three artifacts ──
const routes = [...app.matchAll(/path="(\/[a-z-]*)"/g)].map((m) => m[1]);
const items = [...layout.matchAll(/\{ to: "(\/[a-z-]*)", key: "(nav_\w+)", icon: "([\w-]+)"(?:, mod: "(\w+)")?(?:, flag: "(\w+)")?/g)]
  .map((m) => ({ to: m[1], key: m[2], icon: m[3], mod: m[4], flag: m[5] }));
const groupKeys = [...layout.matchAll(/key: "(navg_\w+)"/g)].map((m) => m[1]);
const iconCases = new Set([...layout.matchAll(/case "([\w-]+)":/g)].map((m) => m[1]));
const dictKeys = new Set([...dict.matchAll(/^\s{2}(\w+): \{ ar:/gm)].map((m) => m[1]));

// ── 1 · every route has a menu door or a reason ──
const navPaths = new Set(items.map((i) => i.to));
for (const r of [...new Set(routes)]) {
  if (!navPaths.has(r) && !ROUTE_ALLOW[r]) problems.push(`route without a menu door: ${r}`);
}
// ── 2 · every menu door leads somewhere ──
const routeSet = new Set(routes);
for (const i of items) if (!routeSet.has(i.to)) problems.push(`menu door without a route: ${i.to}`);
// ── 3 · no path hangs twice ──
const seen = new Set();
for (const i of items) { if (seen.has(i.to)) problems.push(`duplicate menu path: ${i.to}`); seen.add(i.to); }
// ── 4 · every label speaks both languages ──
for (const i of items) if (!dictKeys.has(i.key)) problems.push(`nav label missing from the dictionary: ${i.key}`);
for (const g of [...new Set(groupKeys)]) if (!dictKeys.has(g)) problems.push(`group label missing from the dictionary: ${g}`);
// ── 5 · every flag and mod is real vocabulary ──
// Permission modules imported from auth.js itself — the checker holds
// the menu to the platform's vocabulary, never to a hand-copied list.
const legalMods = new Set([...MODULE_KEYS, ...PERM_MODULES, "__listening", "__operations", "__governance"]);
for (const i of items) {
  if (i.flag && !MODULE_KEYS.includes(i.flag)) problems.push(`flag is not a module anyone can switch: ${i.to} → "${i.flag}"`);
  if (i.mod && !legalMods.has(i.mod)) problems.push(`mod is not a known permission module: ${i.to} → "${i.mod}"`);
}
// ── 6 · every icon has a drawing ──
for (const i of items) if (!iconCases.has(i.icon)) problems.push(`icon with no drawing: ${i.to} → "${i.icon}"`);
// ── 7 · the groups stand in canonical order ──
const orderSeen = [...new Set(groupKeys)];
if (JSON.stringify(orderSeen) !== JSON.stringify(CANON)) {
  problems.push(`group order drifted: [${orderSeen.join(", ")}] — canon is [${CANON.join(", ")}]`);
}

console.log(`nav — ${routes.length} routes · ${items.length} menu items · ${orderSeen.length} groups · ${iconCases.size} icons`);
if (problems.length) {
  console.error(`\n✗ the menu contract is broken:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("✓ routes, menu, dictionary, flags, and icons all agree — groups in canonical order");
