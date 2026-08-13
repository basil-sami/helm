#!/usr/bin/env node
// ═══ SEC·A · SECRET MIGRATION ═════════════════════════════════════════
// Encrypts existing plaintext credentials and hashes existing magic-link
// tokens. Idempotent: re-running is safe, and a partial run resumes.
//
//   node scripts/migrate-secrets.js --dry-run   # report only
//   node scripts/migrate-secrets.js             # apply
//   node scripts/migrate-secrets.js --rotate    # re-encrypt under the newest key
//   node scripts/migrate-secrets.js --audit     # is anything still plaintext?
import "dotenv/config";

const { migrateSecrets, rotateSecrets, plaintextAudit } = await import("../src/secrets.js");
const { cryptoStatus } = await import("../src/crypto.js");

const status = cryptoStatus();
console.log(`crypto: ${status.configured ? `v${status.currentVersion} (${status.algorithm})` : "NOT CONFIGURED"}`);
if (!status.configured) {
  console.error("\n✗ PULSE_SECRET_KEY_V1 is not set.\n" +
    "  Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
    "  Then set it in the instance environment. It must NEVER be committed or stored in the database.");
  process.exit(1);
}

if (process.argv.includes("--audit")) {
  const rows = await plaintextAudit();
  let dirty = 0;
  for (const r of rows) {
    console.log(`  ${r.table}.${r.column}: ${r.total} row(s), ${r.plaintext} unprotected`);
    dirty += r.plaintext;
  }
  console.log(dirty === 0 ? "\n✓ no unprotected secrets at rest" : `\n✗ ${dirty} unprotected value(s) — run without --audit to fix`);
  process.exit(dirty === 0 ? 0 : 1);
}

if (process.argv.includes("--rotate")) {
  const r = await rotateSecrets();
  console.log(`✓ rotated ${r.rotated}, already current ${r.alreadyCurrent}, failed ${r.failed.length}`);
  process.exit(r.failed.length ? 1 : 0);
}

const dryRun = process.argv.includes("--dry-run");
const r = await migrateSecrets({ dryRun });
console.log(`${dryRun ? "[dry run] would encrypt" : "✓ encrypted"} ${r.encrypted}, ` +
            `${dryRun ? "would hash" : "hashed"} ${r.hashed}, skipped ${r.skipped}, failed ${r.failed.length}`);
for (const f of r.failed) console.error(`  ✗ ${f.table}/${f.id}: ${f.error}`);
process.exit(r.failed.length ? 1 : 0);
