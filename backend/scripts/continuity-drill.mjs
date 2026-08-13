#!/usr/bin/env node
// ═══ SEC·E · THE CONTINUITY DRILL ════════════════════════════════════
// Proof, as a command, that whoever runs it can operate and RECOVER
// Pulse: boot a fresh embedded instance, create the first admin through
// the real installer, write data, take a real backup, destroy the data,
// restore it through the real restore path, and verify the governance
// chain end to end. No network, no secrets, no production. A restore
// you have never run is not a backup — this makes running it free.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const step = (name) => console.log(`  → ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const fail = (msg) => { console.error(`\n✗ DRILL FAILED — ${msg}`); process.exit(1); };

process.env.PULSE_SECRET_KEY_V1 ||= randomBytes(32).toString("base64");

console.log("Pulse continuity drill — a stranger's machine proves it can recover the platform.\n");

const db = new PGlite();
const sql = fs.readFileSync(path.join(HERE, "../../supabase/setup.sql"), "utf8")
  .replace(/create extension if not exists pgcrypto;/g, "");
await db.exec(sql);
globalThis.__PULSE_DB_CLIENT__ = db;
step("schema + seed applied to an embedded Postgres");

const { createApp } = await import("../src/app.js");
const srv = createApp().listen(4181);
await new Promise((r) => setTimeout(r, 200));
const B = "http://127.0.0.1:4181/api";
const j = async (method, p, body, token) => {
  const r = await fetch(B + p, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, data };
};

const st = await j("GET", "/setup/status");
if (st.status !== 200 || st.data?.needsSetup !== true) fail(`fresh instance should ask for setup, got ${st.status} ${JSON.stringify(st.data)}`);
step("app boots; the honest installer reports needsSetup");

// The real installer creates the first admin (seed ships zero users).
const email = "drill@continuity.local", password = "Drill@2026x";
let token;
const su = await j("POST", "/setup", { name: "Continuity Drill", email, password, orgName: "Drill Org" });
if (su.status !== 201 && su.status !== 200) fail(`installer refused: ${su.status} ${JSON.stringify(su.data)}`);
token = su.data?.token || (await j("POST", "/auth/login", { email, password })).data?.token;
if (!token) fail("no admin token after setup + login");
step("first admin created through the real installer, signed in");

const lead = await j("POST", "/leads", { company: "Recoverable Ltd", source: "REFERRAL", stage: "NEW" }, token);
if (lead.status !== 201) fail(`could not create probe data: ${lead.status}`);
step("probe data written");

const backupRes = await fetch(`${B}/export/backup`, { headers: { authorization: `Bearer ${token}` } });
if (backupRes.status !== 200) fail(`backup returned ${backupRes.status}`);
const backup = await backupRes.json();
const inDump = (backup.tables?.leads || []).some((l) => l.company === "Recoverable Ltd");
if (!inDump) fail("the backup does not contain the probe row");
step(`backup taken — ${Object.keys(backup.tables || {}).length} tables in the dump`);

const del = await j("DELETE", `/leads/${lead.data.id}`, null, token);
if (del.status >= 400) fail(`could not destroy probe data: ${del.status}`);
const gone = await j("GET", `/leads/${lead.data.id}`, null, token);
if (gone.status !== 404) fail("probe row still present after deletion");
step("data destroyed — the disaster");

const restore = await j("POST", "/export/restore", backup, token);
if (restore.status !== 200 || !restore.data?.ok) fail(`restore failed: ${JSON.stringify(restore.data)}`);
const back = await j("GET", "/leads", null, token);
if (!(back.data || []).some((l) => l.company === "Recoverable Ltd")) fail("restored instance is missing the probe row");
step(`restore complete — ${Object.values(restore.data.restored).reduce((a, b) => a + b, 0)} rows reinserted in FK-safe order`);

const chain = await j("GET", "/security/audit-verify", null, token);
if (!chain.data?.ok) fail(`governance chain broken after restore (firstBreakSeq=${chain.data?.firstBreakSeq})`);
step(`governance chain verified end to end — ${chain.data.checked} entries, ${chain.data.legacyRows} pre-chain`);

srv.close();
console.log(`\n✓ DRILL PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s — this machine can install, operate, back up, and RECOVER Pulse.`);
process.exit(0);
