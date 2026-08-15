#!/usr/bin/env node
// ═══ UI·COVER · BACKEND ↔ UI COVERAGE GATE ═══════════════════════════
// The recurring defect class of this codebase is the orphan rail: a
// backend capability shipped with tests and no UI consumer (the war
// room, the links QR, campaignsEnding, engagements.campaignIds). This
// gate makes the class a failing build: every /api mount must either be
// referenced by the frontend or carry a NAMED reason in the allowlist.
//
// Honest limitation, stated: the check is MOUNT-level. A subroute
// orphan under a consumed mount (the /room case) still needs the
// persona audit's eye — this gate catches whole rails, not rooms.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const app = readFileSync(join(root, "backend/src/app.js"), "utf8");
const mounts = [...new Set([...app.matchAll(/app\.use\("(\/api\/[a-z0-9/-]+)"/g)].map((m) => m[1]))];

// Legitimately UI-less rails — each with its reason, auditable here.
// Real UI gaps, dated and tracked in PULSE-MASTERPLAN.md § UI-Debt
// Register — printed on EVERY run so they cannot hide, passing so the
// build stays honest about what it is: debt, not absence.
const DEBT = {
  "/api/privacy": "DEBT(2026-08-15): retention-registry admin card",
};

const ALLOW = {
  "/api/portal": "guest magic-link surface — consumed by the vendor's browser at /p/<token>, not by the operator UI",
  "/api/cron": "scheduler-invoked (Vercel cron with CRON_SECRET); no human client",
  "/api/hooks": "inbound webhooks from external platforms; no human client",
  "/api/webhooks": "inbound webhooks from external platforms; no human client",
  "/api/track": "pulse.js beacon endpoint — consumed by client sites, not the operator UI",
  "/api/qr": "public QR redirect/scan surface — consumed by phone cameras",
  "/api/privacy": "public subject-confirmation leg of erasure — consumed by the data subject's emailed link, not the operator UI",
  "/api/public/collect": "pulse.js beacon — consumed by client websites' analytics snippet, not the operator UI",
};

// Collect every frontend source once.
const FE = join(root, "frontend/src");
let corpus = "";
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) corpus += readFileSync(p, "utf8");
  }
})(FE);

const rows = mounts.map((m) => {
  const token = m.replace(/^\/api/, "");
  const used = corpus.includes(`"${token}`) || corpus.includes("`" + token)
    || corpus.includes(`"/api${token}`) || corpus.includes("`/api" + token) || corpus.includes(token + "/");
  const allowed = Object.keys(ALLOW).find((a) => m === a || m.startsWith(a + "/"));
  return { mount: m, used, allowed };
});

const debtOf = (m) => Object.keys(DEBT).find((d) => m === d || m.startsWith(d + "/"));
const orphans = rows.filter((r) => !r.used && !r.allowed && !debtOf(r.mount));
const allowedRows = rows.filter((r) => !r.used && r.allowed);
const debtRows = rows.filter((r) => !r.used && !r.allowed && debtOf(r.mount));

console.log(`UI coverage — ${mounts.length} mounts: ${rows.filter((r) => r.used).length} consumed, ${allowedRows.length} allowlisted, ${debtRows.length} in debt, ${orphans.length} orphaned`);
for (const r of debtRows) console.warn(`  ⚠ ${r.mount}  ${DEBT[debtOf(r.mount)]}`);
for (const r of allowedRows) console.log(`  ~ ${r.mount}  (${ALLOW[r.allowed]})`);
if (orphans.length) {
  console.error(`\n✗ orphan rails — backend capabilities with no UI consumer and no named reason:`);
  for (const r of orphans) console.error(`  - ${r.mount}`);
  console.error(`\nWire a consumer or add a reasoned allowlist entry in backend/scripts/coverage-ui.js.`);
  process.exit(1);
}
console.log("✓ every rail has a consumer or a named reason");
