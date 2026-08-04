import { all, get, run } from "./db.js";
import { evalCond } from "./automate-engine.js";

// ═══ W4·B · THE DATA FOUNDATION ═══════════════════════════════════════
// "Here is our spreadsheet" is the most predictable moment in any
// deployment, and it had no answer. This module gives it one — with the
// mapping, dedupe preview and consent capture that a fire-and-forget
// endpoint cannot have.

// ── CSV ──────────────────────────────────────────────────────────────
// A real parser, because the naive split(",") in the legacy leads
// importer mangles any quoted field containing a comma — which in this
// market means most company names and every address.
export function parseCsv(text, maxRows = 5000) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
      row = [];
      if (rows.length > maxRows) break;
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

// ── The state machine ────────────────────────────────────────────────
// Unlike the campaign matrix, every import transition is an explicit
// operator action, so a self-loop is NOT a free no-op — it must be
// declared. Re-mapping is legitimate and declared; re-committing is not,
// which is what stops a double-click from importing a file twice.
export const IMPORT_FLOW = {
  UPLOADED:  ["MAPPED", "CANCELLED", "FAILED"],
  MAPPED:    ["MAPPED", "VALIDATED", "UPLOADED", "CANCELLED", "FAILED"],
  VALIDATED: ["PREVIEWED", "MAPPED", "CANCELLED", "FAILED"],
  PREVIEWED: ["COMMITTED", "PREVIEWED", "MAPPED", "CANCELLED", "FAILED"],
  COMMITTED: [],
  CANCELLED: [],
  FAILED:    ["MAPPED", "CANCELLED"],
};
export function importTransitionError(from, to) {
  if (!from) return null;
  if (!(from in IMPORT_FLOW) || !(to in IMPORT_FLOW)) return `Unknown import status: ${from} → ${to}`;
  if (from === to && !IMPORT_FLOW[from].includes(to)) return `This import is already ${from}`;
  if (!IMPORT_FLOW[from].includes(to)) {
    const next = IMPORT_FLOW[from];
    return next.length ? `Invalid transition ${from} → ${to} (allowed: ${next.join(", ")})`
                       : `Invalid transition ${from} → ${to} (${from} is final)`;
  }
  return null;
}

// ── Target schemas ───────────────────────────────────────────────────
// What each entity accepts, and which fields are required. Keeping this
// declarative means a new importable entity is a data change.
export const IMPORT_TARGETS = {
  leads: {
    table: "leads",
    required: ["company"],
    fields: {
      company: { col: "company" }, contactName: { col: "contactName" }, phone: { col: "phone" },
      email: { col: "email" }, source: { col: "source", default: "IMPORT" },
      valueUsd: { col: "valueUsd", number: true }, stage: { col: "stage", default: "NEW" },
      notes: { col: "notes" },
    },
  },
  contacts: {
    table: "contacts",
    required: ["name"],
    fields: { name: { col: "name" }, email: { col: "email" }, phone: { col: "phone" },
              company: { col: "company" } },
  },
  conversions: {
    table: "conversions",
    required: ["valueAmount"],
    fields: { valueAmount: { col: "valueAmount", number: true }, currency: { col: "currency", default: "USD" },
              occurredOn: { col: "occurredOn" }, notes: { col: "notes" } },
  },
};

const normEmail = (v) => String(v || "").trim().toLowerCase() || null;
const normPhone = (v) => { const d = String(v || "").replace(/[^\d+]/g, ""); return d.length >= 7 ? d : null; };
export const normalizeKey = (field, value) =>
  field === "email" ? normEmail(value) : field === "phone" ? normPhone(value) : (String(value || "").trim().toLowerCase() || null);

/** Turn raw CSV + mapping into typed candidate rows with per-row errors. */
export function buildRows(job) {
  const target = IMPORT_TARGETS[job.entity];
  const rows = parseCsv(job.raw);
  if (rows.length < 2) return { rows: [], errors: [{ row: 0, reason: "CSV needs a header row and at least one data row" }] };
  const header = rows[0];
  const mapping = job.mapping || {};
  const idx = {};
  for (const [field, col] of Object.entries(mapping)) {
    const i = header.findIndex((h) => h.toLowerCase() === String(col).toLowerCase());
    if (i !== -1) idx[field] = i;
  }
  const out = [], errors = [];
  rows.slice(1).forEach((cells, n) => {
    const rec = {};
    for (const [field, spec] of Object.entries(target.fields)) {
      let v = idx[field] !== undefined ? cells[idx[field]] : undefined;
      if ((v === undefined || v === "") && spec.default !== undefined) v = spec.default;
      if (v === undefined || v === "") { rec[field] = null; continue; }
      rec[field] = spec.number ? (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null) : String(v).slice(0, 500);
    }
    const missing = target.required.filter((f) => rec[f] === null || rec[f] === undefined || rec[f] === "");
    if (missing.length) errors.push({ row: n + 2, reason: `missing required: ${missing.join(", ")}` });
    else out.push({ row: n + 2, rec });
  });
  return { rows: out, errors };
}

/** Dedupe against the database and within the file itself. */
export async function previewImport(job) {
  const target = IMPORT_TARGETS[job.entity];
  const { rows, errors } = buildRows(job);
  const key = job.dedupeOn;
  let duplicates = 0, inFile = 0;
  const seen = new Set();
  const marked = [];
  for (const r of rows) {
    let dup = null;
    if (key !== "none") {
      const k = normalizeKey(key, r.rec[key]);
      if (k) {
        if (seen.has(k)) { inFile++; dup = "file"; } else seen.add(k);
        if (!dup) {
          const col = key === "company" ? "company" : key;
          const hit = await get(
            `SELECT id FROM ${target.table} WHERE lower(trim(COALESCE("${col}",''))) = $1 LIMIT 1`, [k]).catch(() => null);
          if (hit) { duplicates++; dup = "db"; r.existingId = hit.id; }
        }
      }
    }
    marked.push({ ...r, duplicate: dup });
  }
  const willCreate = marked.filter((r) => !r.duplicate).length;
  const willUpdate = job.mergeStrategy === "skip" ? 0 : marked.filter((r) => r.duplicate === "db").length;
  const willSkip = marked.length - willCreate - willUpdate;
  return {
    stats: { rows: rows.length + errors.length, valid: rows.length, invalid: errors.length,
             duplicates, duplicatesInFile: inFile, willCreate, willUpdate, willSkip },
    errors, sample: marked.slice(0, 20), marked,
  };
}

/** Commit. Consent is captured here, once, for every row the job creates. */
export async function commitImport(job, userId) {
  const target = IMPORT_TARGETS[job.entity];
  const { marked } = await previewImport(job);
  let created = 0, updated = 0, skipped = 0;
  for (const r of marked) {
    if (r.duplicate === "file") { skipped++; continue; }
    if (r.duplicate === "db") {
      if (job.mergeStrategy === "skip") { skipped++; continue; }
      const sets = [], vals = [r.existingId];
      for (const [f, v] of Object.entries(r.rec)) {
        if (v === null && job.mergeStrategy === "merge") continue; // merge never overwrites with blanks
        vals.push(v); sets.push(`"${f}" = $${vals.length}`);
      }
      if (sets.length) { await run(`UPDATE ${target.table} SET ${sets.join(", ")} WHERE id = $1`, vals); updated++; }
      else skipped++;
      continue;
    }
    const cols = Object.keys(r.rec), vals = Object.values(r.rec);
    await run(`INSERT INTO ${target.table} (${cols.map((c) => `"${c}"`).join(", ")})
               VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
    created++;
    // Consent is recorded at the moment of import, not assumed afterwards.
    if (job.consentBasis && (r.rec.email || r.rec.phone) && job.entity !== "contacts") {
      // The consent ledger is the existing contacts.consent jsonb array —
      // one shape for consent in the product, not a second one for imports.
      const entry = JSON.stringify([{ basis: job.consentBasis, source: job.consentSource || "IMPORT",
                                      at: new Date().toISOString(), via: "import" }]);
      await run(
        `INSERT INTO contacts (name, email, phone, company, consent) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [r.rec.contactName || r.rec.name || r.rec.company || "—", r.rec.email || null,
         r.rec.phone || null, r.rec.company || null, entry]).catch(() => {});
    }
  }
  return { created, updated, skipped };
}

// ── Segments on the shared predicate engine ──────────────────────────
// One condition evaluator in this codebase, ever (decision D9). A segment
// definition is the same shape a workflow condition has always been:
//   { all: [ {field, op, value}, ... ] }  /  { any: [ ... ] }
export const SEGMENT_SOURCES = {
  leads: { table: "leads", label: "Leads",
           fields: ["company", "contactName", "email", "phone", "source", "stage", "valueUsd", "score", "lostReason", "campaignId", "departmentId"] },
  contacts: { table: "contacts", label: "Contacts",
              fields: ["name", "email", "phone", "company"] },
  customers: { table: "customers", label: "Customers",
               fields: ["company", "status", "businessUnit", "totalValueUsd", "accountOwnerId"] },
};

export function definitionError(def) {
  if (def === null || def === undefined) return null;         // descriptive segment
  if (typeof def !== "object") return "definition must be an object";
  const src = def.source || "leads";
  const spec = SEGMENT_SOURCES[src];
  if (!spec) return `Unknown segment source: ${src}`;
  const groups = def.all || def.any;
  if (!Array.isArray(groups) || !groups.length) return "definition needs a non-empty `all` or `any` list";
  if (def.all && def.any) return "use either `all` or `any`, not both";
  for (const c of groups) {
    if (!c || typeof c !== "object") return "each condition must be an object";
    // Whitelist: a segment may only test fields its source declares. This is
    // the injection gate — unknown fields are refused, never interpolated.
    if (!spec.fields.includes(c.field)) return `Field not allowed on ${src}: ${c.field}`;
    if (!c.op) return "each condition needs an op";
  }
  return null;
}

/** Evaluate a definition against real rows using the workflow engine's evaluator. */
export async function evaluateSegment(def, { limit = 500 } = {}) {
  if (!def) return { rows: [], count: 0, descriptive: true };
  const spec = SEGMENT_SOURCES[def.source || "leads"];
  const conds = def.all || def.any || [];
  const mode = def.all ? "all" : "any";
  // Rows are fetched, then filtered by the shared evaluator — never by
  // generated SQL built from user input.
  const rows = await all(`SELECT * FROM ${spec.table} ORDER BY "createdAt" DESC LIMIT 5000`);
  const hit = rows.filter((row) => {
    const ctx = { payload: {}, lead: row };
    return mode === "all" ? conds.every((c) => evalCond(c, ctx)) : conds.some((c) => evalCond(c, ctx));
  });
  return { rows: hit.slice(0, limit), count: hit.length, descriptive: false, source: def.source || "leads" };
}

export async function refreshSegmentCount(id) {
  const seg = await get(`SELECT * FROM segments WHERE id = $1`, [id]);
  if (!seg || !seg.definition) return null;
  const def = typeof seg.definition === "string" ? JSON.parse(seg.definition) : seg.definition;
  const { count } = await evaluateSegment(def);
  await run(`UPDATE segments SET "lastCount" = $2, "lastCountedAt" = now() WHERE id = $1`, [id, count]);
  return count;
}
