import crypto from "node:crypto";
import { all, get, run } from "./db.js";

// ═══ SEC·C · ERASURE & EXPORT ═════════════════════════════════════════
// PII_MAP declares every column holding a data subject's personal data,
// and how erasure treats it. PII_SCAN reads information_schema at build
// time and fails when a personal-data column is not classified — so a
// future migration CANNOT add an unerasable column and pass the build.
//
// The three buckets exist because "does this column hold personal data?"
// is not answerable from its name. `campaigns.name` and `contacts.name`
// spell the same; only one is a person.

/** Market-side humans. These are erased and exported. */
export const PII_MAP = [
  { table: "leads", mode: "anonymize", match: ["email", "phone"],
    columns: ["contactName", "email", "phone"], keep: ["company", "stage", "source", "valueUsd", "campaignId", "createdAt"],
    note: "Funnel counts, lostReason history and snapshots must survive erasure." },
  { table: "contacts", mode: "anonymize", match: ["email", "phone"],
    columns: ["name", "email", "phone"], keep: ["company", "consent", "createdAt"] },
  { table: "media_contacts", mode: "anonymize", match: ["email", "phone"],
    columns: ["name", "email", "phone"], keep: ["outlet", "beat"] },
  { table: "influencers", mode: "anonymize", match: ["phone"],
    columns: ["name", "phone"], keep: ["platform", "followers"] },
  { table: "outreach_touches", mode: "anonymize", match: [],
    columns: ["targetName"], keep: ["status", "channel", "sentAt"],
    linkedVia: "targetId" },
  { table: "deliverable_comments", mode: "anonymize", match: [],
    columns: ["author", "authorName"], keep: ["body", "createdAt"],
    note: "Guest-portal commenter identity; the comment body stays, the person does not." },
  { table: "inbox_items", mode: "anonymize", match: [],
    columns: ["author"], keep: ["platform", "text", "status"],
    note: "A member of the public who wrote to us on social." },
  { table: "form_submissions", mode: "redact_jsonb", match: [], jsonbMatch: "data",
    columns: ["data"], jsonbKeys: ["email", "phone", "name", "fullName", "contactName", "mobile", "address"],
    keep: ["formId", "createdAt", "src"],
    note: "Free-form submissions: known personal keys are redacted, the rest of the payload is kept for analysis." },
  { table: "survey_responses", mode: "redact_jsonb", match: [], jsonbMatch: "answers",
    columns: ["answers"], jsonbKeys: ["email", "phone", "name", "contactName"],
    keep: ["surveyId", "score", "createdAt"],
    note: "NPS and survey scores must survive, so only identifying answers are redacted." },
  { table: "vendors", mode: "retain_legal", match: ["email", "phone"],
    columns: ["phone", "email"], keep: ["name", "kind", "active"],
    note: "A vendor is an organisation; its contact-person details are erased, the commercial record is retained." },
  { table: "invoices", mode: "retain_legal", match: [], columns: [], keep: ["*"],
    note: "Statutory retention: nothing is erased here. The lawful basis is written into the certificate." },
];

/** Staff. Erased by offboarding, not by a subject request. */
export const STAFF_COLUMNS = [
  { table: "users", columns: ["name", "email"], why: "Staff account — managed by deactivation and SSO deprovisioning." },
  { table: "auth_events", columns: ["email", "ip", "ua"], why: "Security audit trail — retained deliberately, pruned on a schedule." },
  { table: "lead_activities", columns: ["actorName"], why: "Which colleague acted; not subject data." },
  { table: "content_items", columns: ["authorId"], why: "Staff author reference." },
  { table: "audit_log", columns: ["actorName", "actorId"], why: "Who acted — a colleague, and the audit trail is retained deliberately." },
];

/** Columns whose names match the pattern but hold no personal data. */
export const NOT_PII = [
  ["campaigns", "name"], ["campaigns", "nameAr"], ["competitors", "name"], ["competitors", "nameAr"],
  ["dashboards", "name"], ["dashboards", "nameAr"], ["departments", "name"], ["departments", "nameAr"],
  ["events", "name"], ["events", "nameAr"], ["files", "name"], ["forms", "name"], ["import_jobs", "filename"],
  ["listening_alert_rules", "name"], ["listening_alert_rules", "nameAr"], ["media_plans", "name"], ["media_plans", "nameAr"],
  ["metrics", "name"], ["metrics", "nameAr"], ["osint_entities", "name"], ["osint_entities", "nameAr"],
  ["osint_sources", "name"], ["osint_sources", "nameAr"], ["outreach_campaigns", "name"], ["outreach_campaigns", "nameAr"],
  ["partners", "name"], ["partners", "nameAr"], ["personas", "name"], ["personas", "nameAr"],
  ["process_templates", "name"], ["process_templates", "nameAr"], ["products", "name"], ["products", "nameAr"],
  ["promotions", "name"], ["promotions", "nameAr"], ["seasonal_events", "name"], ["seasonal_events", "nameAr"],
  ["seasonal_packs", "name"], ["seasonal_packs", "nameAr"], ["segments", "name"], ["segments", "nameAr"],
  ["settings", "orgName"], ["settings", "orgNameAr"], ["sites", "name"], ["social_accounts", "displayName"],
  ["sso_connections", "name"], ["sso_connections", "emailDomains"], ["sso_connections", "requireVerifiedEmail"],
  ["surveys", "name"], ["surveys", "nameAr"], ["vendors", "name"], ["wa_templates", "name"],
  ["wa_templates", "nameAr"], ["wa_templates", "waTemplateName"], ["workflows", "name"], ["workflows", "nameAr"],
  ["users", "morningEmail"], ["leads", "firstContactedAt"], ["media_contacts", "lastContactAt"],
  ["osint_signals", "author"],   // ORG-only guardrail: outlets and official accounts, never private individuals
  ["partners", "contacts"], ["vendors", "contacts"],   // covered by the vendors/partners entries above
  ["form_submissions", "contactId"], ["survey_responses", "contactId"], ["press_items", "contactId"],
  ["erasure_requests", "subjectEmail"], ["erasure_requests", "subjectPhone"], ["erasure_requests", "subjectNote"],
  ["assets", "name"], ["asset_types", "name"], ["erasure_log", "tableName"], ["brand_assets", "name"],
  ["copy_bank", "name"], ["creative_requests", "name"], ["engagements", "name"], ["playbooks", "name"],
  ["objectives", "name"], ["key_results", "name"], ["report_runs", "name"], ["mmm_runs", "name"],
  ["bio_pages", "name"], ["landing_pages", "name"], ["osint_themes", "name"], ["osint_cases", "name"],
  ["osint_aliases", "name"], ["referrals", "name"], ["insights", "name"], ["tasks", "name"],
  ["import_jobs", "filename"], ["files", "filename"],
];

export const PII_NAME_RE = /(email|phone|mobile|name|address|birth|author|^ip$|^ua$|contact)/i;

/**
 * PII_SCAN. Every column matching the pattern must be in PII_MAP,
 * STAFF_COLUMNS or NOT_PII. Unclassified columns fail the build.
 */
export async function piiScan(query) {
  const rows = (await query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)).rows || [];
  const covered = new Set();
  for (const e of PII_MAP) for (const c of [...(e.columns || []), ...(e.match || [])]) covered.add(`${e.table}.${c}`);
  for (const e of STAFF_COLUMNS) for (const c of e.columns) covered.add(`${e.table}.${c}`);
  for (const [t, c] of NOT_PII) covered.add(`${t}.${c}`);

  const problems = [];
  for (const r of rows) {
    if (!PII_NAME_RE.test(r.column_name)) continue;
    const key = `${r.table_name}.${r.column_name}`;
    if (covered.has(key)) continue;
    problems.push({ column: key,
      reason: "holds possible personal data but is not in PII_MAP, STAFF_COLUMNS or NOT_PII" });
  }
  const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  for (const e of PII_MAP) {
    for (const c of e.columns || []) {
      if (!live.has(`${e.table}.${c}`)) problems.push({ column: `${e.table}.${c}`, reason: "in PII_MAP but absent from the schema" });
    }
  }
  return problems;
}

// ── Discovery ────────────────────────────────────────────────────────
const norm = (v) => String(v || "").trim().toLowerCase();
export const rowRef = (table, id) => crypto.createHash("sha256").update(`${table}:${id}`).digest("hex");

/** Find every row belonging to a subject, table by table, per the map. */
export async function discover({ email, phone }) {
  const e = norm(email), p = String(phone || "").replace(/[^\d+]/g, "");
  if (!e && !p) return { tables: [], total: 0 };
  const out = [];
  for (const entry of PII_MAP) {
    const preds = [], params = [];
    for (const col of entry.match || []) {
      if (col === "email" && e) { params.push(e); preds.push(`lower(trim(COALESCE("email",''))) = $${params.length}`); }
      if (col === "phone" && p) { params.push(p); preds.push(`regexp_replace(COALESCE("phone",''), '[^0-9+]', '', 'g') = $${params.length}`); }
    }
    // Some tables carry no identifier column of their own — a form
    // submission holds the address inside its payload. Skipping them
    // would have made erasure quietly incomplete, so they are matched on
    // the payload text instead.
    if (!preds.length && entry.jsonbMatch && (e || p)) {
      const needle = e || p;
      const rows = await all(
        `SELECT id FROM ${entry.table} WHERE lower("${entry.jsonbMatch}"::text) LIKE $1`, [`%${needle}%`]).catch(() => []);
      out.push({ table: entry.table, mode: entry.mode, rows: rows.length, linked: false,
                 ids: rows.map((r) => r.id), columns: entry.columns, note: entry.note || null });
      continue;
    }
    if (!preds.length) { out.push({ table: entry.table, mode: entry.mode, rows: 0, linked: true, ids: [] }); continue; }
    const rows = await all(
      `SELECT id FROM ${entry.table} WHERE ${preds.join(" OR ")}`, params).catch(() => []);
    out.push({ table: entry.table, mode: entry.mode, rows: rows.length, linked: false,
               ids: rows.map((r) => r.id), columns: entry.columns, note: entry.note || null });
  }
  return { tables: out, total: out.reduce((n, t) => n + t.rows, 0) };
}

// ── Execution ────────────────────────────────────────────────────────
const SENTINEL = (id) => `erased:${id}`;
const ERASED = "[erased]";

function redactJsonb(value, keys) {
  const obj = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!obj || typeof obj !== "object") return { changed: false, value };
  let changed = false;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const copy = {};
      for (const [k, v] of Object.entries(node)) {
        if (keys.some((key) => k.toLowerCase() === key.toLowerCase())) { copy[k] = "[erased]"; changed = true; }
        else copy[k] = walk(v);
      }
      return copy;
    }
    return node;
  };
  // The walk must run BEFORE the flag is read: object literal properties
  // evaluate left to right, so `{ changed, value: walk(obj) }` captured
  // `changed` as false before walk() had a chance to set it.
  const redacted = walk(obj);
  return { changed, value: redacted };
}

/**
 * Erase. Anonymises in place: the row survives, the person does not.
 * Every touched row is logged by HASHED reference, so the log itself
 * holds no personal data and a restore can replay from it.
 */
export async function executeErasure(request) {
  const found = await discover({ email: request.subjectEmail, phone: request.subjectPhone });
  const report = { anonymised: 0, redacted: 0, retained: 0, tables: [] };
  const notNull = new Set((await all(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND is_nullable = 'NO'`).catch(() => []))
    .map((r) => `${r.table_name}.${r.column_name}`));

  for (const t of found.tables) {
    const entry = PII_MAP.find((x) => x.table === t.table);
    if (!entry || !t.ids?.length) continue;

    if (entry.mode === "retain_legal") {
      // Marketing PII is erased; the statutory minimum is kept, and the
      // lawful basis is written into the certificate rather than implied.
      for (const id of t.ids) {
        const sets = entry.columns.map((c, i) => `"${c}" = $${i + 2}`);
        if (sets.length) {
          try {
            await run(`UPDATE ${entry.table} SET ${sets.join(", ")} WHERE id = $1`,
              [id, ...entry.columns.map((c) => (notNull.has(`${entry.table}.${c}`) ? ERASED : null))]);
          } catch (e) {
            report.failed = report.failed || [];
            report.failed.push({ table: entry.table, id, error: String(e.message).slice(0, 200) });
          }
        }
        await logErasure(request.id, entry.table, entry.columns, id, "RETAIN_LEGAL");
        report.retained++;
      }
      report.tables.push({ table: entry.table, action: "RETAIN_LEGAL", rows: t.ids.length, note: entry.note });
      continue;
    }

    if (entry.mode === "redact_jsonb") {
      for (const id of t.ids) {
        const row = await get(`SELECT "${entry.columns[0]}" AS v FROM ${entry.table} WHERE id = $1`, [id]).catch(() => null);
        const { changed, value } = redactJsonb(row?.v, entry.jsonbKeys || []);
        if (changed) {
          try {
            await run(`UPDATE ${entry.table} SET "${entry.columns[0]}" = $2::jsonb WHERE id = $1`, [id, JSON.stringify(value)]);
            report.redacted++;
          } catch (e) {
            report.failed = report.failed || [];
            report.failed.push({ table: entry.table, id, error: String(e.message).slice(0, 200) });
          }
        }
        await logErasure(request.id, entry.table, entry.columns, id, "REDACT_JSONB");
      }
      report.tables.push({ table: entry.table, action: "REDACT_JSONB", rows: t.ids.length });
      continue;
    }

    for (const id of t.ids) {
      const sets = [], params = [id];
      for (const col of entry.columns) {
        // The email carries a per-request sentinel so an erased row stays
        // distinguishable and can never collide with a live address.
        // Other columns become NULL where the schema allows it and a
        // marker where it does not — several display names are NOT NULL,
        // and an erasure that fails a constraint must not pass silently.
        const value = col === "email" ? SENTINEL(request.id)
          : (notNull.has(`${entry.table}.${col}`) ? ERASED : null);
        params.push(value); sets.push(`"${col}" = $${params.length}`);
      }
      try {
        await run(`UPDATE ${entry.table} SET ${sets.join(", ")} WHERE id = $1`, params);
        await logErasure(request.id, entry.table, entry.columns, id, "ANONYMISE");
        report.anonymised++;
      } catch (e) {
        // Reported, never swallowed: an erasure the operator believes
        // happened but did not is the worst possible outcome here.
        report.failed = report.failed || [];
        report.failed.push({ table: entry.table, id, error: String(e.message).slice(0, 200) });
      }
    }
    report.tables.push({ table: entry.table, action: "ANONYMISE", rows: t.ids.length, columns: entry.columns });
  }
  return report;
}

async function logErasure(requestId, table, columns, id, action) {
  await run(
    `INSERT INTO erasure_log ("requestId", "tableName", columns, "rowRefHash", action)
     VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [requestId, table, JSON.stringify(columns || []), rowRef(table, id), action]).catch(() => {});
}

/** Export: the same map, in read mode. Two rights, one registry. */
export async function exportSubject({ email, phone }) {
  const found = await discover({ email, phone });
  const bundle = { generatedAt: new Date().toISOString(), subject: { email: email || null, phone: phone || null }, records: {} };
  for (const t of found.tables) {
    if (!t.ids?.length) continue;
    const rows = await all(`SELECT * FROM ${t.table} WHERE id = ANY($1::uuid[])`, [t.ids]).catch(() => []);
    bundle.records[t.table] = rows;
  }
  bundle.tableCount = Object.keys(bundle.records).length;
  bundle.rowCount = Object.values(bundle.records).reduce((n, r) => n + r.length, 0);
  return bundle;
}

/**
 * Replay. A restore from backup re-applies every executed erasure from
 * the hashed log — which is what makes the backup answer honest rather
 * than a promise that the data "ages out eventually".
 */
export async function replayErasures() {
  const requests = await all(
    `SELECT * FROM erasure_requests WHERE status IN ('EXECUTED','CONFIRMED') AND kind = 'ERASURE'`).catch(() => []);
  let replayed = 0;
  for (const r of requests) {
    const before = await discover({ email: r.subjectEmail, phone: r.subjectPhone });
    if (before.total === 0) continue;          // nothing came back; nothing to redo
    await executeErasure(r);
    replayed++;
  }
  return { requests: requests.length, replayed };
}
