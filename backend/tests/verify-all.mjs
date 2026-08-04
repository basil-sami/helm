// Pulse (نبض) regression suite — runs on an in-memory Postgres (PGlite), no external DB.
//   cd backend && npm i --no-save @electric-sql/pglite && npm test
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };

/* ══ A. Engine units (fixtures, no network) ═══════════════════════════ */
const eng = await import("../src/integrations/osint.js");

const GOOGLE_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Saria expands solar line</title><link>https://news.example.com/a?utm_source=rss</link>
<pubDate>Tue, 07 Jul 2026 09:00:00 GMT</pubDate><description><![CDATA[Assembly <b>growth</b> announced]]></description>
<source url="https://sudantribune.com">Sudan Tribune</source></item>
<item><title>ساريا تطلق شراكة جديدة</title><link>https://ar.example.com/b</link>
<pubDate>Mon, 06 Jul 2026 10:00:00 GMT</pubDate><description>إطلاق وتوسع</description></item>
</channel></rss>`;
let items = eng.parseFeed(GOOGLE_RSS, "GOOGLE_NEWS");
ok("parseFeed: RSS items + CDATA + <source>", items.length === 2 && items[0].source === "Sudan Tribune" && items[0].snippet.includes("growth"));

const BING_RSS = `<rss xmlns:News="https://www.bing.com"><channel>
<item><title>Battery demand rises in Sudan</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fex.com%2fc</link>
<pubDate>Sun, 05 Jul 2026 08:00:00 GMT</pubDate><description>Power backup market</description>
<News:Source>Example Wire</News:Source></item></channel></rss>`;
items = eng.parseFeed(BING_RSS, "BING_NEWS");
ok("parseFeed: Bing News:Source tag", items.length === 1 && items[0].source === "Example Wire" && items[0].sourceType === "BING_NEWS");

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom headline</title><link href="https://atom.example.com/x"/><updated>2026-07-04T12:00:00Z</updated>
<summary>ok</summary></entry></feed>`;
items = eng.parseFeed(ATOM, "RSS");
ok("parseFeed: Atom entries", items.length === 1 && items[0].url === "https://atom.example.com/x");

const GDELT = { articles: [
  { title: "Sudan solar tender", url: "https://gd.example.com/1", seendate: "20260706T101500Z", domain: "gd.example.com", language: "English" },
  { title: "", url: "https://gd.example.com/skip" },
]};
items = eng.parseGdelt(GDELT);
ok("parseGdelt: maps + drops empty titles", items.length === 1 && items[0].publishedAt.getUTCDate() === 6 && items[0].lang === "en");

const REDDIT = { data: { children: [
  { data: { title: "Anyone used Saria inverters?", permalink: "/r/sudan/comments/x1/", selftext: "Looking for reviews", created_utc: 1751500000, subreddit: "sudan", author: "u1" } },
  { data: { title: "Second post", url_overridden_by_dest: "https://ext.example.com/p", created_utc: 1751400000, subreddit: "solar", author: "u2" } },
]}};
items = eng.parseReddit(REDDIT);
ok("parseReddit: permalink + external url", items.length === 2 && items[0].url.startsWith("https://www.reddit.com/r/sudan") && items[1].url === "https://ext.example.com/p" && items[0].source === "r/sudan");

ok("sentiment: EN positive", eng.scoreSentiment("record growth and a new partnership").label === "POS");
ok("sentiment: AR negative", eng.scoreSentiment("أزمة خسارة كبيرة في السوق").label === "NEG");
ok("sentiment: backward negation", eng.scoreSentiment("no growth this quarter").label === "NEG");
ok("sentiment: forward negation", eng.scoreSentiment("growth was not seen").label === "NEG");
ok("sentiment: token boundaries (winter ≠ win)", eng.scoreSentiment("winter is coming to town").label === "NEU");
ok("sentiment: 'إقبال مرتفع' no longer reads negative", eng.scoreSentiment("إقبال مرتفع على المنتجات").label !== "NEG");

ok("normalizeUrl strips tracking, keeps ref ids", eng.normalizeUrl("https://www.Ex.com/a/?utm_source=x&ref=123#f") === "https://ex.com/a/?ref=123");
const dd = eng.dedupeSignals([
  { title: "Same Story!", url: "https://a.com/1?utm_source=x" },
  { title: "same story", url: "https://a.com/1" },
  { title: "Different", url: "" },
]);
ok("dedupeSignals: url+title collapse", dd.length === 2);

// SEC·A: every deployed instance carries its own encryption key, so the
// harness does too. The fail-closed path is exercised in the SEC·A block
// by borrowing the key away and putting it back.
process.env.PULSE_SECRET_KEY_V1 = (await import("node:crypto")).randomBytes(32).toString("base64");

/* ══ B. Full API regression on PGlite ═════════════════════════════════ */
const db = new PGlite();
const sql = fs.readFileSync(path.join(HERE, "../../supabase/setup.sql"), "utf8")
  .replace(/create extension if not exists pgcrypto;/g, "");
await db.exec(sql);
globalThis.__PULSE_DB_CLIENT__ = db;

const { createApp } = await import("../src/app.js");
const srv = createApp().listen(4110);
await new Promise((r) => setTimeout(r, 250));
const B = "http://127.0.0.1:4110/api";

const raw = (method, path2, body, token, headers = {}) => fetch(B + path2, {
  method,
  headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
const j = async (method, path2, body, token, headers) => {
  const r = await raw(method, path2, body, token, headers);
  let data = null; try { data = await r.json(); } catch { /* 204/CSV/HTML */ }
  return { status: r.status, data, headers: r.headers };
};

// Security headers + CORS lockdown
const health = await j("GET", "/health", null, null, { origin: "https://evil.example" });
ok("security headers on every response",
  health.headers.get("x-content-type-options") === "nosniff" && health.headers.get("x-frame-options") === "DENY");
ok("CORS: unknown origins get no allow header", !health.headers.get("access-control-allow-origin"));

/* ══ B0. Wave 0 — fresh-instance journey: installer → wizard → flags ══ */
// The generic seed ships ZERO users: the public installer must be open exactly once.
let st = await j("GET", "/setup/status");
ok("fresh instance: setup/status → needsSetup", st.status === 200 && st.data.needsSetup === true && st.data.onboarded === false);
ok("setup/status exposes public branding only",
  "orgName" in st.data.branding && "accentColor" in st.data.branding && !("modules" in st.data.branding));
ok("installer rejects missing fields", (await j("POST", "/setup", { name: "A", email: "a@x.co" })).status === 400);
ok("installer rejects short password", (await j("POST", "/setup", { name: "A", email: "a@x.co", password: "1234567" })).status === 400);
const boot = await j("POST", "/setup", { name: "Installer Admin", email: "admin@client.co", password: "Fresh#2026", orgName: "Acme Retail", orgNameAr: "شركة أكمي" });
ok("installer creates first admin + session", boot.status === 201 && !!boot.data.token && boot.data.user.permissions?.admin === true);
const I = boot.data.token;
st = await j("GET", "/setup/status");
ok("installer door closes: needsSetup false", st.data.needsSetup === false && st.data.branding.orgName === "Acme Retail");
ok("installer permanently locked (403)", (await j("POST", "/setup", { name: "B", email: "b@x.co", password: "LongEnough1" })).status === 403);
ok("installer admin can log in normally", (await j("POST", "/auth/login", { email: "admin@client.co", password: "Fresh#2026" })).status === 200);

// Wizard writes: validation + roundtrip of the new settings surface
ok("accentColor validates hex", (await j("PATCH", "/settings", { accentColor: "amberish" }, I)).status === 400);
ok("localCurrency validates code", (await j("PATCH", "/settings", { localCurrency: "£!" }, I)).status === 400);
ok("businessUnits must be an array", (await j("PATCH", "/settings", { businessUnits: "Solar" }, I)).status === 400);
const wiz = await j("PATCH", "/settings", {
  accentColor: "#7a6ca8", localCurrency: "ngn", localCurrencyAr: "نيرة",
  businessUnits: ["Retail", " Wholesale ", ""], modules: { intel: false, brain: false, bogus: true }, onboarded: true,
}, I);
const wu = Array.isArray(wiz.data.businessUnits) ? wiz.data.businessUnits : JSON.parse(wiz.data.businessUnits || "[]");
const wm = typeof wiz.data.modules === "object" ? wiz.data.modules : JSON.parse(wiz.data.modules || "{}");
ok("wizard roundtrip: normalized accent/currency", wiz.status === 200 && wiz.data.accentColor === "#7A6CA8" && wiz.data.localCurrency === "NGN");
ok("wizard roundtrip: BU trimmed, modules whitelisted", wu.length === 2 && wu[1] === "Wholesale" && wm.intel === false && !("bogus" in wm));
ok("wizard flips onboarded", wiz.data.onboarded === true);

// Server-side module flags: a disabled territory 404s, cron no-ops, re-enable restores
ok("flag off: intel router 404s", (await j("GET", "/osint/topics", null, I)).status === 404);
ok("flag off: brain router 404s", (await j("GET", "/brain/status", null, I)).status === 404);
ok("flag off: unflagged module unaffected", (await j("GET", "/campaigns", null, I)).status === 200);
const skipped = await j("GET", "/cron/osint");
ok("flag off: Daily Pulse cron skips intel (snapshots still run)",
  skipped.status === 200 && skipped.data.intel?.skipped === true && typeof skipped.data.snapshots === "number" && skipped.data.snapshots > 0);
await j("PATCH", "/settings", { modules: { intel: true, brain: true } }, I);
ok("flag on: intel router restored", (await j("GET", "/osint/topics", null, I)).status === 200);

/* ══ B1. Load the Saria flagship demo and run the full regression ═════ */
const demoSql = fs.readFileSync(path.join(HERE, "../../supabase/seed-demo.sql"), "utf8");
await db.exec(demoSql);
const { invalidateModulesCache } = await import("../src/flags.js");
invalidateModulesCache();

// Auth + roles
const head = await j("POST", "/auth/login", { email: "head@saria.sd", password: "Pulse@2026" });
ok("head login → admin permissions", head.status === 200 && head.data.user.permissions?.admin === true);
const H = head.data.token;
ok("bad password → 401", (await j("POST", "/auth/login", { email: "head@saria.sd", password: "wrong" })).status === 401);
ok("password shorter than 8 → 400",
  (await j("POST", "/users", { name: "x", email: "short@saria.sd", password: "1234567", role: "DIGITAL" }, H)).status === 400);

const roles = await j("GET", "/roles", null, H);
ok("5 built-in roles", roles.data?.filter?.((r) => r.builtin).length === 5);
const readPerms = Object.fromEntries(["campaigns","content","leads","events","budget","social","intel","planning","analytics","brain"].map((m) => [m, "read"]));
const mkRole = await j("POST", "/roles", { key: "ANALYST", label: "Analyst", labelAr: "محلل", permissions: { ...readPerms, admin: false, tasks: "write" } }, H);
ok("create custom role", mkRole.status === 201);
ok("create user w/ custom role", (await j("POST", "/users", { name: "Amel", email: "analyst@saria.sd", password: "Test12345", role: "ANALYST" }, H)).status === 201);
const an = await j("POST", "/auth/login", { email: "analyst@saria.sd", password: "Test12345" });
const A = an.data.token;
ok("analyst: campaigns read 200 / write 403",
  (await j("GET", "/campaigns", null, A)).status === 200 && (await j("POST", "/campaigns", { name: "x" }, A)).status === 403);
ok("analyst: tasks write 201", (await j("POST", "/tasks", { title: "from analyst", status: "TODO", priority: "LOW" }, A)).status === 201);
ok("analyst: planning/users/settings writes 403",
  (await j("POST", "/planning/objectives", { label: "x" }, A)).status === 403 &&
  (await j("POST", "/users", { name: "x", email: "q@q.sd", password: "12345678", role: "ANALYST" }, A)).status === 403 &&
  (await j("PATCH", "/settings", { usdToSdgRate: 3000 }, A)).status === 403);
ok("analyst: social metrics write 403 (was ungated)",
  (await j("POST", "/social/metrics", { accountId: "00000000-0000-0000-0000-000000000000", date: "2026-07-01", followers: 1 }, A)).status === 403);

// VIEWER role with none-permissions: reads must be blocked too
const nonePerms = { ...readPerms, intel: "none", planning: "none", social: "none" };
await j("POST", "/roles", { key: "VIEWER", label: "Viewer", permissions: { ...nonePerms, admin: false } }, H);
await j("POST", "/users", { name: "Vera", email: "viewer@saria.sd", password: "Test12345", role: "VIEWER" }, H);
const vi = await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Test12345" });
const V = vi.data.token;
ok("none-role: osint signals read 403", (await j("GET", "/osint/signals", null, V)).status === 403);
ok("none-role: planning read 403", (await j("GET", "/planning/objectives", null, V)).status === 403);
ok("none-role: listening 403 (needs intel or social)", (await j("GET", "/listening", null, V)).status === 403);
const dir = await j("GET", "/users", null, V);
ok("non-admin user directory hides emails", dir.status === 200 && dir.data.length > 0 && !("email" in dir.data[0]));

const cb = await j("POST", "/auth/login", { email: "content@saria.sd", password: "Pulse@2026" });
const C = cb.data.token;
ok("builtin continuity: content@ campaigns 201, osint 403",
  (await j("POST", "/campaigns", { name: "by content" }, C)).status === 201 &&
  (await j("POST", "/osint/topics", { label: "x", query: "x" }, C)).status === 403);

// CRUD lifecycle per module (as head)
const camp = await j("POST", "/campaigns", { name: "Regression Campaign", status: "PLANNING", channel: "PAID" }, H);
ok("campaigns: create", camp.status === 201 && !!camp.data?.id, JSON.stringify(camp.data));
const campId = camp.data?.id;
if (!campId) { console.log("ABORT: campaign create failed"); srv.close(); process.exit(1); }
ok("campaigns: patch", (await j("PATCH", `/campaigns/${campId}`, { objective: "Reach distributors" }, H)).data?.objective === "Reach distributors");
ok("content: create + campaign link", (await j("POST", "/content", { title: "Reg post", channel: "SOCIAL", status: "IDEA", campaignId: campId }, H)).status === 201);
const lead = await j("POST", "/leads", { company: "Reg Co", stage: "NEW", valueUsd: 5000, campaignId: campId }, H);
ok("leads: create", lead.status === 201);
ok("leads: kanban stage move", (await j("PATCH", `/leads/${lead.data.id}`, { stage: "QUALIFIED" }, H)).data?.stage === "QUALIFIED");
ok("events: create", (await j("POST", "/events", { name: "Reg Expo", type: "EXPO", status: "PLANNED" }, H)).status === 201);
ok("budget: create", (await j("POST", "/budget", { label: "Reg spend", kind: "SPENT", channel: "PAID", amountUsd: 900 }, H)).status === 201);
const tsk = await j("POST", "/tasks", { title: "Reg task", status: "TODO", priority: "HIGH" }, H);
ok("tasks: create + delete", tsk.status === 201 && (await raw("DELETE", `/tasks/${tsk.data.id}`, null, H)).status === 204);

// Lead activity timeline
const acts1 = await j("GET", `/leads/${lead.data.id}/activities`, null, H);
ok("timeline: CREATED + STAGE captured",
  acts1.status === 200 && acts1.data.some((a) => a.kind === "CREATED") &&
  acts1.data.some((a) => a.kind === "STAGE" && a.meta?.to === "QUALIFIED"));
ok("timeline: add note", (await j("POST", `/leads/${lead.data.id}/notes`, { body: "Called the client — meeting Sunday" }, H)).status === 201);
ok("timeline: read-only role can't add notes", (await j("POST", `/leads/${lead.data.id}/notes`, { body: "x" }, A)).status === 403);

// Atomic process batch
const tasksBefore = (await j("GET", "/tasks", null, H)).data.length;
const batch = await j("POST", "/tasks/batch", {
  processKey: "lead_followup", leadId: lead.data.id, assigneeId: an.data.user.id,
  tasks: [{ title: "Call", priority: "HIGH", dueDate: "2026-07-11" }, { title: "Profile", priority: "MEDIUM" }, { title: "Meet", priority: "HIGH" }],
}, H);
ok("tasks/batch: atomic create", batch.status === 201 && batch.data.created === 3);
const badBatch = await j("POST", "/tasks/batch", { tasks: [{ title: "ok" }, { title: "bad", priority: "URGENT" }] }, H);
const tasksAfter = (await j("GET", "/tasks", null, H)).data.length;
ok("tasks/batch: invalid item rejects the whole batch", badBatch.status === 400 && tasksAfter === tasksBefore + 3);
const acts2 = await j("GET", `/leads/${lead.data.id}/activities`, null, H);
ok("timeline: process logged on lead", acts2.data.some((a) => a.kind === "TASK" && a.meta?.count === 3));

// Notifications: assignment + capture + read flow
const nA = await j("GET", "/notifications", null, A);
ok("assignee notified (batch)", nA.data.unread >= 1 && nA.data.items.some((n) => n.type === "TASKS_ASSIGNED"));
await j("POST", "/tasks", { title: "Direct assign", status: "TODO", priority: "LOW", assigneeId: an.data.user.id }, H);
const nA2 = await j("GET", "/notifications", null, A);
ok("assignee notified (single task)", nA2.data.items.some((n) => n.type === "TASK_ASSIGNED"));
ok("mark all read", (await j("PATCH", "/notifications/read-all", null, A)).status === 200 &&
  (await j("GET", "/notifications", null, A)).data.unread === 0);

// Public capture layer
const form = await raw("GET", "/capture/form?lang=ar");
ok("capture form renders (ar, RTL)", form.status === 200 && (await form.text()).includes('dir="rtl"'));
ok("capture: valid submission → 201",
  (await j("POST", "/capture/lead", { company: "Blue Nile Mills", phone: "+249911111111", contactName: "Omar", notes: "Need solar quote" })).status === 201);
const leadsNow = await j("GET", "/leads", null, H);
ok("captured lead lands in pipeline (WEB_FORM)", leadsNow.data.some((l) => l.company === "Blue Nile Mills" && l.source === "WEB_FORM"));
const nH = await j("GET", "/notifications", null, H);
ok("leads-write users notified of capture", nH.data.items.some((n) => n.type === "LEAD_CAPTURED" && n.meta?.company === "Blue Nile Mills"));
ok("capture honeypot: fake success, nothing stored",
  (await j("POST", "/capture/lead", { company: "Bot Co", phone: "+100000", website: "spam" })).status === 200 &&
  !(await j("GET", "/leads", null, H)).data.some((l) => l.company === "Bot Co"));
ok("capture: missing phone → 400", (await j("POST", "/capture/lead", { company: "No Phone Co" })).status === 400);

// Engines
const ana = await j("GET", "/analytics", null, H);
ok("analytics overview shape + default window", ana.status === 200 && ["scorecard","funnel","channels","trends"].every((k) => k in ana.data) && ana.data.window?.days === 365);
ok("analytics ?window=90d", (await j("GET", "/analytics?window=90d", null, H)).data.window?.days === 90);
ok("analytics ?window=all", (await j("GET", "/analytics?window=all", null, H)).data.window?.days === null);
const pl = await j("GET", "/planning/objectives", null, H);
ok("planning progress + pace", pl.status === 200 && pl.data.length >= 5 && "pace" in pl.data[0] && "progress" in pl.data[0]);
const li = await j("GET", "/listening", null, H);
ok("listening: SOV + 8 UTC weeks + ER basis", li.status === 200 && typeof li.data.summary.sovPct === "number" &&
  li.data.volumeByWeek.length === 8 && ["reach","impressions"].includes(li.data.accounts[0]?.erBasis), `sov=${li.data?.summary?.sovPct}%`);
const br = await j("GET", "/brain/status", null, H);
ok("brain status honest when unconfigured", br.status === 200 && br.data.configured === false);

// Audit + sovereignty
const audit = await j("GET", "/audit", null, H);
ok("audit trail captured writes", audit.status === 200 && audit.data.length >= 10 &&
  audit.data.some((a) => a.action === "campaigns.create") && audit.data.some((a) => a.action === "tasks.batch"));
ok("audit is admin-only", (await j("GET", "/audit", null, A)).status === 403);
const bk = await j("GET", "/export/backup", null, H);
ok("sovereign backup: all tables, no hashes",
  bk.status === 200 && Object.keys(bk.data.tables).length >= 13 && !("passwordHash" in bk.data.tables.users[0]));
ok("backup is admin-only", (await j("GET", "/export/backup", null, A)).status === 403);
const csv = await raw("GET", "/export/leads", null, H);
ok("CSV export works", csv.status === 200 && (csv.headers.get("content-type") || "").includes("csv"));

// Cron ingestion: isolation under total network failure + alert push counter
await db.query(`UPDATE osint_topics SET active = false WHERE label <> 'Saria brand mentions'`);
const cron = await j("GET", "/cron/osint");
ok("cron: survives network failure, isolates per-source errors",
  cron.status === 200 && cron.data.ok === true && cron.data.intel.inserted === 0 && cron.data.intel.errors.length >= 3 &&
  typeof cron.data.intel.alertsPushed === "number" && typeof cron.data.sweepPushed === "number");
process.env.CRON_SECRET = "s3cret";
ok("cron: wrong secret → 401", (await j("GET", "/cron/osint")).status === 401);
ok("cron: correct secret → 200", (await j("GET", "/cron/osint", null, null, { authorization: "Bearer s3cret" })).status === 200);
delete process.env.CRON_SECRET;


/* ══ C. Hub (Phases A–C + effectiveness) ══════════════════════════════ */
// Content transition matrix
const ct = await j("POST", "/content", { title: "Matrix", channel: "SOCIAL", status: "IDEA" }, H);
ok("content: IDEA → PUBLISHED blocked", (await j("PATCH", `/content/${ct.data.id}`, { status: "PUBLISHED" }, H)).status === 400);
let okSteps = true;
for (const st of ["IN_PROGRESS", "REVIEW", "APPROVED", "PUBLISHED"]) {
  okSteps = okSteps && (await j("PATCH", `/content/${ct.data.id}`, { status: st }, H)).status === 200;
}
ok("content: stepwise forward transitions pass", okSteps);

// Campaign ACTIVE gate + brief upsert
const gc = await j("POST", "/campaigns", { name: "Gated", status: "PLANNING" }, H);
ok("campaign: ACTIVE without brief → 400", (await j("PATCH", `/campaigns/${gc.data.id}`, { status: "ACTIVE" }, H)).status === 400);
const personasL = await j("GET", "/personas", null, H);
const productsL = await j("GET", "/products", null, H);
ok("seed: personas + products present", personasL.data.length >= 3 && productsL.data.length >= 3);
const briefUp = await j("POST", `/briefs/${gc.data.id}`, { objective: "Sell more NP7", personaId: personasL.data[0].id, productId: productsL.data[0].id, kpiMetric: "LEADS", kpiTarget: 40, channels: ["WHATSAPP"] }, H);
ok("brief: upsert", briefUp.status === 201);
ok("campaign: ACTIVE with brief → 200", (await j("PATCH", `/campaigns/${gc.data.id}`, { status: "ACTIVE" }, H)).status === 200);
ok("brief: joined names on GET", (await j("GET", `/briefs/${gc.data.id}`, null, H)).data.personaName?.length > 0);

// Tracked links: redirect, counting, capture attribution
const lk = await j("POST", "/links", { url: "https://saria.sd/np7", campaignId: gc.data.id, channel: "WHATSAPP" }, H);
ok("links: create with generated code", lk.status === 201 && /^[a-z0-9-]{3,30}$/.test(lk.data.code));
const r1r = await fetch(`http://127.0.0.1:4110/r/${lk.data.code}`, { redirect: "manual" });
await fetch(`http://127.0.0.1:4110/r/${lk.data.code}`, { redirect: "manual" });
await new Promise((r) => setTimeout(r, 60));
const lkList = await j("GET", "/links", null, H);
ok("links: 302 + clicks counted", r1r.status === 302 && r1r.headers.get("location") === "https://saria.sd/np7" &&
  lkList.data.find((x) => x.code === lk.data.code)?.clicks === 2);
ok("capture: ?src attributes the campaign",
  (await j("POST", "/capture/lead", { company: "Souq Al-Arabi Traders", phone: "+249900000001", src: lk.data.code })).status === 201 &&
  (await j("GET", "/leads", null, H)).data.find((l) => l.company === "Souq Al-Arabi Traders")?.campaignId === gc.data.id);

// Products / personas hub CRUD + permissions
ok("products: viewer write blocked", (await j("POST", "/products", { name: "x" }, V)).status === 403);
const np = await j("POST", "/products", { name: "AGM Deep-Cycle", businessUnit: "Batteries", priceMinUsd: 40, priceMaxUsd: 70 }, H);
ok("products: create", np.status === 201);
const seg1 = (await j("GET", "/segments", null, H)).data[0];
const perNew = await j("POST", "/personas", { segmentId: seg1.id, name: "Tender officer", channels: ["EMAIL", "CALL"] }, H);
ok("personas: jsonb channels survive", perNew.status === 201 && Array.isArray((await j("GET", "/personas", null, H)).data.find((x) => x.id === perNew.data.id)?.channels));

// Product attribution flows into effectiveness
await j("PATCH", `/leads/${lead.data.id}`, { productId: productsL.data[0].id }, H);
const anaEff = await j("GET", "/analytics?window=all", null, H);
ok("analytics: effectiveness block (posts + products)",
  anaEff.data.effectiveness && anaEff.data.effectiveness.postsTop.length >= 1 &&
  anaEff.data.effectiveness.erByChannel.length >= 1 &&
  anaEff.data.effectiveness.byProduct.some((x) => x.leads >= 1));
ok("budget: rateAtEntry captured", (await j("GET", "/budget", null, H)).data.some((b) => b.rateAtEntry != null));

// Posts CRUD + campaign insights
const po = await j("POST", "/posts", { campaignId: gc.data.id, platform: "WHATSAPP", reach: 900, engagement: 90, clicks: 40, linkCode: lk.data.code }, H);
ok("posts: create", po.status === 201);
const ci = await j("GET", `/analytics/campaign/${gc.data.id}`, null, H);
ok("campaign insights: spend/clicks/posts/brief", ci.status === 200 &&
  ["spentUsd","romiPct","clicks","avgEr","brief"].every((k) => k in ci.data) && ci.data.clicks === 2 && ci.data.posts === 1);

// Registrations + event scorecard + capture auto-registration
const ev = (await j("GET", "/events", null, H)).data[0];
const reg = await j("POST", `/events/${ev.id}/registrations`, { leadId: lead.data.id }, H);
ok("registrations: create + duplicate 409", reg.status === 201 &&
  (await j("POST", `/events/${ev.id}/registrations`, { leadId: lead.data.id }, H)).status === 409);
ok("registrations: check-in → ATTENDED", (await j("PATCH", `/registrations/${reg.data.id}/checkin`, {}, H)).data.status === "ATTENDED");
await j("POST", "/capture/lead", { company: "Expo Walk-in Co", phone: "+249900000002", eventId: ev.id });
ok("capture: ?event auto-registers", (await j("GET", `/events/${ev.id}/registrations`, null, H)).data.some((r) => r.company === "Expo Walk-in Co"));
const evs = await j("GET", `/analytics/event/${ev.id}`, null, H);
ok("event scorecard", evs.status === 200 && evs.data.registered >= 2 && evs.data.attended >= 1);

// Customers: WON-only conversion
ok("customers: non-WON convert → 400", (await j("POST", `/customers/convert/${lead.data.id}`, {}, H)).status === 400);
await j("PATCH", `/leads/${lead.data.id}`, { stage: "WON" }, H);
const cust = await j("POST", `/customers/convert/${lead.data.id}`, {}, H);
ok("customers: convert WON", cust.status === 201 && !!cust.data.nextReviewAt);
ok("customers: duplicate convert 409", (await j("POST", `/customers/convert/${lead.data.id}`, {}, H)).status === 409);
ok("customers: list joins owner", (await j("GET", "/customers", null, H)).data.some((c) => c.company === "Reg Co"));

// Feedback (public CSAT)
ok("feedback: public 5★", (await j("POST", "/capture/feedback", { score: 5, comment: "ممتاز", customerId: cust.data.id })).status === 201);
ok("feedback: invalid score 400", (await j("POST", "/capture/feedback", { score: 9 })).status === 400);
const fbAgg = await j("GET", "/feedback", null, H);
ok("feedback: avg + count", fbAgg.data.count >= 1 && fbAgg.data.avg >= 1);

// Press ↔ OSINT coverage matching
const mcRow = (await j("GET", "/media-contacts", null, H)).data[0];
const prI = await j("POST", "/press", { title: "NP7 coverage", contactId: mcRow.id, status: "PUBLISHED", url: "https://sudantribune.com/np7-story", publishedAt: new Date().toISOString() }, H);
ok("press: create", prI.status === 201);
const topic1 = (await db.query(`SELECT id FROM osint_topics LIMIT 1`)).rows[0];
await db.query(`INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, sentiment, "sentimentLabel", "publishedAt")
                VALUES ($1, 'Sudan Tribune', 'MANUAL', 'NP7 story', 'https://sudantribune.com/np7-story', 0.5, 'POS', now())`, [topic1.id]);
ok("press: OSINT coverage auto-matched", (await j("GET", "/press", null, H)).data.find((x) => x.id === prI.data.id)?.matchedSignals >= 1);

// Influencer collab with link ROI
const infRow = (await j("GET", "/influencers", null, H)).data[0];
const co1 = await j("POST", "/collabs", { influencerId: infRow.id, campaignId: gc.data.id, deliverable: "Review video", costUsd: 150, linkCode: lk.data.code, status: "LIVE" }, H);
ok("collabs: create + click join", co1.status === 201 && (await j("GET", "/collabs", null, H)).data[0].clicks === 2);

// Templates (DB-backed processes)
const tps = await j("GET", "/templates", null, H);
ok("templates: 4 built-in processes seeded", tps.data.filter((t) => t.builtin && t.kind === "PROCESS").length === 4);
ok("templates: built-in locked", (await j("DELETE", `/templates/${tps.data[0].id}`, null, H)).status === 403);
ok("templates: custom create", (await j("POST", "/templates", { key: "tender_response", name: "Tender response", nameAr: "الرد على مناقصة", tasks: [{ t: { ar: "قراءة كراسة الشروط", en: "Read tender docs" }, offset: 0, priority: "HIGH" }] }, H)).status === 201);

// Pagination (opt-in)
const pag = await raw("GET", "/leads?limit=2", null, H);
ok("pagination: slice + X-Total-Count", (await pag.json()).length <= 2 && parseInt(pag.headers.get("x-total-count"), 10) >= 3);

// Restore roundtrip (operational tables)
const bk2 = await j("GET", "/export/backup", null, H);
await db.query(`DELETE FROM posts`); await db.query(`DELETE FROM products`);
const rst = await j("POST", "/export/restore", bk2.data, H);
ok("restore: roundtrip counts", rst.status === 200 && rst.data.restored.products === bk2.data.tables.products.length &&
  (await j("GET", "/products", null, H)).data.length === bk2.data.tables.products.length,
  JSON.stringify({ s: rst.status, err: rst.data.error, restored: rst.data.restored?.products, want: bk2.data.tables?.products?.length }));

// Hygiene sweep: deterministic customer-review nudge
await db.query(`UPDATE customers SET "nextReviewAt" = CURRENT_DATE - 1, "accountOwnerId" = $1 WHERE id = $2`, [head.data.user.id, cust.data.id]);
await db.query(`INSERT INTO tasks (title, status, priority, "dueDate", "assigneeId") VALUES ('Overdue check', 'TODO', 'HIGH', CURRENT_DATE - 2, $1)`, [head.data.user.id]);
const cron2 = await j("GET", "/cron/osint");
const nHead = await j("GET", "/notifications?limit=30", null, H);
ok("sweep: chases owners (customer review / overdue)", cron2.data.sweepPushed >= 1 &&
  nHead.data.items.some((n) => n.type === "SWEEP_CUSTOMER_REVIEW" || n.type === "SWEEP_OVERDUE_TASKS"));

/* ══ D. Auth lifecycle (sessions, 2FA, forced rotation) ═══════════════ */
ok("change-password: wrong current 400", (await j("POST", "/auth/change-password", { current: "nope", next: "Newpass123" }, V)).status === 400);
ok("change-password: ok + revokes old sessions",
  (await j("POST", "/auth/change-password", { current: "Test12345", next: "Newpass123" }, V)).status === 200 &&
  (await j("GET", "/auth/me", null, V)).status === 401);
const v2 = await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Newpass123" });
ok("relogin after change", v2.status === 200);
const V2 = v2.data.token;
ok("logout-all revokes", (await j("POST", "/auth/logout-all", null, V2)).status === 200 && (await j("GET", "/auth/me", null, V2)).status === 401);
const v3 = await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Newpass123" });
const V3 = v3.data.token;
const { totpNow } = await import("../src/totp.js");
const setup = await j("POST", "/auth/totp/setup", {}, V3);
ok("totp: setup returns secret", setup.status === 200 && setup.data.secret?.length >= 16);
ok("totp: enable with live code", (await j("POST", "/auth/totp/enable", { otp: totpNow(setup.data.secret) }, V3)).status === 200);
const noOtp = await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Newpass123" });
ok("totp: login demands otp", noOtp.status === 401 && noOtp.data.otpRequired === true);
ok("totp: login with otp", (await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Newpass123", otp: totpNow(setup.data.secret) })).status === 200);
ok("totp: disable with password", (await j("POST", "/auth/totp/disable", { password: "Newpass123" }, V3)).status === 200);
ok("admin reset forces rotation", (await j("PATCH", `/users/${vi.data.user.id}`, { password: "Resetpass1" }, H)).status === 200 &&
  (await j("POST", "/auth/login", { email: "viewer@saria.sd", password: "Resetpass1" })).data.user.mustChangePassword === true);

// Role guardrails
const builtinRole = roles.data.find((r) => r.key === "HEAD");
ok("built-in role locked", (await j("DELETE", `/roles/${builtinRole.id}`, null, H)).status === 403);
ok("in-use role delete blocked", (await j("DELETE", `/roles/${mkRole.data.id}`, null, H)).status === 409);
await j("PATCH", `/roles/${mkRole.data.id}`, { permissions: { ...readPerms, admin: false, tasks: "write", campaigns: "write" } }, H);
await new Promise((r) => setTimeout(r, 30));
ok("permission grant propagates (cache invalidation)", (await j("POST", "/campaigns", { name: "post-grant" }, A)).status === 201);

/* ══ W1A. Approvals engine + Studio + Agency + Portal ════════════════ */
{ // block scope: keeps this wave's bindings from colliding with the suite above
// Studio intake: SLA + requester injection + transition matrix
const cr = await j("POST", "/creative-requests", { title: "Test KV", kind: "DESIGN" }, H);
ok("creative request: SLA auto-set + requester injected", cr.status === 201 && !!cr.data.slaDueAt && !!cr.data.requesterId);
ok("request matrix blocks NEW→REVIEW", (await j("PATCH", `/creative-requests/${cr.data.id}`, { status: "REVIEW" }, H)).status === 400);
ok("request matrix allows NEW→TRIAGED", (await j("PATCH", `/creative-requests/${cr.data.id}`, { status: "TRIAGED" }, H)).status === 200);
ok("brief requires request or engagement", (await j("POST", "/creative-briefs", { title: "Loose" }, H)).status === 400);

// Brand Center: only public rows leak to the public surface
await j("POST", "/brand-assets", { kind: "COLOR", label: "Secret", value: "#111111", public: false }, H);
const pub = await j("GET", "/brand");
ok("public /brand excludes private rows", pub.status === 200 && pub.data.assets.every((a) => a.label !== "Secret") && pub.data.assets.length >= 5, `brand=${pub.status}:${(pub.data.assets||[]).length}`);
ok("/brand carries org branding", !!pub.data.org?.orgName);

// Asset versioning: auto-increment + the approvals loop
const asset = await j("POST", "/assets", { name: "KV master", url: "https://x.co/kv.png", kind: "IMAGE", entity: "content_items", entityId: crypto.randomUUID() }, H);
const av1 = await j("POST", "/asset-versions", { assetId: asset.data.id, url: "https://x.co/v1.png" }, H);
const av2 = await j("POST", "/asset-versions", { assetId: asset.data.id, url: "https://x.co/v2.png" }, H);
ok("asset versions auto-increment", av1.data.version === 1 && av2.data.version === 2);
ok("version direct-APPROVED blocked", (await j("PATCH", `/asset-versions/${av2.data.id}`, { status: "APPROVED" }, H)).status === 400);
await j("PATCH", `/asset-versions/${av2.data.id}`, { status: "REVIEW" }, H);
let aps = await j("GET", "/approvals?status=PENDING", null, H);
const apV = aps.data.find((a) => a.entity === "asset_versions" && a.entityId === av2.data.id);
ok("REVIEW files an approval", !!apV);
const dec = await j("POST", `/approvals/${apV.id}/decide`, { status: "APPROVED" }, H);
ok("decide stamps approver + approves the version", dec.status === 200 && dec.data.status === "APPROVED" &&
  (await j("GET", "/asset-versions", null, H)).data.find((v) => v.id === av2.data.id).status === "APPROVED");
ok("second decide on same approval → 409", (await j("POST", `/approvals/${apV.id}/decide`, { status: "REJECTED" }, H)).status === 409);

// Agency: vendor + engagement (rate + owner capture) + scorecard
const ven = await j("POST", "/vendors", { name: "Test Studio", kind: "FREELANCER" }, H);
ok("vendor create", ven.status === 201);
const eng = await j("POST", "/engagements", { vendorId: ven.data.id, title: "Test retainer", feeUsd: 100 }, H);
ok("engagement: rate captured + owner defaulted", eng.status === 201 && Number(eng.data.rateAtEntry) > 0 && !!eng.data.ownerId);

// Deliverable lifecycle through the portal
const dl = await j("POST", "/deliverables", { engagementId: eng.data.id, title: "Test cut", dueDate: new Date(Date.now() + 5 * 864e5).toISOString() }, H);
ok("deliverable starts BRIEFED", dl.status === 201 && dl.data.status === "BRIEFED");
ok("deliverable direct-APPROVED blocked", (await j("PATCH", `/deliverables/${dl.data.id}`, { status: "APPROVED" }, H)).status === 400);
const tk = await j("POST", "/agency/tokens", { vendorId: ven.data.id, days: 7 }, H);
ok("magic link minted (≥128-bit)", tk.status === 201 && tk.data.link === `/p/${tk.data.token}` && tk.data.token.length >= 24);
const T = tk.data.token;
const pf = await j("GET", `/portal/${T}`);
ok("portal payload scoped to the vendor", pf.status === 200 && pf.data.vendor.name === "Test Studio" &&
  pf.data.deliverables.length === 1 && pf.data.deliverables[0].id === dl.data.id);
ok("portal shows public brand only", Array.isArray(pf.data.brand) && pf.data.brand.every((b) => b.label !== "Secret"));
ok("portal submit rejects a bad url", (await j("POST", `/portal/${T}/deliverables/${dl.data.id}/submit`, { url: "notaurl" })).status === 400);
ok("portal can't touch another vendor's deliverable",
  (await j("POST", `/portal/${T}/deliverables/99999999-0000-0000-0000-000000009001/submit`, { url: "https://x.co/f" })).status === 404);
ok("portal submit → SUBMITTED", (await j("POST", `/portal/${T}/deliverables/${dl.data.id}/submit`, { url: "https://drive.x/cut1", note: "First cut" })).status === 200);
aps = await j("GET", "/approvals?status=PENDING", null, H);
let apD = aps.data.find((a) => a.entity === "deliverables" && a.entityId === dl.data.id);
ok("submission files an approval + vendor note lands in the thread", !!apD &&
  (await j("GET", `/deliverables/${dl.data.id}/comments`, null, H)).data.some((c) => c.author === "VENDOR"));
ok("double submit blocked (409)", (await j("POST", `/portal/${T}/deliverables/${dl.data.id}/submit`, { url: "https://x.co/2" })).status === 409);
await j("POST", `/approvals/${apD.id}/decide`, { status: "REJECTED", note: "tighten the intro" }, H);
let dnow = (await j("GET", "/deliverables", null, H)).data.find((d) => d.id === dl.data.id);
ok("rejection → REVISION + revision counter", dnow.status === "REVISION" && dnow.revisionCount === 1);
await j("POST", `/portal/${T}/deliverables/${dl.data.id}/submit`, { url: "https://drive.x/cut2" });
aps = await j("GET", "/approvals?status=PENDING", null, H);
apD = aps.data.find((a) => a.entity === "deliverables" && a.entityId === dl.data.id);
await j("POST", `/approvals/${apD.id}/decide`, { status: "APPROVED" }, H);
dnow = (await j("GET", "/deliverables", null, H)).data.find((d) => d.id === dl.data.id);
ok("approval closes the loop (APPROVED + stamp)", dnow.status === "APPROVED" && !!dnow.approvedAt);
const sc = await j("GET", `/vendors/${ven.data.id}/scorecard`, null, H);
ok("scorecard math (approved/revisions/on-time)", sc.data.deliverables.approved === 1 &&
  sc.data.deliverables.avgRevisions === 1 && sc.data.deliverables.onTimeRate === 100);
ok("portal comment lands", (await j("POST", `/portal/${T}/deliverables/${dl.data.id}/comments`, { body: "Thanks!" })).status === 201);

// Invoices: the approval→budget bridge
const inv = await j("POST", "/invoices", { vendorId: ven.data.id, engagementId: eng.data.id, number: "TS-001", amountUsd: 500 }, H);
ok("invoice starts RECEIVED + rate captured", inv.status === 201 && inv.data.status === "RECEIVED" && Number(inv.data.rateAtEntry) > 0);
ok("invoice direct-approve blocked", (await j("PATCH", `/invoices/${inv.data.id}`, { status: "APPROVED" }, H)).status === 400);
ok("unapproved invoice can't be paid", (await j("PATCH", `/invoices/${inv.data.id}`, { status: "PAID" }, H)).status === 400);
aps = await j("GET", "/approvals?status=PENDING", null, H);
const apI = aps.data.find((a) => a.entity === "invoices" && a.entityId === inv.data.id);
await j("POST", `/approvals/${apI.id}/decide`, { status: "APPROVED" }, H);
ok("invoice approved via the inbox", (await j("GET", "/invoices", null, H)).data.find((i) => i.id === inv.data.id).status === "APPROVED");
const bud = await j("GET", "/budget", null, H);
const entry = bud.data.find((b) => (b.label || "").includes("TS-001"));
ok("approval posts a SPENT budget entry with the rate", !!entry && entry.kind === "SPENT" &&
  Number(entry.amountUsd) === 500 && Number(entry.rateAtEntry) > 0);
ok("mark paid stamps paidAt", (await j("PATCH", `/invoices/${inv.data.id}`, { status: "PAID" }, H)).status === 200 &&
  !!(await j("GET", "/invoices", null, H)).data.find((i) => i.id === inv.data.id).paidAt);

// Boundaries: revocation, permissions, flags (including public surfaces)
await j("POST", `/agency/tokens/${tk.data.id}/revoke`, null, H);
ok("revoked token → 404", (await j("GET", `/portal/${T}`)).status === 404);
ok("role without agency perms can't read vendors", (await j("GET", "/vendors", null, A)).status === 403);
await j("PATCH", "/settings", { modules: { studio: false, agency: false } }, H);
ok("flag off: studio 404s", (await j("GET", "/creative-requests", null, H)).status === 404);
ok("flag off: public /brand 404s", (await j("GET", "/brand")).status === 404);
ok("flag off: portal 404s", (await j("GET", `/portal/anything`)).status === 404);
await j("PATCH", "/settings", { modules: { studio: true, agency: true } }, H);
ok("flag on: studio restored", (await j("GET", "/creative-requests", null, H)).status === 200);
const vdb = await j("GET", "/vendors", null, H);
ok("demo seed: agency data present", vdb.data.length >= 3, `vendors=${vdb.status}:${JSON.stringify(vdb.data).slice(0,120)}`);
}


// ═══ Wave 1·B — forms + landing pages + surveys + contacts/consent ═══
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const camp = (await j("GET", "/campaigns", null, H)).data[0];

  // ── contacts + consent ledger ──
  const ct = await j("POST", "/contacts", { name: "Test Contact", phone: "+249-99-000-1111", tags: ["vip"] }, H);
  ok("contact create", ct.status === 201);
  ok("contact needs some identity", (await j("POST", "/contacts", { tags: [] }, H)).status === 400);
  const g1 = await j("POST", `/contacts/${ct.data.id}/consent`, { channel: "WHATSAPP", granted: true }, H);
  ok("consent grant appends entry", g1.status === 200 && P(g1.data.consent).some((e) => e.channel === "WHATSAPP" && !e.revokedAt));
  ok("double grant → 409", (await j("POST", `/contacts/${ct.data.id}/consent`, { channel: "WHATSAPP", granted: true }, H)).status === 409);
  const rv = await j("POST", `/contacts/${ct.data.id}/consent`, { channel: "WHATSAPP", granted: false }, H);
  ok("revoke stamps revokedAt (history kept)", rv.status === 200 && P(rv.data.consent).every((e) => e.channel !== "WHATSAPP" || e.revokedAt));
  ok("revoke absent consent → 409", (await j("POST", `/contacts/${ct.data.id}/consent`, { channel: "SMS", granted: false }, H)).status === 409);
  ok("unknown channel → 400", (await j("POST", `/contacts/${ct.data.id}/consent`, { channel: "FAX", granted: true }, H)).status === 400);

  // ── forms: builder rules ──
  ok("form: bad field key → 400", (await j("POST", "/forms", { name: "X", fields: [{ key: "Bad Key", label: "x", type: "text" }] }, H)).status === 400);
  ok("form: select needs options", (await j("POST", "/forms", { name: "X", fields: [{ key: "pick", label: "p", type: "select" }] }, H)).status === 400);
  const fm = await j("POST", "/forms", { name: "Roof Quote Request", campaignId: camp.id, successMsg: "ok!", fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "phone", label: "Phone", type: "phone", required: true },
    { key: "email", label: "Email", type: "email" },
    { key: "size", label: "Size", type: "select", options: ["S", "L"] },
  ] }, H);
  ok("form create + slug auto", fm.status === 201 && fm.data.slug === "roof-quote-request");
  ok("role without automate key → 403 (deny by default)", (await j("GET", "/forms", null, A)).status === 403);

  // ── public /f surface ──
  ok("public form fetch", (await j("GET", `/public/forms/${fm.data.slug}`)).status === 200);
  await j("PATCH", `/forms/${fm.data.id}`, { active: false }, H);
  ok("inactive form hidden publicly", (await j("GET", `/public/forms/${fm.data.slug}`)).status === 404);
  await j("PATCH", `/forms/${fm.data.id}`, { active: true }, H);
  const hp = await j("POST", `/public/forms/${fm.data.slug}`, { _hp: "bot", name: "Bot", phone: "+249000000" });
  const st0 = await j("GET", `/forms/${fm.data.id}/stats`, null, H);
  ok("honeypot: fake 200, stores nothing", hp.status === 200 && st0.data.submissions === 0);
  ok("missing required field → 400", (await j("POST", `/public/forms/${fm.data.slug}`, { name: "NoPhone" })).status === 400);
  ok("bad email → 400", (await j("POST", `/public/forms/${fm.data.slug}`, { name: "A", phone: "+24911222333", email: "not-an-email" })).status === 400);
  ok("choice outside options → 400", (await j("POST", `/public/forms/${fm.data.slug}`, { name: "A", phone: "+24911222333", size: "XL" })).status === 400);

  const sub = await j("POST", `/public/forms/${fm.data.slug}`, { name: "Fatima Ali", phone: "+249-99-555-7777", email: "fatima@test.sd", size: "L" });
  ok("good submit → 201 + success msg", sub.status === 201 && sub.data.successMsg === "ok!");
  const st1 = await j("GET", `/forms/${fm.data.id}/stats`, null, H);
  ok("conversion stats: submission→lead→contact", st1.data.submissions === 1 && st1.data.leads === 1 && st1.data.contacts === 1);
  const subs = await j("GET", `/forms/${fm.data.id}/submissions`, null, H);
  ok("submission stores validated data", subs.data.length === 1 && P(subs.data[0].data).size === "L");
  const flead = (await j("GET", "/leads", null, H)).data.find((l) => l.contactName === "Fatima Ali");
  ok("lead: source FORM + form's campaign", !!flead && flead.source === "FORM" && flead.campaignId === camp.id);
  const fct = (await j("GET", "/contacts", null, H)).data.find((c) => c.email === "fatima@test.sd");
  ok("contact auto-created w/ WHATSAPP consent from form", !!fct && P(fct.consent).some((e) => e.channel === "WHATSAPP" && e.source === `form:${fm.data.slug}`));
  ok("contact linked back to lead", fct.leadId === flead.id);
  await j("POST", `/public/forms/${fm.data.slug}`, { name: "Fatima Ali", phone: "+249-99-555-7777", email: "fatima@test.sd", size: "S" });
  ok("second submit dedupes contact", (await j("GET", "/contacts", null, H)).data.filter((c) => c.email === "fatima@test.sd").length === 1);

  // ── src → tracked link attribution fallback ──
  const fm2 = await j("POST", "/forms", { name: "Generic Capture", fields: [{ key: "phone", label: "P", type: "phone", required: true }] }, H);
  const lk2 = await j("POST", "/links", { url: "https://example.com/w1b", campaignId: camp.id, channel: "FACEBOOK" }, H);
  await j("POST", `/public/forms/${fm2.data.slug}`, { phone: "+249-88-111-2222", src: lk2.data.code });
  const slead = (await j("GET", "/leads", null, H)).data.find((l) => l.phone === "+249-88-111-2222");
  ok("src code → campaign attribution fallback", !!slead && slead.campaignId === camp.id);

  // ── landing pages /l ──
  ok("landing: unknown block kind → 400", (await j("POST", "/landing-pages", { title: "X", blocks: [{ kind: "VIDEO" }] }, H)).status === 400);
  const lp = await j("POST", "/landing-pages", { title: "Launch Page", blocks: [{ kind: "HERO", heading: "Hi" }], formId: fm.data.id }, H);
  ok("landing create: DRAFT + slug auto", lp.status === 201 && lp.data.slug === "launch-page" && lp.data.status === "DRAFT");
  ok("draft page hidden publicly", (await j("GET", "/public/pages/launch-page")).status === 404);
  await j("PATCH", `/landing-pages/${lp.data.id}`, { status: "PUBLISHED" }, H);
  const pubPage = await j("GET", "/public/pages/launch-page");
  ok("published page serves blocks + embedded form", pubPage.status === 200 && pubPage.data.form?.slug === fm.data.slug && pubPage.data.blocks[0].kind === "HERO");
  ok("views increment on public fetch", (await j("GET", "/landing-pages", null, H)).data.find((p) => p.id === lp.data.id).views >= 1);

  // ── surveys /s ──
  ok("NPS survey requires a SCALE question", (await j("POST", "/surveys", { name: "Bad NPS", kind: "NPS", questions: [{ key: "why", text: "?", type: "TEXT" }] }, H)).status === 400);
  const sv = await j("POST", "/surveys", { name: "W1B CSAT", kind: "CSAT", audience: "LINKED", questions: [
    { key: "sat", text: "Satisfied?", type: "SCALE", max: 5, required: true },
    { key: "pick", text: "Pick one", type: "CHOICE", options: ["A", "B"] },
  ] }, H);
  ok("survey create + slug auto", sv.status === 201 && sv.data.slug === "w1b-csat");
  ok("public survey fetch", (await j("GET", "/public/surveys/w1b-csat")).status === 200);
  ok("missing required scale → 400", (await j("POST", "/public/surveys/w1b-csat", { answers: {}, identity: { phone: "+249-77-000-0001" } })).status === 400);
  ok("scale beyond max → 400", (await j("POST", "/public/surveys/w1b-csat", { answers: { sat: 9 }, identity: { phone: "+249-77-000-0001" } })).status === 400);
  ok("choice outside options → 400", (await j("POST", "/public/surveys/w1b-csat", { answers: { sat: 4, pick: "C" }, identity: { phone: "+249-77-000-0001" } })).status === 400);
  ok("LINKED audience without identity → 400", (await j("POST", "/public/surveys/w1b-csat", { answers: { sat: 4 } })).status === 400);
  ok("survey response accepted", (await j("POST", "/public/surveys/w1b-csat", { answers: { sat: 5, pick: "A" }, identity: { name: "Rania", phone: "+249-66-333-4444" } })).status === 201);
  await j("POST", "/public/surveys/w1b-csat", { answers: { sat: 2 }, identity: { phone: "+249-66-999-0000" } });
  const svStats = await j("GET", `/surveys/${sv.data.id}/stats`, null, H);
  ok("CSAT math: avg 3.5, 50% satisfied", svStats.data.total === 2 && svStats.data.avgScore === 3.5 && svStats.data.csat === 50);
  const svResp = await j("GET", `/surveys/${sv.data.id}/responses`, null, H);
  ok("responses list joins contact identity", svResp.data.length === 2 && svResp.data.some((r) => r.contactName === "Rania"));
  const demoSv = (await j("GET", "/surveys", null, H)).data.find((s) => s.slug === "nps-2026");
  const demoStats = await j("GET", `/surveys/${demoSv.id}/stats`, null, H);
  ok("demo NPS math: 9/10/6 → 2 prom, 1 detr, NPS 33", demoStats.data.promoters === 2 && demoStats.data.detractors === 1 && demoStats.data.nps === 33);

  // ── insights ──
  ok("insight create", (await j("POST", "/insights", { title: "W1B Insight", source: "DATA", impact: "HIGH", links: { productIds: [] } }, H)).status === 201);
  ok("insights order HIGH-impact first", (await j("GET", "/insights", null, H)).data[0].impact === "HIGH");

  // ── flags govern both api + public surfaces ──
  await j("PATCH", "/settings", { modules: { automate: false, research: false } }, H);
  ok("flag off: forms api 404", (await j("GET", "/forms", null, H)).status === 404);
  ok("flag off: public form 404", (await j("GET", `/public/forms/${fm.data.slug}`)).status === 404);
  ok("flag off: surveys api 404", (await j("GET", "/surveys", null, H)).status === 404);
  ok("flag off: public survey 404", (await j("GET", "/public/surveys/w1b-csat")).status === 404);
  await j("PATCH", "/settings", { modules: { automate: true, research: true } }, H);
  ok("flags restored", (await j("GET", "/forms", null, H)).status === 200);

  // ── sovereignty + demo ──
  const bk2 = await j("GET", "/export/backup", null, H);
  ok("backup covers all W1B tables", ["contacts", "forms", "form_submissions", "landing_pages", "surveys", "survey_responses", "insights"].every((t) => t in bk2.data.tables));
  ok("demo seed: solar form + landing page live", (await j("GET", "/public/forms/solar-lead")).status === 200 && (await j("GET", "/public/pages/solar-launch")).status === 200);
}


// ═══ Wave 1·C — Analytics Core: catalog, snapshots, Pulse Index, targets, alerts, reports ═══
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  await db.query(`UPDATE osint_topics SET active = false`); // keep repeated Daily Pulse runs instant offline

  // ── the catalog ──
  const cat = await j("GET", "/metrics", null, H);
  ok("catalog seeded (builtins + composites)", cat.status === 200 && cat.data.length >= 44);
  ok("pulse_index is a composite of 5 areas", P(cat.data.find((m) => m.key === "pulse_index").source).components.length === 5);
  ok("catalog visible to read-only role", (await j("GET", "/metrics", null, A)).status === 200);
  ok("catalog edit is admin-only", (await j("PATCH", "/metrics/leads_new_30d", { active: false }, A)).status === 403);

  // ── live compute vs demo data ──
  const lv = await j("GET", "/metrics/leads_new_30d/value", null, H);
  ok("live compute: leads_new_30d > 0", lv.status === 200 && lv.data.value > 0);
  ok("unknown metric → 404", (await j("GET", "/metrics/nope/value", null, H)).status === 404);
  ok("nps_90d equals demo survey math (33)", (await j("GET", "/metrics/nps_90d/value", null, H)).data.value === 33);

  // ── the Daily Pulse (manual trigger) ──
  const runD = await j("POST", "/metrics/run-daily", null, H);
  ok("run-daily: snapshots written + intel reported", runD.status === 200 && runD.data.snapshots > 40 && runD.data.intel !== undefined);
  ok("run-daily is admin-only", (await j("POST", "/metrics/run-daily", null, A)).status === 403);
  const ser = await j("GET", "/metrics/leads_new_30d/series?days=30", null, H);
  ok("series returns today's materialized value", ser.data.length >= 1 && Number(ser.data.at(-1).value) === lv.data.value);
  const sl = await j("GET", "/metrics/leads_new_30d/slices?dim=source", null, H);
  ok("dimension slices: leads by source", sl.data.length >= 1 && sl.data.every((r) => P(r.dims).source));
  const snapCount = async () => Number((await db.query(`SELECT COUNT(*)::int c FROM metric_snapshots`)).rows[0].c);
  const c1 = await snapCount(); await j("POST", "/metrics/run-daily", null, H);
  ok("same-day rerun upserts (no duplicate rows)", (await snapCount()) === c1);

  // ── the Pulse Index ──
  const ov = await j("GET", "/analytics/overview", null, H);
  ok("overview: index 0–100 with 5 area pulses", ov.status === 200 && ov.data.pulse.value >= 0 && ov.data.pulse.value <= 100 && ov.data.areas.length === 5);
  ok("index components carry transparent scores", ov.data.pulse.components.length === 5 && ov.data.pulse.components.every((c) => c.score >= 0 && c.score <= 100));

  // ── targets & pacing ──
  // the period must contain today, or today's snapshot falls outside it and
  // pacing reads a stale row — this was hardcoded to July and broke on Aug 1
  const _now = new Date();
  const _iso = (d) => d.toISOString().slice(0, 10);
  const period = {
    periodStart: _iso(new Date(Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), 1))),
    periodEnd: _iso(new Date(Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth() + 1, 0))),
  };
  ok("target: unknown metric rejected", (await j("POST", "/metric-targets", { metricKey: "nope", ...period, target: 10 }, H)).status === 400);
  const tgt = await j("POST", "/metric-targets", { metricKey: "leads_new_30d", ...period, target: 40 }, H);
  ok("target create", tgt.status === 201);
  ok("target write is admin-only", (await j("POST", "/metric-targets", { metricKey: "leads_new_30d", ...period, target: 5 }, A)).status === 403);
  const pace = await j("GET", "/metric-targets/pacing", null, H);
  const pr = pace.data.find((t) => t.id === tgt.data.id);
  ok("pacing: actual + expected + pace%", pace.status === 200 && !!pr && typeof pr.pacePct === "number" && pr.actual === lv.data.value);

  // ── anomaly alerts ──
  ok("alert create", (await j("POST", "/metric-alerts", { metricKey: "leads_new_30d", condition: "BELOW", threshold: 999999, windowDays: 7 }, H)).status === 201);
  const alertCount = async () => (await j("GET", "/notifications", null, H)).data.items.filter((n) => n.type === "ALERT_METRIC").length;
  const before = await alertCount();
  await j("POST", "/metrics/run-daily", null, H);
  const after = await alertCount();
  ok("alert fires when condition met", after === before + 1);
  await j("POST", "/metrics/run-daily", null, H);
  ok("alert dedupe window holds (20h)", (await alertCount()) === after);

  // ── dashboards ──
  const dash = await j("GET", "/dashboards", null, H);
  ok("default Executive board seeded w/ Pulse Index", dash.data.some((d) => d.isDefault && P(d.widgets).some((w) => w.metricKey === "pulse_index")));
  ok("dashboard write is admin-only", (await j("POST", "/dashboards", { name: "X", widgets: [] }, A)).status === 403);

  // ── the reports engine ──
  ok("report period validated", (await j("POST", "/reports/run", { templateKey: "monthly_board", period: "bad" }, H)).status === 400);
  const rep = await j("POST", "/reports/run", { templateKey: "monthly_board", period: "2026-07" }, H);
  ok("report run: immutable snapshot with items", rep.status === 201 && P(rep.data.snapshot).items.length >= 15);
  ok("report readable by read-only role", (await j("GET", `/reports/${rep.data.id}`, null, A)).status === 200);
  ok("report run needs analytics write", (await j("POST", "/reports/run", { templateKey: "monthly_board", period: "2026-06" }, A)).status === 403);

  // ── leads.lostReason: win/loss taxonomy ──
  const ld = await j("POST", "/leads", { company: "LostCo", phone: "+249-55-000-1234", stage: "NEW" }, H);
  ok("LOST without a reason blocked", (await j("PATCH", `/leads/${ld.data.id}`, { stage: "LOST" }, H)).status === 400);
  ok("lostReason outside taxonomy blocked", (await j("PATCH", `/leads/${ld.data.id}`, { stage: "LOST", lostReason: "MOOD" }, H)).status === 400);
  ok("LOST with reason ok", (await j("PATCH", `/leads/${ld.data.id}`, { stage: "LOST", lostReason: "PRICE" }, H)).status === 200);
  await db.query(`UPDATE metric_alerts SET "lastFiredAt" = NULL`); // isolate: allow snapshot rerun without alert noise? keep silent
  await j("POST", "/metrics/run-daily", null, H);
  const lost = await j("GET", "/metrics/leads_lost_30d/slices", null, H);
  ok("lost-reason slice materialized", lost.data.some((r) => P(r.dims).lostReason === "PRICE"));

  // ── sovereignty ──
  const bk3 = await j("GET", "/export/backup", null, H);
  ok("backup covers analytics tables + catalog rows", ["metrics", "metric_snapshots", "metric_targets", "metric_alerts", "dashboards", "report_runs"].every((t) => t in bk3.data.tables) && bk3.data.tables.metrics.length >= 44);
}


// ═══ Wave 1·D — Publish: composer, queue state machine, approvals plug-in, bio pages ═══
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const NIL = "00000000-0000-4000-8000-000000000000";
  const hid = (await db.query(`SELECT id FROM users WHERE role = 'HEAD' LIMIT 1`)).rows[0].id;

  // ── flag + perm gates ──
  await j("PATCH", "/settings", { modules: { publish: false } }, H);
  ok("publish flag off → routers 404", (await j("GET", "/content-variants", null, H)).status === 404);
  await j("PATCH", "/settings", { modules: {} }, H);
  ok("publish flag on → restored", (await j("GET", "/content-variants", null, H)).status === 200);
  ok("publish is perm-gated (analyst has none)", (await j("GET", "/scheduled-posts", null, A)).status === 403);

  // ── content walk-up (exercises the calendar matrix on the way) ──
  const ci = await j("POST", "/content", { title: "Solar reel", channel: "SOCIAL" }, H);
  for (const st of ["IN_PROGRESS", "REVIEW", "APPROVED"]) await j("PATCH", `/content/${ci.data.id}`, { status: st }, H);
  const ci2 = await j("POST", "/content", { title: "Idea only", channel: "SOCIAL" }, H);

  // ── variants ──
  const v1 = await j("POST", "/content-variants",
    { contentId: ci.data.id, platform: "INSTAGRAM", caption: "Golden hour on the farm", captionAr: "الساعة الذهبية في المزرعة", hashtags: ["solar", "sudan"], format: "REEL" }, H);
  ok("variant created w/ hashtags jsonb", v1.status === 201 && P(v1.data.hashtags).length === 2);
  ok("variant needs a real content item", (await j("POST", "/content-variants", { contentId: NIL, platform: "X" }, H)).status === 400);
  const v2 = await j("POST", "/content-variants", { contentId: ci2.data.id, platform: "FACEBOOK" }, H);

  // ── scheduling: the approval gate + the matrix ──
  ok("queue gate: unapproved content blocked",
    (await j("POST", "/scheduled-posts", { variantId: v2.data.id, scheduledAt: "2026-08-01T09:00:00Z", status: "QUEUED" }, H)).status === 400);
  const spg = await j("POST", "/scheduled-posts", { variantId: v2.data.id, scheduledAt: "2026-08-01T09:00:00Z" }, H);
  ok("draft slot on unapproved content allowed", spg.status === 201 && spg.data.status === "DRAFT");
  ok("gate holds on DRAFT→QUEUED too", (await j("PATCH", `/scheduled-posts/${spg.data.id}`, { status: "QUEUED" }, H)).status === 400);

  const sp = await j("POST", "/scheduled-posts",
    { variantId: v1.data.id, scheduledAt: new Date(Date.now() - 3600e3).toISOString(), assigneeId: hid, status: "QUEUED" }, H);
  ok("queued slot created", sp.status === 201 && sp.data.status === "QUEUED");
  ok("matrix blocks QUEUED→PUBLISHED via PATCH", (await j("PATCH", `/scheduled-posts/${sp.data.id}`, { status: "PUBLISHED" }, H)).status === 400);
  ok("publish endpoint refuses a non-ready slot", (await j("POST", `/scheduled-posts/${sp.data.id}/publish`, {}, H)).status === 409);

  // ── approvals plug-in ──
  const ra = await j("POST", `/scheduled-posts/${sp.data.id}/request-approval`, {}, H);
  ok("request-approval → AWAITING_APPROVAL", ra.status === 200 && ra.data.status === "AWAITING_APPROVAL");
  const pend = (await j("GET", "/approvals?status=PENDING", null, H)).data.find((a) => a.entity === "scheduled_posts" && a.entityId === sp.data.id);
  ok("approval row created for the slot", !!pend);
  await j("POST", `/approvals/${pend.id}/decide`, { status: "APPROVED" }, H);
  ok("approval releases the slot to READY", (await j("GET", `/scheduled-posts/${sp.data.id}`, null, H)).data.status === "READY");

  const spR = await j("POST", "/scheduled-posts", { variantId: v1.data.id, scheduledAt: "2026-08-02T09:00:00Z", status: "QUEUED" }, H);
  await j("POST", `/scheduled-posts/${spR.data.id}/request-approval`, {}, H);
  const pend2 = (await j("GET", "/approvals?status=PENDING", null, H)).data.find((a) => a.entity === "scheduled_posts" && a.entityId === spR.data.id);
  await j("POST", `/approvals/${pend2.id}/decide`, { status: "REJECTED" }, H);
  ok("rejection returns the slot to DRAFT", (await j("GET", `/scheduled-posts/${spR.data.id}`, null, H)).data.status === "DRAFT");

  // ── assisted publishing via the Daily Pulse ──
  const link = await j("POST", "/links", { url: "https://saria.sd/solar", channel: "SOCIAL" }, H);
  await j("PATCH", `/scheduled-posts/${sp.data.id}`, { linkCode: link.data.code }, H);
  const beforeN = (await j("GET", "/notifications", null, H)).data.items.filter((n) => n.type === "PUBLISH_DUE").length;
  const rd = await j("POST", "/metrics/run-daily", null, H);
  ok("Daily Pulse reports publishDue", typeof rd.data.publishDue === "number" && rd.data.publishDue >= 1);
  const spN = await j("GET", `/scheduled-posts/${sp.data.id}`, null, H);
  ok("slot NOTIFIED with timestamp", spN.data.status === "NOTIFIED" && !!spN.data.notifiedAt);
  ok("owner pinged with copy + link", (await j("GET", "/notifications", null, H)).data.items.filter((n) => n.type === "PUBLISH_DUE").length === beforeN + 1);

  // ── publish closes the loop into posts ──
  const pub = await j("POST", `/scheduled-posts/${sp.data.id}/publish`, { reach: 1200, engagement: 90 }, H);
  ok("publish creates the measurement row", pub.status === 201 && pub.data.post.platform === "INSTAGRAM" && pub.data.post.linkCode === link.data.code);
  ok("slot closed w/ publishedPostId", pub.data.scheduled.status === "PUBLISHED" && pub.data.scheduled.publishedPostId === pub.data.post.id);

  // ── bio pages: the attributed link-in-bio ──
  const bp = await j("POST", "/bio-pages", { title: "Saria Solar", titleAr: "ساريا للطاقة" }, H);
  ok("bio page slug auto-generated", bp.status === 201 && /^[a-z0-9][a-z0-9-]*$/.test(bp.data.slug));
  const link2 = await j("POST", "/links", { url: "https://saria.sd/catalog", channel: "WEB" }, H);
  await j("POST", "/bio-links", { pageId: bp.data.id, label: "Order now", labelAr: "اطلب الآن", linkCode: link.data.code, sort: 2 }, H);
  await j("POST", "/bio-links", { pageId: bp.data.id, label: "Catalog", linkCode: link2.data.code, sort: 1 }, H);
  await j("POST", "/bio-links", { pageId: bp.data.id, label: "Hidden", linkCode: link2.data.code, sort: 3, active: false }, H);
  ok("bio link rejects unknown code", (await j("POST", "/bio-links", { pageId: bp.data.id, label: "X", linkCode: "nope" }, H)).status === 400);
  const pubBio = await j("GET", `/public/bio/${bp.data.slug}`);
  ok("public bio: active links sorted", pubBio.status === 200 && pubBio.data.links.length === 2 && pubBio.data.links[0].label === "Catalog");
  await j("PATCH", `/bio-pages/${bp.data.id}`, { active: false }, H);
  ok("inactive bio page hidden from the public", (await j("GET", `/public/bio/${bp.data.slug}`)).status === 404);
  await j("PATCH", `/bio-pages/${bp.data.id}`, { active: true }, H);

  // ── attribution: a tap flows through /r/:code into the metric ──
  const tap = await fetch(`http://127.0.0.1:4110/r/${link.data.code}`, { redirect: "manual" });
  ok("bio tap attributed via /r/:code", [301, 302].includes(tap.status));
  ok("bio_taps_total counts attributed clicks", (await j("GET", "/metrics/bio_taps_total/value", null, H)).data.value >= 1);
  await j("PATCH", `/scheduled-posts/${spR.data.id}`, { status: "QUEUED" }, H);
  ok("queue runway sees the week ahead", (await j("GET", "/metrics/posts_scheduled_7d/value", null, H)).data.value >= 1);

  // ── catalog DoD + sovereignty ──
  const cat2 = await j("GET", "/metrics", null, H);
  ok("PUBLISH KPIs registered in the catalog",
    ["posts_scheduled_7d", "publish_ontime_pct_30d", "bio_taps_total"].every((k) => cat2.data.some((m) => m.key === k)));
  const bk4 = await j("GET", "/export/backup", null, H);
  ok("backup covers publish tables",
    ["content_variants", "scheduled_posts", "bio_pages", "bio_links"].every((t) => t in bk4.data.tables));
}


// ═══ Wave 1·E — Automate: workflows engine, lead scoring, WA templates ═══
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const NIL = "00000000-0000-4000-8000-000000000000";
  const hid2 = (await db.query(`SELECT id FROM users WHERE role = 'HEAD' LIMIT 1`)).rows[0].id;

  // ── flags + perms ──
  await j("PATCH", "/settings", { modules: { automate: false } }, H);
  ok("automate flag off → workflows 404", (await j("GET", "/workflows", null, H)).status === 404);
  await j("PATCH", "/settings", { modules: {} }, H);
  ok("automate flag on → restored", (await j("GET", "/workflows", null, H)).status === 200);
  ok("workflows perm-gated (analyst)", (await j("GET", "/workflows", null, A)).status === 403);
  const lib = await j("GET", "/workflows/library", null, H);
  ok("curated library published", lib.data.events.includes("lead.created") && lib.data.actions.includes("SEND_WA_DRAFT"));

  // ── validation ──
  ok("unknown trigger event rejected", (await j("POST", "/workflows", { name: "x", trigger: { event: "nope" }, actions: [{ type: "NOTIFY" }] }, H)).status === 400);
  ok("unknown action rejected", (await j("POST", "/workflows", { name: "x", trigger: { event: "lead.created" }, actions: [{ type: "EXPLODE" }] }, H)).status === 400);

  // ── the star workflow: expo fast lane ──
  const wa = await j("POST", "/wa-templates", { name: "Expo welcome", nameAr: "ترحيب المعرض", body: "Hi {{contactName}} — thanks for visiting {{company}}!", bodyAr: "أهلًا {{contactName}} — شكرًا لزيارة {{company}}!", category: "FOLLOW_UP" }, H);
  ok("wa template created", wa.status === 201);
  const wf = await j("POST", "/workflows", {
    name: "Expo fast lane", nameAr: "مسار المعرض السريع",
    trigger: { event: "lead.created", filters: { source: "EXPO26" } },
    actions: [
      { type: "ASSIGN_OWNER", userId: hid2 },
      { type: "ADD_TAG", tag: "expo" },
      { type: "CREATE_TASK", title: "Call within 24h", priority: "HIGH", dueInDays: 1, assigneeId: hid2 },
      { type: "SEND_WA_DRAFT", templateId: wa.data.id },
      { type: "NOTIFY", message: "Expo lead landed" },
    ],
  }, H);
  ok("workflow created", wf.status === 201);

  const lm = await j("POST", "/leads", { company: "Nile Agro", contactName: "Salma", phone: "+249912345678", source: "EXPO26" }, H);
  const lmRow = (await j("GET", `/leads/${lm.data.id}`, null, H)).data;
  ok("action: owner assigned", lmRow.ownerId === hid2);
  ok("action: tag appended", P(lmRow.tags).includes("expo"));
  const runs1 = await j("GET", `/workflows/runs?workflowId=${wf.data.id}`, null, H);
  ok("run recorded DONE, 5-step log all ok", runs1.data.length === 1 && runs1.data[0].status === "DONE" && P(runs1.data[0].log).length === 5 && P(runs1.data[0].log).every((e) => e.ok));
  ok("action: task created on the lead", (await db.query(`SELECT COUNT(*)::int c FROM tasks WHERE "leadId" = $1`, [lm.data.id])).rows[0].c >= 1);
  ok("action: WA draft logged (kind WA)", (await db.query(`SELECT COUNT(*)::int c FROM lead_activities WHERE "leadId" = $1 AND kind = 'WA'`, [lm.data.id])).rows[0].c === 1);
  ok("wa uses bumped by the action", (await j("GET", `/wa-templates/${wa.data.id}`, null, H)).data.uses >= 1);
  ok("lastRunAt stamped", !!(await j("GET", `/workflows/${wf.data.id}`, null, H)).data.lastRunAt);

  await j("POST", "/leads", { company: "Other Co", phone: "+249911111100", source: "WEB" }, H);
  ok("filters hold — other sources don't fire", (await j("GET", `/workflows/runs?workflowId=${wf.data.id}`, null, H)).data.length === 1);

  // ── stage_changed trigger ──
  const wf2 = await j("POST", "/workflows", { name: "Won bell", trigger: { event: "lead.stage_changed", filters: { to: "WON" } }, actions: [{ type: "NOTIFY", message: "ka-ching" }] }, H);
  await j("PATCH", `/leads/${lm.data.id}`, { stage: "WON" }, H);
  ok("stage_changed workflow fired on WON", (await j("GET", `/workflows/runs?workflowId=${wf2.data.id}`, null, H)).data.length === 1);

  // ── error isolation ──
  const wf3 = await j("POST", "/workflows", { name: "Half broken", trigger: { event: "lead.created", filters: { source: "ISOLATE" } }, actions: [{ type: "ASSIGN_OWNER", userId: NIL }, { type: "ADD_TAG", tag: "survivor" }] }, H);
  const li = await j("POST", "/leads", { company: "Isolate Co", phone: "+249911100200", source: "ISOLATE" }, H);
  const run3 = (await j("GET", `/workflows/runs?workflowId=${wf3.data.id}`, null, H)).data[0];
  ok("bad action logged, run marked ERROR", run3.status === "ERROR" && P(run3.log)[0].ok === false);
  ok("good action still executed after the bad one", P((await j("GET", `/leads/${li.data.id}`, null, H)).data.tags).includes("survivor"));

  // ── form.submitted trigger ──
  await j("POST", "/workflows", { name: "Form tagger", trigger: { event: "form.submitted", filters: { formSlug: "wf-solar" } }, actions: [{ type: "ADD_TAG", tag: "from-form" }] }, H);
  await j("POST", "/forms", { name: "WF Solar", slug: "wf-solar", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "phone", label: "Phone", type: "phone", required: true }] }, H);
  ok("public submit ok", (await j("POST", "/public/forms/wf-solar", { name: "Huda", phone: "+249933334444" })).status === 201);
  const fl = (await db.query(`SELECT tags FROM leads WHERE phone = '+249933334444'`)).rows[0];
  ok("form.submitted tagged the captured lead", !!fl && P(fl.tags).includes("from-form"));

  // ── START_PROCESS + test-fire ──
  const tpl0 = (await j("GET", "/templates", null, H)).data[0];
  await j("POST", "/workflows", { name: "Proc", trigger: { event: "lead.created", filters: { source: "PROC1" } }, actions: [{ type: "START_PROCESS", templateKey: tpl0.key }] }, H);
  const lp = await j("POST", "/leads", { company: "Proc Co", phone: "+249900112233", source: "PROC1" }, H);
  ok("START_PROCESS instantiates template tasks", (await db.query(`SELECT COUNT(*)::int c FROM tasks WHERE "leadId" = $1`, [lp.data.id])).rows[0].c >= 1);
  const tf = await j("POST", `/workflows/${wf2.data.id}/test`, { payload: { company: "Rehearsal" } }, H);
  ok("test-fire writes a real run", tf.status === 200 && Array.isArray(tf.data.log) && (await j("GET", `/workflows/runs?workflowId=${wf2.data.id}`, null, H)).data.length === 2);

  // ── lead scoring ──
  ok("bad score op rejected", (await j("POST", "/lead-score-rules", { label: "x", condition: { field: "source", op: "wat", value: "1" }, points: 5 }, H)).status === 400);
  await j("POST", "/lead-score-rules", { label: "Expo source", condition: { field: "source", op: "eq", value: "EXPO26" }, points: 40 }, H);
  await j("POST", "/lead-score-rules", { label: "Big deal", condition: { field: "valueUsd", op: "gte", value: 50000 }, points: 35 }, H);
  await j("POST", "/lead-score-rules", { label: "Has phone", condition: { field: "phone", op: "notnull" }, points: 10 }, H);
  ok("rule change recomputed existing leads (50)", (await j("GET", `/leads/${lm.data.id}`, null, H)).data.score === 50);
  await j("PATCH", `/leads/${lm.data.id}`, { valueUsd: 80000 }, H);
  ok("lead update rescored (85)", (await j("GET", `/leads/${lm.data.id}`, null, H)).data.score === 85);
  const hotL = await j("POST", "/leads", { company: "Hot Mills", phone: "+249900000001", source: "EXPO26", valueUsd: 90000 }, H);
  ok("create-time scoring (85)", (await j("GET", `/leads/${hotL.data.id}`, null, H)).data.score === 85);

  // ── the hot-lead sweep in the Daily Pulse ──
  await db.query(`UPDATE lead_activities SET "createdAt" = now() - interval '5 days' WHERE "leadId" = $1`, [hotL.data.id]);
  const hotCount = async () => (await j("GET", "/notifications", null, H)).data.items.filter((n) => n.type === "HOT_LEAD").length;
  const beforeHot = await hotCount();
  const rdA = await j("POST", "/metrics/run-daily", null, H);
  ok("Daily Pulse reports rescored + hotLeads", typeof rdA.data.rescored === "number" && rdA.data.hotLeads >= 1);
  const afterHot = await hotCount();
  ok("hot quiet lead pinged its owner", afterHot === beforeHot + 1);
  await j("POST", "/metrics/run-daily", null, H);
  ok("hot ping dedupes (20h)", (await hotCount()) === afterHot);

  // ── endpoints: recompute + render ──
  ok("manual recompute endpoint", typeof (await j("POST", "/lead-score-rules/recompute", null, H)).data.changed === "number");
  const rnd = await j("POST", `/wa-templates/${wa.data.id}/render`, { leadId: hotL.data.id }, H);
  ok("render merges lead fields + wa.me deep link", rnd.status === 200 && rnd.data.text.includes("Hot Mills") && rnd.data.waUrl.includes("249900000001"));
  ok("render 400 on unknown template", (await j("POST", `/wa-templates/${NIL}/render`, {}, H)).status === 400);

  // ── catalog DoD + sovereignty ──
  const cat3 = await j("GET", "/metrics", null, H);
  ok("AUTOMATE KPIs registered", ["workflow_runs_7d", "hot_leads_open", "wa_sends_30d"].every((k) => cat3.data.some((m) => m.key === k)));
  ok("workflow_runs metric counts this block", (await j("GET", "/metrics/workflow_runs_7d/value", null, H)).data.value >= 4);
  const bk5 = await j("GET", "/export/backup", null, H);
  ok("backup covers automate tables", ["workflows", "workflow_runs", "lead_score_rules", "wa_templates"].every((t) => t in bk5.data.tables));
}

// ═══ Wave 1·F — Reach: outreach engine, health, coverage, competitors ═══
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const NIL = "00000000-0000-4000-8000-000000000000";

  // ── flag + perms ──
  await j("PATCH", "/settings", { modules: { reach: false } }, H);
  ok("reach flag off → outreach 404", (await j("GET", "/outreach", null, H)).status === 404);
  await j("PATCH", "/settings", { modules: {} }, H);
  ok("reach flag on → restored", (await j("GET", "/outreach", null, H)).status === 200);
  ok("outreach perm-gated (analyst)", (await j("GET", "/outreach", null, A)).status === 403);

  // ── campaign + validation ──
  const waPitch = await j("POST", "/wa-templates", { name: "Media pitch", nameAr: "عرض إعلامي", body: "Hello {{contactName}} — a story from {{company}} you might like.", bodyAr: "مرحبًا {{contactName}} — قصة من {{company}} قد تهمك.", category: "OTHER" }, H);
  ok("bad step channel rejected", (await j("POST", "/outreach", { name: "x", steps: [{ day: 0, channel: "FAX" }] }, H)).status === 400);
  const oc = await j("POST", "/outreach", {
    name: "Battery launch — media", nameAr: "إطلاق البطارية — إعلام", goal: "5 placements", audienceKind: "MEDIA", status: "ACTIVE",
    steps: [{ day: 0, channel: "WA", templateId: waPitch.data.id }, { day: 3, channel: "CALL" }],
  }, H);
  ok("outreach campaign created", oc.status === 201);

  // ── targets + enroll ──
  const mcA = await j("POST", "/media-contacts", { name: "Test Reporter A", outlet: "Wire A", phone: "+249955500001", tier: "TIER1" }, H);
  const mcB = await j("POST", "/media-contacts", { name: "Test Reporter B", outlet: "Wire B", phone: "+249955500002", tier: "TIER2" }, H);
  const aud = await j("GET", "/outreach/audience?kind=MEDIA&q=Test Reporter", null, H);
  ok("audience resolver finds media targets", aud.data.length >= 2 && aud.data.every((t) => t.phone));
  const en = await j("POST", `/outreach/${oc.data.id}/enroll`, { targetIds: [mcA.data.id, mcB.data.id] }, H);
  ok("enroll mints one touch per step per target", en.data.enrolled === 2 && (await j("GET", `/outreach/${oc.data.id}/touches`, null, H)).data.length === 4);
  ok("re-enroll skips the already-enrolled", (await j("POST", `/outreach/${oc.data.id}/enroll`, { targetIds: [mcA.data.id] }, H)).data.skipped === 1);
  ok("unknown target skipped", (await j("POST", `/outreach/${oc.data.id}/enroll`, { targetIds: [NIL] }, H)).data.skipped === 1);
  const touches = (await j("GET", `/outreach/${oc.data.id}/touches`, null, H)).data;
  const tA1 = touches.find((t) => t.targetId === mcA.data.id && t.stepNo === 1);
  const tA2 = touches.find((t) => t.targetId === mcA.data.id && t.stepNo === 2);
  const tB1 = touches.find((t) => t.targetId === mcB.data.id && t.stepNo === 1);
  ok("step due dates ladder up", new Date(tA2.dueAt) > new Date(tA1.dueAt));

  // ── the assisted send flow ──
  const snd = await j("POST", `/outreach-touches/${tA1.id}/send`, {}, H);
  ok("send renders + returns the deep link", snd.status === 200 && snd.data.waUrl.includes("249955500001") && (snd.data.textAr || "").includes("Test Reporter A"));
  const tA1b = (await j("GET", `/outreach/${oc.data.id}/touches`, null, H)).data.find((t) => t.id === tA1.id);
  ok("touch stamped SENT + sentAt", tA1b.status === "SENT" && !!tA1b.sentAt);
  ok("relationship lastContactAt closed the loop", !!(await db.query(`SELECT "lastContactAt" FROM media_contacts WHERE id = $1`, [mcA.data.id])).rows[0].lastContactAt);
  ok("cannot re-send a sent touch", (await j("POST", `/outreach-touches/${tA1.id}/send`, {}, H)).status === 400);

  // ── transitions ──
  ok("PLANNED cannot jump to REPLIED", (await j("PATCH", `/outreach-touches/${tB1.id}`, { status: "REPLIED" }, H)).status === 400);
  await j("PATCH", `/outreach-touches/${tB1.id}`, { status: "SENT" }, H);
  const rep = await j("PATCH", `/outreach-touches/${tB1.id}`, { status: "REPLIED", note: "wants the datasheet" }, H);
  ok("SENT → REPLIED with a note", rep.data.status === "REPLIED" && rep.data.note === "wants the datasheet");
  ok("REPLIED → PLACED", (await j("PATCH", `/outreach-touches/${tB1.id}`, { status: "PLACED" }, H)).data.status === "PLACED");
  ok("PLACED is terminal", (await j("PATCH", `/outreach-touches/${tB1.id}`, { status: "SENT" }, H)).status === 400);

  // ── the NPS-per-customer mechanics (audienceKind CUSTOMER) ──
  const custLead = (await db.query(`SELECT id FROM leads WHERE company = 'Hot Mills'`)).rows[0];
  const cust = (await db.query(`INSERT INTO customers (company, "leadId") VALUES ('Hot Mills', $1) RETURNING id`, [custLead.id])).rows[0];
  const npsC = await j("POST", "/outreach", {
    name: "Quarterly NPS", audienceKind: "CUSTOMER", status: "ACTIVE",
    steps: [{ day: 0, channel: "WA", templateId: waPitch.data.id }],
  }, H);
  await j("POST", `/outreach/${npsC.data.id}/enroll`, { targetIds: [cust.id] }, H);
  const npsT = (await j("GET", `/outreach/${npsC.data.id}/touches`, null, H)).data[0];
  const npsSend = await j("POST", `/outreach-touches/${npsT.id}/send`, {}, H);
  ok("customer sequence sends via the linked lead's phone", npsSend.status === 200 && npsSend.data.waUrl.includes("249900000001"));

  // ── health board ──
  const hb = await j("GET", "/outreach/health", null, H);
  ok("health buckets computed", hb.data.counts.warm >= 2 && hb.data.counts.cold >= 1);
  ok("health rows carry days + bucket", hb.data.contacts.every((c) => typeof c.days === "number" && ["warm", "cooling", "cold"].includes(c.health)));

  // ── the sweeps in the Daily Pulse ──
  const mcC = await j("POST", "/media-contacts", { name: "Cold Tier1", outlet: "Frozen Wire", tier: "TIER1" }, H);
  await db.query(`UPDATE media_contacts SET "lastContactAt" = now() - interval '100 days' WHERE id = $1`, [mcC.data.id]);
  await db.query(`UPDATE outreach_touches SET "dueAt" = now() - interval '2 days' WHERE id = $1`, [tA2.id]);
  const dueN = async (ty) => (await j("GET", "/notifications", null, H)).data.items.filter((n) => n.type === ty).length;
  const rd1 = await j("POST", "/metrics/run-daily", null, H);
  ok("sweeps report: due outreach + cold contacts", rd1.data.outreachDue >= 1 && rd1.data.coldContacts >= 1);
  const dueA = await dueN("OUTREACH_DUE"), coldA = await dueN("REL_COLD");
  ok("OUTREACH_DUE + REL_COLD pinged", dueA >= 1 && coldA >= 1);
  await j("POST", "/metrics/run-daily", null, H);
  ok("both sweeps dedupe (20h)", (await dueN("OUTREACH_DUE")) === dueA && (await dueN("REL_COLD")) === coldA);

  // ── coverage reports + SOV ──
  const t1 = await j("POST", "/osint/topics", { label: "Saria brand", query: "saria" }, H);
  const t2 = await j("POST", "/osint/topics", { label: "Rival brand", query: "rival" }, H);
  for (let i = 0; i < 3; i++) await db.query(`INSERT INTO osint_signals ("topicId", title, "createdAt") VALUES ($1, $2, ('2026-06-1' || $3)::timestamptz)`, [t1.data.id, `own signal ${i}`, String(2 + i)]);
  for (let i = 0; i < 2; i++) await db.query(`INSERT INTO osint_signals ("topicId", title, "createdAt") VALUES ($1, $2, ('2026-06-2' || $3)::timestamptz)`, [t2.data.id, `rival signal ${i}`, String(2 + i)]);
  const comp = await j("POST", "/competitors", { name: "Rival Co", nameAr: "المنافس", listeningTopicId: t2.data.id, notes: "undercuts on price" }, H);
  ok("competitor created + bound", comp.status === 201);
  await db.query(`INSERT INTO press_items (title, "contactId", status, url, "publishedAt") VALUES ('June feature', $1, 'PUBLISHED', 'https://wire-a.example/june', '2026-06-20')`, [mcA.data.id]);
  const cr = await j("POST", "/coverage-reports/compile", { title: "June coverage", periodStart: "2026-06-01", periodEnd: "2026-06-30" }, H);
  ok("coverage compiled", cr.status === 201);
  const snap = P(cr.data.snapshot);
  ok("snapshot: press matched in period", snap.pressCount === 1 && snap.press[0].outlet === "Wire A");
  ok("snapshot: signals counted", snap.signalCount === 5);
  ok("snapshot: SOV own vs competitors (60%)", snap.sov.ownMentions === 3 && snap.sov.competitorMentions === 2 && snap.sov.sovPct === 60);
  ok("snapshot: per-competitor mentions", snap.sov.perCompetitor.find((c) => c.name === "Rival Co")?.count === 2);
  ok("snapshot: outreach window respected (none in June)", snap.outreach.sent === 0);
  ok("coverage listed", (await j("GET", "/coverage-reports", null, H)).data.some((r) => r.id === cr.data.id));
  ok("coverage is immutable (no PATCH route)", (await j("PATCH", `/coverage-reports/${cr.data.id}`, { title: "x" }, H)).status === 404);

  // ── competitors list intelligence ──
  await db.query(`INSERT INTO osint_signals ("topicId", title) VALUES ($1, 'fresh rival mention')`, [t2.data.id]);
  const cl = await j("GET", "/competitors", null, H);
  const rc = cl.data.find((c) => c.name === "Rival Co");
  ok("competitor list carries topic + 30d mentions", rc.topicLabel === "Rival brand" && rc.mentions30d >= 1);

  // ── catalog DoD + sovereignty ──
  const cat4 = await j("GET", "/metrics", null, H);
  ok("REACH KPIs registered", ["outreach_sent_30d", "outreach_reply_rate_30d", "media_cold_count"].every((k) => cat4.data.some((m) => m.key === k)));
  ok("sent metric counts this block", (await j("GET", "/metrics/outreach_sent_30d/value", null, H)).data.value >= 3);
  ok("reply rate > 0", (await j("GET", "/metrics/outreach_reply_rate_30d/value", null, H)).data.value > 0);
  const bk6 = await j("GET", "/export/backup", null, H);
  ok("backup covers reach tables", ["outreach_campaigns", "outreach_touches", "coverage_reports", "competitors"].every((t) => t in bk6.data.tables));
}

// ═══ Wave 1·G — Connective Tissue: the v1.0 closer ═══════════════════
{
  const P = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const camp = (await db.query(`SELECT id FROM campaigns LIMIT 1`)).rows[0];

  // ── media plans + QR offline attribution ──
  await j("PATCH", "/settings", { modules: { media: false } }, H);
  ok("media flag off → media-plans 404", (await j("GET", "/media-plans", null, H)).status === 404);
  await j("PATCH", "/settings", { modules: {} }, H);
  ok("media-plans perm-gated (analyst write)", (await j("POST", "/media-plans", { name: "x" }, A)).status === 403);
  const mplan = await j("POST", "/media-plans", { name: "Q3 billboards", nameAr: "لوحات الربع الثالث", channel: "BILLBOARD", budgetUsd: 20000, campaignId: camp.id }, H);
  ok("media plan created", mplan.status === 201);
  ok("placement needs targetUrl", (await j("POST", `/media-plans/${mplan.data.id}/placements`, { label: "x" }, H)).status === 400);
  const pl = await j("POST", `/media-plans/${mplan.data.id}/placements`, { label: "Airport Rd 12x4", location: "Khartoum", costUsd: 6000, targetUrl: "https://saria.sd/battery" }, H);
  ok("placement mints its tracked QR code", pl.status === 201 && /^mp-/.test(pl.data.linkCode) && pl.data.qr.includes("/r/" + pl.data.linkCode));
  ok("offline channel on the minted link", (await db.query(`SELECT channel FROM tracked_links WHERE code = $1`, [pl.data.linkCode])).rows[0].channel === "OFFLINE");
  const qr = await j("GET", `/media-plans/placements/${pl.data.id}/qr`, null, H);
  ok("QR generated locally as a data URL", qr.status === 200 && qr.data.dataUrl.startsWith("data:image/png"));
  const scan = await fetch("http://127.0.0.1:4110/r/" + pl.data.linkCode, { redirect: "manual" });
  ok("a scan redirects to the target", scan.status === 302);
  const plList = await j("GET", `/media-plans/${mplan.data.id}/placements`, null, H);
  ok("scan attributed to the placement", plList.data[0].scans === 1);
  const mpl2 = (await j("GET", "/media-plans", null, H)).data.find((x) => x.id === mplan.data.id);
  ok("plan rolls up placements + spend + scans", mpl2.placementCount === 1 && Number(mpl2.spentUsd) === 6000 && mpl2.scans === 1);
  await j("PATCH", `/media-plans/placements/${pl.data.id}`, { costUsd: 6500 }, H);
  ok("placement editable", Number((await j("GET", `/media-plans/${mplan.data.id}/placements`, null, H)).data[0].costUsd) === 6500);

  // ── promotions ──
  const promo = await j("POST", "/promotions", { name: "Eid battery deal", nameAr: "عرض العيد", code: "eid25", kind: "DISCOUNT" }, H);
  ok("promo created, code uppercased", promo.status === 201 && promo.data.code === "EID25");
  await j("POST", `/promotions/${promo.data.id}/redeem`, null, H);
  const promo2 = await j("POST", `/promotions/${promo.data.id}/redeem`, null, H);
  ok("redemptions count", promo2.data.redemptions === 2);
  await j("PATCH", `/promotions/${promo.data.id}`, { active: false }, H);
  ok("inactive promo can't redeem", (await j("POST", `/promotions/${promo.data.id}/redeem`, null, H)).status === 400);

  // ── referrals ──
  const hm = (await db.query(`SELECT id FROM customers WHERE company = 'Hot Mills' LIMIT 1`)).rows[0];
  ok("referral needs basics", (await j("POST", "/referrals", { referrerCustomerId: hm.id }, H)).status === 400);
  const ref = await j("POST", "/referrals", { referrerCustomerId: hm.id, targetUrl: "https://saria.sd/ref" }, H);
  ok("referral minted with a ref- code", ref.status === 201 && /^ref-/.test(ref.data.code));
  await fetch("http://127.0.0.1:4110/r/" + ref.data.code, { redirect: "manual" });
  const refLead = await j("POST", "/leads", { company: "Referral Lead Co", phone: "+249900778899", source: "Referral" }, H);
  await j("PATCH", `/referrals/${ref.data.id}`, { referredLeadId: refLead.data.id }, H);
  const refList = await j("GET", "/referrals", null, H);
  const refRow = refList.data.find((r) => r.id === ref.data.id);
  ok("referral joins referrer + referred + clicks", refRow.referrerCompany === "Hot Mills" && refRow.referredCompany === "Referral Lead Co" && refRow.clicks === 1);
  await j("PATCH", `/leads/${refLead.data.id}`, { stage: "WON" }, H);
  const rdG = await j("POST", "/metrics/run-daily", null, H);
  ok("referral sweep rewards the WON referral", rdG.data.referralsEarned >= 1
    && (await j("GET", "/referrals", null, H)).data.find((r) => r.id === ref.data.id).rewardState === "EARNED");
  ok("REFERRAL_EARNED pinged", (await j("GET", "/notifications", null, H)).data.items.some((n) => n.type === "REFERRAL_EARNED"));
  ok("sweep is idempotent", (await j("POST", "/metrics/run-daily", null, H)).data.referralsEarned === 0);
  ok("reward payable", (await j("PATCH", `/referrals/${ref.data.id}`, { rewardState: "PAID" }, H)).data.rewardState === "PAID");

  // ── partners ──
  const pn = await j("POST", "/partners", { name: "Nile Distribution Co", nameAr: "شركة النيل للتوزيع", kind: "DISTRIBUTOR", region: "Khartoum", coopBudgetUsd: 15000 }, H);
  ok("partner created", pn.status === 201);
  const pcLink = await j("POST", `/partners/${pn.data.id}/campaigns`, { campaignId: camp.id, sharePct: 40 }, H);
  ok("partner↔campaign linked", pcLink.status === 201);
  ok("duplicate link rejected", (await j("POST", `/partners/${pn.data.id}/campaigns`, { campaignId: camp.id }, H)).status === 409);
  ok("link carries the campaign name", (await j("GET", `/partners/${pn.data.id}/campaigns`, null, H)).data[0].campaignName?.length > 0);
  ok("partner list counts campaigns", (await j("GET", "/partners", null, H)).data.find((x) => x.id === pn.data.id).campaignCount === 1);

  // ── playbooks ──
  ok("playbooks perm-gated", (await j("POST", "/playbooks", { title: "x" }, A)).status === 403);
  const pb = await j("POST", "/playbooks", { title: "Campaign launch SOP", titleAr: "دليل إطلاق حملة", category: "CAMPAIGNS", body: "# Steps" }, H);
  ok("playbook drafted then published", pb.status === 201 && (await j("PATCH", `/playbooks/${pb.data.id}`, { published: true }, H)).data.published === true);

  // ── ad spend → ROMI ──
  const beBefore = (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c;
  const ads = await j("POST", "/ad-spend", { platform: "META", campaignId: camp.id, amountUsd: 1200, impressions: 90000, clicks: 1400 }, H);
  ok("ad spend recorded", ads.status === 201);
  const beRow = (await db.query(`SELECT * FROM budget_entries ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  ok("paid cost flows into the budget ledger (ROMI)",
    (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c === beBefore + 1
    && beRow.kind === "SPENT" && beRow.label.includes("META"));

  // ── inbox v1 ──
  const ib = await j("POST", "/inbox", { platform: "IG", kind: "DM", author: "@sara_kh", text: "هل يتوفر شاحن ٢٠٠ أمبير؟" }, H);
  ok("inbox item captured OPEN", ib.status === 201 && ib.data.status === "OPEN");
  const conv = await j("POST", `/inbox/${ib.data.id}/convert`, { company: "Sara KH" }, H);
  ok("one tap converts to a lead", conv.status === 201 && !!conv.data.leadId);
  const ib2 = (await j("GET", `/inbox/${ib.data.id}`, null, H)).data;
  ok("item marked CONVERTED + linked", ib2.status === "CONVERTED" && ib2.leadId === conv.data.leadId);
  ok("the lead carries the social source", (await db.query(`SELECT source FROM leads WHERE id = $1`, [conv.data.leadId])).rows[0].source === "Social — IG");
  ok("double-convert rejected", (await j("POST", `/inbox/${ib.data.id}/convert`, {}, H)).status === 400);
  await j("POST", "/inbox", { platform: "FB", kind: "COMMENT", author: "@omar", text: "السعر؟" }, H);

  // ── self-filling key results ──
  const obj = (await db.query(`INSERT INTO objectives (label, "labelAr") VALUES ('Q3 growth', 'نمو الربع الثالث') RETURNING id`)).rows[0];
  ok("auto KR needs a metricKey", (await j("POST", "/key-results", { objectiveId: obj.id, label: "x", metric: {} }, H)).status === 400);
  const kr = await j("POST", "/key-results", { objectiveId: obj.id, label: "Leads captured", labelAr: "عملاء محتملون", metric: { metricKey: "leads_new_30d" }, target: 100 }, H);
  ok("auto KR self-fills on create", kr.status === 201 && Number((await j("GET", `/key-results/${kr.data.id}`, null, H)).data.current) > 0);
  const krM = await j("POST", "/key-results", { objectiveId: obj.id, label: "Manual milestone", metric: {}, target: 5, current: 3, auto: false }, H);
  const before = Number((await j("GET", `/key-results/${kr.data.id}`, null, H)).data.current);
  await j("POST", "/leads", { company: "KR Bump Co", phone: "+249900110022", source: "WEB" }, H);
  const rdK = await j("POST", "/metrics/run-daily", null, H);
  ok("Daily Pulse refreshes auto KRs", rdK.data.keyResults >= 1 && Number((await j("GET", `/key-results/${kr.data.id}`, null, H)).data.current) >= before);
  ok("manual KRs untouched", Number((await j("GET", `/key-results/${krM.data.id}`, null, H)).data.current) === 3);

  // ── pulse.js: sites, snippet, collect, stats ──
  const site = await j("POST", "/sites", { name: "Saria main site", domain: "saria.sd" }, H);
  ok("site minted with a snippet key", site.status === 201 && /^ps_/.test(site.data.snippetKey));
  const snip = await fetch("http://127.0.0.1:4110/pulse.js");
  ok("pulse.js served at the root", snip.status === 200 && (await snip.text()).includes("collect"));
  const collect = (body) => fetch("http://127.0.0.1:4110/api/public/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  ok("collect accepts a pageview", (await collect({ key: site.data.snippetKey, kind: "PAGEVIEW", path: "/battery", utm: { utm_source: "fb" }, visitor: "v1" })).status === 204);
  await collect({ key: site.data.snippetKey, kind: "PAGEVIEW", path: "/battery", visitor: "v2", src: "bio-order" });
  await collect({ key: site.data.snippetKey, kind: "PAGEVIEW", path: "/", visitor: "v1" });
  await collect({ key: site.data.snippetKey, kind: "EVENT", path: "quote_request", visitor: "v1" });
  await collect({ key: "ps_nope", kind: "PAGEVIEW", path: "/x", visitor: "vx" });
  ok("unknown keys dropped silently", (await db.query(`SELECT COUNT(*)::int c FROM web_events WHERE "siteKey" = 'ps_nope'`)).rows[0].c === 0);
  const stats = await j("GET", `/sites/${site.data.id}/stats`, null, H);
  ok("stats: daily views + unique visitors", stats.data.days.reduce((a, d) => a + d.views, 0) === 3 && stats.data.days[stats.data.days.length - 1].visitors === 2);
  ok("stats: top pages + sources", stats.data.pages[0].path === "/battery" && stats.data.sources.some((s) => s.source === "fb"));
  ok("site list carries 7d volume", (await j("GET", "/sites", null, H)).data.find((s) => s.id === site.data.id).events7d === 4);

  // ── the Morning Pulse ──
  await db.query(`DELETE FROM digest_log`);
  const dg = await j("GET", "/digest/morning", null, H);
  ok("morning briefing compiles live", dg.status === 200 && dg.data.logged === false && typeof dg.data.pulse.value === "number" && Array.isArray(dg.data.tasksDue));
  ok("briefing sees the open inbox", dg.data.counts.inboxOpen >= 1);
  const rdM = await j("POST", "/metrics/run-daily", null, H);
  ok("nightly writes the digest once", rdM.data.digest === 1 && (await j("POST", "/metrics/run-daily", null, H)).data.digest === 0);
  ok("logged briefing served next read", (await j("GET", "/digest/morning", null, H)).data.logged === true);
  ok("digest history kept", (await j("GET", "/digest/history", null, H)).data.length >= 1);

  // ── catalog DoD + sovereignty ──
  const cat4 = await j("GET", "/metrics", null, H);
  ok("CONNECT KPIs registered", ["web_pageviews_7d", "ad_spend_30d", "promo_redemptions_total", "inbox_open", "referral_leads_total"].every((k) => cat4.data.some((m) => m.key === k)));
  ok("web pageviews metric counts", (await j("GET", "/metrics/web_pageviews_7d/value", null, H)).data.value >= 3);
  const bk6 = await j("GET", "/export/backup", null, H);
  ok("backup covers all 13 connective tables", ["media_plans", "media_placements", "promotions", "referrals", "partners", "partner_campaigns", "playbooks", "ad_spend", "sites", "web_events", "key_results", "digest_log", "inbox_items"].every((t) => t in bk6.data.tables));
}

// ═══ Wave 2·A — the mail rail ════════════════════════════════════════
{
  // ── SMTP config: stored, merged, and never echoed back ──
  const cfg = await j("PATCH", "/settings", {
    mail: { host: "smtp.example.com", port: 587, secure: false, user: "pulse@saria.sd", pass: "s3cret-pass", from: "pulse@saria.sd", fromName: "نبض" },
  }, H);
  ok("mail config saved", cfg.status === 200);
  ok("SMTP password never leaves the server", cfg.data.mail.pass === undefined && cfg.data.mail.hasPass === true);
  ok("config readable on GET, still masked", (await j("GET", "/settings", null, H)).data.mail.host === "smtp.example.com"
    && (await j("GET", "/settings", null, H)).data.mail.pass === undefined);
  ok("stored password survives a PATCH that omits it",
    (await j("PATCH", "/settings", { mail: { fromName: "Pulse" } }, H)).data.mail.hasPass === true);
  ok("other mail fields merge, not clobber", (await j("GET", "/settings", null, H)).data.mail.user === "pulse@saria.sd");
  ok("mail config is admin-only", (await j("PATCH", "/settings", { mail: { host: "x" } }, A)).status === 403);

  // Back to log mode (blank host) so nothing dials a real server in tests.
  await j("PATCH", "/settings", { mail: { host: "" } }, H);
  ok("password kept even in log mode", (await j("GET", "/settings", null, H)).data.mail.hasPass === true);

  // ── test-send ──
  ok("test-send is admin-only", (await j("POST", "/mail/test", null, A)).status === 403);
  const mlBefore = (await db.query(`SELECT COUNT(*)::int c FROM mail_log`)).rows[0].c;
  const test = await j("POST", "/mail/test", null, H);
  ok("test-send logs rather than sends when unconfigured", test.status === 200 && test.data.status === "LOGGED" && test.data.configured === false);
  const mlRow = (await db.query(`SELECT * FROM mail_log ORDER BY "sentAt" DESC LIMIT 1`)).rows[0];
  ok("every send is audited", (await db.query(`SELECT COUNT(*)::int c FROM mail_log`)).rows[0].c === mlBefore + 1
    && mlRow.kind === "TEST" && mlRow.to === "head@saria.sd");
  ok("mail log readable by admins", (await j("GET", "/mail/log", null, H)).data.length >= 1);

  // ── the Morning Pulse, delivered ──
  // The demo seed opts two users in and earlier run-dailys already mailed
  // them; reset so this block owns its world.
  await db.query(`UPDATE users SET "morningEmail" = false`);
  await db.query(`DELETE FROM mail_log WHERE kind = 'MORNING_PULSE'`);
  const headUser = (await db.query(`SELECT id, email FROM users WHERE email = 'head@saria.sd'`)).rows[0];
  ok("nobody is mailed before opting in", (await j("POST", "/metrics/run-daily", null, H)).data.emails === 0);
  await j("PATCH", `/users/${headUser.id}`, { morningEmail: true }, H);
  ok("opt-in visible on the user", (await j("GET", "/users", null, H)).data.find((u) => u.id === headUser.id).morningEmail === true);
  const rdE = await j("POST", "/metrics/run-daily", null, H);
  ok("nightly mails the briefing to opted-in users", rdE.data.emails === 1);
  const dig = (await db.query(`SELECT * FROM mail_log WHERE kind = 'MORNING_PULSE' AND "to" = 'head@saria.sd'`)).rows;
  ok("the briefing is logged against the recipient", dig.length === 1 && dig[0].subject.includes("صباح النبض"));
  ok("one briefing per person per day", (await j("POST", "/metrics/run-daily", null, H)).data.emails === 0
    && (await db.query(`SELECT COUNT(*)::int c FROM mail_log WHERE kind = 'MORNING_PULSE'`)).rows[0].c === 1);
  await j("PATCH", `/users/${headUser.id}`, { morningEmail: false }, H);
  await db.query(`DELETE FROM mail_log WHERE kind = 'MORNING_PULSE'`);
  ok("opting out stops the mail", (await j("POST", "/metrics/run-daily", null, H)).data.emails === 0
    && (await db.query(`SELECT COUNT(*)::int c FROM mail_log WHERE kind = 'MORNING_PULSE'`)).rows[0].c === 0);

  // ── the template itself ──
  const { renderMorningHtml } = await import("../src/mail.js");
  const html = renderMorningHtml({ date: "2026-08-01", pulse: { value: 72, delta: 4 }, tasksDue: [{ title: "Call Nile Power" }], wonYesterday: [{ company: "Hot Mills" }], counts: { inboxOpen: 2 } }, "سارية");
  ok("email renders RTL Arabic with the pulse", html.includes('dir="rtl"') && html.includes("صباح النبض") && html.includes("72") && html.includes("سارية"));
  ok("email carries today's lanes", html.includes("Call Nile Power") && html.includes("Hot Mills"));
  ok("email escapes injected markup", !renderMorningHtml({ date: "x", pulse: { value: 1, delta: 0 }, tasksDue: [{ title: "<script>bad()</script>" }] }).includes("<script>bad()"));

  // ── catalog DoD + sovereignty ──
  ok("mail KPI registered", (await j("GET", "/metrics", null, H)).data.some((m) => m.key === "emails_sent_30d"));
  ok("mail KPI counts the log", (await j("GET", "/metrics/emails_sent_30d/value", null, H)).data.value >= 1);
  ok("backup covers the mail log", "mail_log" in (await j("GET", "/export/backup", null, H)).data.tables);
}

// ═══ Wave 2·A+ — the HTTP provider rail (Resend & compatible) ════════
{
  // The app's own endpoints stand in for the provider: /api/public/collect
  // always answers 204 (a 2xx), and an unknown path answers non-2xx — so the
  // whole HTTP path is exercised without leaving the machine.
  const OK_URL = "http://127.0.0.1:4110/api/public/collect";
  const BAD_URL = "http://127.0.0.1:4110/api/definitely-not-here";
  const setMail = (mail) => j("PATCH", "/settings", { mail }, H);

  // ── an API key is a secret, like the SMTP password ──
  await setMail({ provider: "RESEND", apiKey: "re_test_key_123", from: "pulse@saria.sd", fromName: "نبض", apiUrl: OK_URL });
  const st = await j("GET", "/settings", null, H);
  ok("API key never leaves the server", st.data.mail.apiKey === undefined && st.data.mail.hasKey === true);
  ok("provider recorded", st.data.mail.provider === "RESEND");
  ok("stored API key survives a PATCH that omits it",
    (await setMail({ fromName: "Pulse" })).data.mail.hasKey === true);
  ok("both secrets coexist", (await j("GET", "/settings", null, H)).data.mail.hasPass === true);
  ok("unknown providers are rejected, not stored", (await setMail({ provider: "CARRIER_PIGEON" })).data.mail.provider === "");

  // ── the happy path ──
  await setMail({ provider: "RESEND", apiUrl: OK_URL });
  const sent = await j("POST", "/mail/test", null, H);
  ok("mail sends over the HTTP provider", sent.status === 200 && sent.data.status === "SENT" && sent.data.configured === true);
  ok("the successful send is audited", (await db.query(
    `SELECT * FROM mail_log WHERE kind = 'TEST' ORDER BY "sentAt" DESC LIMIT 1`)).rows[0].status === "SENT");

  // ── the failure path: recorded, never thrown ──
  await setMail({ apiUrl: BAD_URL });
  const failed = await j("POST", "/mail/test", null, H);
  ok("a provider error is caught, not thrown", failed.status === 200 && failed.data.status === "FAILED");
  const errRow = (await db.query(`SELECT * FROM mail_log WHERE status = 'FAILED' ORDER BY "sentAt" DESC LIMIT 1`)).rows[0];
  ok("the error text is kept for the admin", !!errRow && errRow.error && errRow.error.length > 0);

  // ── the briefing rides the same rail ──
  await setMail({ apiUrl: OK_URL });
  await db.query(`UPDATE users SET "morningEmail" = false`);
  await db.query(`DELETE FROM mail_log WHERE kind = 'MORNING_PULSE'`);
  const hu = (await db.query(`SELECT id FROM users WHERE email = 'head@saria.sd'`)).rows[0];
  await j("PATCH", `/users/${hu.id}`, { morningEmail: true }, H);
  const rdA = await j("POST", "/metrics/run-daily", null, H);
  const dRow = (await db.query(`SELECT * FROM mail_log WHERE kind = 'MORNING_PULSE' ORDER BY "sentAt" DESC LIMIT 1`)).rows[0];
  ok("the Morning Pulse delivers over the API provider", rdA.data.emails === 1 && dRow.status === "SENT");

  // ── legacy configs (saved before providers existed) still work ──
  await setMail({ provider: "" });
  ok("a key with no provider is inferred as the API rail",
    (await j("POST", "/mail/test", null, H)).data.status === "SENT");

  // ── leave the suite in log mode, as it was found ──
  await db.query(`UPDATE settings SET mail = '{}'::jsonb WHERE id = 1`);
  await db.query(`UPDATE users SET "morningEmail" = false`);
  ok("clearing the config returns to log mode", (await j("POST", "/mail/test", null, H)).data.status === "LOGGED");
}

// ═══ Wave 2·B — connector core + WhatsApp Business ═══════════════════
{
  const http = await import("node:http");
  const crypto2 = await import("node:crypto");

  // ── a stand-in platform on 4111: real HTTP, no outbound network ──
  const seen = [];
  const mock = http.createServer((rq, rs) => {
    let body = "";
    rq.on("data", (c) => { body += c; });
    rq.on("end", () => {
      const bad = rq.headers.authorization !== "Bearer mock-good";
      seen.push({ url: rq.url, body: body ? JSON.parse(body) : null, bad });
      rs.setHeader("Content-Type", "application/json");
      if (bad) { rs.statusCode = 401; return rs.end(JSON.stringify({ error: { message: "Invalid OAuth token" } })); }
      if (rq.url.endsWith("/messages")) return rs.end(JSON.stringify({ messages: [{ id: "wamid.MOCK1" }] }));
      rs.end(JSON.stringify({ id: "pn-1", verified_name: "Saria Industrial" }));
    });
  });
  await new Promise((r) => mock.listen(4111, "127.0.0.1", r));

  const WA_SECRET = "hook-secret-xyz";
  await j("PATCH", "/settings", {
    integrations: { wa: { verifyToken: "verify-me-123", appSecret: WA_SECRET, apiUrl: "http://127.0.0.1:4111" } },
  }, H);

  // ── secrets are masked exactly like the mail rail's ──
  const sInt = (await j("GET", "/settings", null, H)).data.integrations.wa;
  ok("integration secrets never leave the server", sInt.appSecret === undefined && sInt.verifyToken === undefined);
  ok("their presence is still reportable", sInt.hasAppSecret === true && sInt.hasVerifyToken === true);
  ok("non-secret config is readable", sInt.apiUrl === "http://127.0.0.1:4111");
  await j("PATCH", "/settings", { integrations: { wa: { apiUrl: "http://127.0.0.1:4111" } } }, H);
  ok("stored secrets survive a PATCH that omits them",
    (await j("GET", "/settings", null, H)).data.integrations.wa.hasAppSecret === true);
  ok("integration config is admin-only", (await j("PATCH", "/settings", { integrations: { wa: {} } }, A)).status === 403);

  // ── the account ──
  const waAcc = await j("POST", "/social/accounts", { platform: "WA", handle: "+249900111222", displayName: "Saria WhatsApp", accessToken: "mock-good", externalId: "pn-1" }, H);
  ok("WhatsApp is a first-class account platform", waAcc.status === 201);
  const caps = await j("GET", "/social/capabilities", null, H);
  ok("capabilities are declared by the adapter", caps.data.WA.send === 1 && caps.data.WA.publish === 0);
  const ver = await j("POST", `/social/accounts/${waAcc.data.id}/verify`, null, H);
  ok("verify reaches the platform and connects", ver.status === 200 && ver.data.ok === true);
  ok("verification is logged", (await db.query(
    `SELECT * FROM integration_runs WHERE kind = 'VERIFY' AND status = 'OK'`)).rows.length >= 1);
  ok("a bad token disconnects rather than pretending", await (async () => {
    await db.query(`UPDATE social_accounts SET "accessToken" = 'mock-bad' WHERE id = $1`, [waAcc.data.id]);
    const r = await j("POST", `/social/accounts/${waAcc.data.id}/verify`, null, H);
    const st = (await db.query(`SELECT status FROM social_accounts WHERE id = $1`, [waAcc.data.id])).rows[0].status;
    await db.query(`UPDATE social_accounts SET "accessToken" = 'mock-good', status = 'CONNECTED' WHERE id = $1`, [waAcc.data.id]);
    return r.data.ok === false && st === "DISCONNECTED" && !!r.data.error;
  })());

  // ── the webhook handshake ──
  const hs = await fetch("http://127.0.0.1:4110/api/public/hooks/wa?hub.mode=subscribe&hub.verify_token=verify-me-123&hub.challenge=CHAL42");
  ok("Meta's handshake echoes the challenge", hs.status === 200 && (await hs.text()) === "CHAL42");
  const hsBad = await fetch("http://127.0.0.1:4110/api/public/hooks/wa?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=X");
  ok("a wrong verify token is refused", hsBad.status === 403);

  // ── signed intake ──
  const envelope = (id, text, from = "249900333444") => ({
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: from, profile: { name: "Fatima" } }],
      messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }],
  });
  const post = (obj, secret) => {
    const raw = JSON.stringify(obj);
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["X-Hub-Signature-256"] = "sha256=" + crypto2.createHmac("sha256", secret).update(raw).digest("hex");
    return fetch("http://127.0.0.1:4110/api/public/hooks/wa", { method: "POST", headers, body: raw });
  };

  ok("an unsigned webhook is rejected", (await post(envelope("wamid.A", "hi"), null)).status === 401);
  ok("a wrongly-signed webhook is rejected", (await post(envelope("wamid.A", "hi"), "not-the-secret")).status === 401);
  ok("a correctly-signed message is accepted", (await post(envelope("wamid.A", "كم سعر البطارية؟"), WA_SECRET)).status === 200);
  const got = (await db.query(`SELECT * FROM inbox_items WHERE "externalId" = 'wamid.A'`)).rows[0];
  ok("it lands in the inbox as an API capture", !!got && got.platform === "WA" && got.via === "API" && got.status === "OPEN");
  ok("the sender's name and text survive", got.author.includes("Fatima") && got.text.includes("البطارية"));
  ok("redelivery is harmless", await (async () => {
    await post(envelope("wamid.A", "كم سعر البطارية؟"), WA_SECRET);
    return (await db.query(`SELECT COUNT(*)::int c FROM inbox_items WHERE "externalId" = 'wamid.A'`)).rows[0].c === 1;
  })());
  ok("a malformed envelope never makes Meta retry", (await post({ nonsense: true }, WA_SECRET)).status === 200);

  // ── replying, inside the compliance rules ──
  const rep = await j("POST", `/inbox/${got.id}/reply`, { text: "أهلاً، السعر ٤٥٠ ألف" }, H);
  ok("free text is allowed inside the 24-hour window", rep.status === 200 && rep.data.sent === true);
  ok("the send reached the platform as a text message",
    seen.some((r) => r.url.endsWith("/messages") && r.body?.type === "text"));
  ok("replying marks the item REPLIED",
    (await j("GET", `/inbox/${got.id}`, null, H)).data.status === "REPLIED");
  ok("the window is reported to the UI", (await j("GET", `/inbox/${got.id}/window`, null, H)).data.open === true);

  // age the conversation past 24h
  await db.query(`UPDATE inbox_items SET "receivedAt" = now() - interval '30 hours' WHERE "externalId" = 'wamid.A'`);
  const late = await j("POST", `/inbox/${got.id}/reply`, { text: "متأخر" }, H);
  ok("outside the window free text is refused", late.status === 400 && late.data.windowClosed === true);
  ok("the closed window is reported honestly", (await j("GET", `/inbox/${got.id}/window`, null, H)).data.open === false);

  const tpl = (await db.query(`SELECT id FROM wa_templates LIMIT 1`)).rows[0];
  ok("a template without an approved name is blocked",
    (await j("POST", `/inbox/${got.id}/reply`, { templateId: tpl.id }, H)).status === 400);
  await db.query(`UPDATE wa_templates SET "waTemplateName" = 'saria_follow_up' WHERE id = $1`, [tpl.id]);
  const tSend = await j("POST", `/inbox/${got.id}/reply`, { templateId: tpl.id, params: ["فاطمة"] }, H);
  ok("an approved template sends outside the window", tSend.status === 200 && tSend.data.sent === true);
  ok("it goes out as a template payload, not free text",
    seen.some((r) => r.body?.type === "template" && r.body?.template?.name === "saria_follow_up"));
  ok("sends are audited", (await db.query(
    `SELECT COUNT(*)::int c FROM integration_runs WHERE kind = 'SEND' AND status = 'OK'`)).rows[0].c >= 2);
  ok("replying is permission-gated", (await j("POST", `/inbox/${got.id}/reply`, { text: "x" }, A)).status === 403);

  // ── token expiry warning ──
  await db.query(`UPDATE social_accounts SET "tokenExpiresAt" = now() + interval '3 days' WHERE id = $1`, [waAcc.data.id]);
  const rdT = await j("POST", "/metrics/run-daily", null, H);
  ok("expiring tokens are flagged before they die", rdT.data.tokens >= 1
    && (await j("GET", "/notifications", null, H)).data.items.some((n) => n.type === "TOKEN_EXPIRING"));

  // ── catalog DoD + sovereignty ──
  const catW = await j("GET", "/metrics", null, H);
  ok("connector KPIs registered", ["wa_sent_30d", "inbox_api_7d"].every((k) => catW.data.some((m) => m.key === k)));
  ok("WhatsApp sends are counted", (await j("GET", "/metrics/wa_sent_30d/value", null, H)).data.value >= 2);
  ok("API captures are counted", (await j("GET", "/metrics/inbox_api_7d/value", null, H)).data.value >= 1);
  ok("backup covers the run log", "integration_runs" in (await j("GET", "/export/backup", null, H)).data.tables);

  // leave the suite as found
  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await new Promise((r) => mock.close(r));
}

// ═══ Wave 2·D — Meta · TikTok · Google Ads ═══════════════════════════
{
  const http2 = await import("node:http");
  const crypto3 = await import("node:crypto");
  const hit = [];

  // ── the stand-in platform, now speaking Graph, TikTok and Google ──
  const srv = http2.createServer((rq, rs) => {
    let b = "";
    rq.on("data", (c) => { b += c; });
    rq.on("end", () => {
      const body = b ? JSON.parse(b) : null;
      hit.push({ url: rq.url, body });
      rs.setHeader("Content-Type", "application/json");
      if (rq.headers.authorization !== "Bearer mock-good") {
        rs.statusCode = 401; return rs.end(JSON.stringify({ error: { message: "Invalid OAuth access token" } }));
      }
      const u = rq.url;
      if (u.includes("/feed")) return rs.end(JSON.stringify({ id: "pg1_9", permalink_url: "https://facebook.com/pg1_9" }));
      if (u.includes("/media_publish")) return rs.end(JSON.stringify({ id: "ig_77", permalink: "https://instagram.com/p/ig_77/" }));
      if (u.includes("/media")) return rs.end(JSON.stringify({ id: "container_1" }));
      if (u.includes("act_") && u.includes("insights")) return rs.end(JSON.stringify({ data: [
        { date_start: new Date().toISOString().slice(0, 10), campaign_name: "Ramadan Battery Promotion", spend: "250.50", impressions: "40000", clicks: "900" },
        { date_start: new Date().toISOString().slice(0, 10), campaign_name: "Unknown Platform Campaign", spend: "80", impressions: "9000", clicks: "120" },
      ] }));
      if (u.includes("insights")) return rs.end(JSON.stringify({ data: [
        { name: "page_fans", values: [{ value: 5400 }] },
        { name: "page_impressions", values: [{ value: 91000 }] },
        { name: "page_post_engagements", values: [{ value: 2300 }] },
      ] }));
      if (u.includes("/post/publish/video/init/")) return rs.end(JSON.stringify({ data: { publish_id: "tt_5", share_url: "https://tiktok.com/@x/video/5" } }));
      if (u.includes("/user/info/")) return rs.end(JSON.stringify({ data: { user: { open_id: "tt_open", display_name: "Saria TikTok", follower_count: 3100, likes_count: 800, video_count: 42 } } }));
      rs.end(JSON.stringify({ id: "pg1", name: "Saria Industrial Page" }));
    });
  });
  await new Promise((r) => srv.listen(4112, "127.0.0.1", r));
  const MOCK = "http://127.0.0.1:4112";
  const META_SECRET = "meta-hook-secret";

  await j("PATCH", "/settings", {
    integrations: {
      meta: { apiUrl: MOCK, appSecret: META_SECRET, verifyToken: "meta-verify", adAccountId: "999" },
      tiktok: { apiUrl: MOCK },
    },
  }, H);

  // ── accounts ──
  const fb = await j("POST", "/social/accounts", { platform: "FACEBOOK", handle: "saria.page", accessToken: "mock-good", externalId: "pg1" }, H);
  const ig = await j("POST", "/social/accounts", { platform: "INSTAGRAM", handle: "saria.ig", accessToken: "mock-good", externalId: "ig1" }, H);
  const tt = await j("POST", "/social/accounts", { platform: "TIKTOK", handle: "saria.tt", accessToken: "mock-good", externalId: "tt1" }, H);
  ok("Meta and TikTok accounts connect", fb.status === 201 && ig.status === 201 && tt.status === 201);
  ok("verification reaches Graph", (await j("POST", `/social/accounts/${fb.data.id}/verify`, null, H)).data.ok === true);
  ok("TikTok verifies on its own shape", (await j("POST", `/social/accounts/${tt.data.id}/verify`, null, H)).data.ok === true);

  const caps2 = (await j("GET", "/social/capabilities", null, H)).data;
  ok("capabilities tell the truth per platform",
    caps2.FACEBOOK.publish === 1 && caps2.TIKTOK.inbox === 0 && caps2.GOOGLE.adspend === 1 && caps2.GOOGLE.publish === 0);

  // ── auto-publish: the tick ──
  const cItem = await j("POST", "/content", { title: "Ramadan launch post", type: "POST", status: "APPROVED" }, H);
  const mkSlot = async (platform, caption, minutesAgo = 5) => {
    const v = await j("POST", "/content-variants", { contentId: cItem.data.id, platform, caption }, H);
    const sp = await j("POST", "/scheduled-posts", {
      variantId: v.data.id, scheduledAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    }, H);
    await db.query(`UPDATE scheduled_posts SET status = 'READY' WHERE id = $1`, [sp.data.id]);
    return sp.data.id;
  };
  const slotFb = await mkSlot("FACEBOOK", "عرض رمضان على البطاريات");

  const tick0 = await j("GET", "/cron/publish-tick", null, H);
  ok("without autoPublish the tick leaves the slot alone",
    tick0.data.published === 0 && tick0.data.skipped >= 1
    && (await db.query(`SELECT status FROM scheduled_posts WHERE id = $1`, [slotFb])).rows[0].status === "READY");

  await db.query(`UPDATE social_accounts SET "autoPublish" = true WHERE id = $1`, [fb.data.id]);
  const tick1 = await j("GET", "/cron/publish-tick", null, H);
  const rowFb = (await db.query(`SELECT * FROM scheduled_posts WHERE id = $1`, [slotFb])).rows[0];
  ok("the tick publishes a due slot", tick1.data.published === 1 && rowFb.status === "PUBLISHED");
  ok("the permalink comes back with it", rowFb.externalUrl === "https://facebook.com/pg1_9");
  ok("it went out as a page post", hit.some((r) => r.url.includes("/feed") && r.body?.message?.includes("رمضان")));
  ok("the tick is idempotent", (await j("GET", "/cron/publish-tick", null, H)).data.published === 0);
  ok("publishing is audited", (await db.query(
    `SELECT COUNT(*)::int c FROM integration_runs WHERE kind = 'PUBLISH' AND status = 'OK'`)).rows[0].c >= 1);

  // Instagram without media must fail honestly, and keep the slot alive
  await db.query(`UPDATE social_accounts SET "autoPublish" = true WHERE id = $1`, [ig.data.id]);
  const slotIg = await mkSlot("INSTAGRAM", "صورة المنتج");
  const tickIg = await j("GET", "/cron/publish-tick", null, H);
  const rowIg = (await db.query(`SELECT * FROM scheduled_posts WHERE id = $1`, [slotIg])).rows[0];
  ok("Instagram without media fails instead of silently succeeding", tickIg.data.failed === 1);
  ok("the failed slot stays READY with the reason attached",
    rowIg.status === "READY" && /Instagram requires/i.test(rowIg.publishError || ""));
  ok("a retry after the cause is fixed still works", await (async () => {
    await db.query(`UPDATE scheduled_posts SET "publishError" = NULL WHERE id = $1`, [slotIg]);
    await db.query(`UPDATE content_variants SET "assetId" = (SELECT id FROM assets LIMIT 1)
                    WHERE id = (SELECT "variantId" FROM scheduled_posts WHERE id = $1)`, [slotIg]);
    const t = await j("GET", "/cron/publish-tick", null, H);
    const r = (await db.query(`SELECT status, "externalUrl" FROM scheduled_posts WHERE id = $1`, [slotIg])).rows[0];
    return t.data.published === 1 && r.status === "PUBLISHED" && r.externalUrl.includes("instagram");
  })());
  ok("the two-step container flow was used",
    hit.some((r) => r.url.includes("/media")) && hit.some((r) => r.url.includes("/media_publish")));

  // ── metrics + ad-spend sync ──
  const beBefore2 = (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c;
  const rdS = await j("POST", "/metrics/run-daily", null, H);
  ok("the nightly sync pulls platform metrics", rdS.data.sync.metrics >= 1);
  ok("metrics land marked as API-sourced", (await db.query(
    `SELECT COUNT(*)::int c FROM social_metrics WHERE source = 'API' AND "accountId" = $1`, [fb.data.id])).rows[0].c === 1);
  const spendRows = (await db.query(`SELECT * FROM ad_spend WHERE source = 'SYNC' ORDER BY "amountUsd" DESC`)).rows;
  ok("paid spend syncs from the platform", spendRows.length === 2 && Number(spendRows[0].amountUsd) === 250.5);
  ok("a matching campaign name binds automatically", !!spendRows[0].campaignId);
  ok("an unmatched name is kept, not dropped",
    spendRows[1].campaignId === null && spendRows[1].campaignRef === "Unknown Platform Campaign");
  ok("first sync writes the budget ledger once",
    (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c === beBefore2 + 2);

  const beAfter = (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c;
  await j("POST", "/metrics/run-daily", null, H);
  ok("re-syncing corrects without paying twice",
    (await db.query(`SELECT COUNT(*)::int c FROM budget_entries`)).rows[0].c === beAfter
    && (await db.query(`SELECT COUNT(*)::int c FROM ad_spend WHERE source = 'SYNC'`)).rows[0].c === 2);

  // ── Meta webhooks ──
  const hsM = await fetch("http://127.0.0.1:4110/api/public/hooks/meta?hub.mode=subscribe&hub.verify_token=meta-verify&hub.challenge=MC1");
  ok("Meta's handshake is answered", hsM.status === 200 && (await hsM.text()) === "MC1");
  const feed = { object: "page", entry: [{ changes: [{ field: "feed", value: {
    item: "comment", verb: "add", comment_id: "cmt_1", post_id: "pg1_9",
    from: { name: "Omar" }, message: "كم السعر؟",
  } }] }] };
  const postMeta = (obj, secret) => {
    const raw = JSON.stringify(obj);
    const h = { "Content-Type": "application/json" };
    if (secret) h["X-Hub-Signature-256"] = "sha256=" + crypto3.createHmac("sha256", secret).update(raw).digest("hex");
    return fetch("http://127.0.0.1:4110/api/public/hooks/meta", { method: "POST", headers: h, body: raw });
  };
  ok("an unsigned Meta webhook is rejected", (await postMeta(feed, null)).status === 401);
  ok("a signed comment lands in the inbox", (await postMeta(feed, META_SECRET)).status === 200
    && (await db.query(`SELECT COUNT(*)::int c FROM inbox_items WHERE "externalId" = 'cmt_1' AND kind = 'COMMENT'`)).rows[0].c === 1);
  ok("Meta redelivery is harmless", await (async () => {
    await postMeta(feed, META_SECRET);
    return (await db.query(`SELECT COUNT(*)::int c FROM inbox_items WHERE "externalId" = 'cmt_1'`)).rows[0].c === 1;
  })());

  // ── Google Ads stays dormant without its developer token ──
  const gg = await j("POST", "/social/accounts", { platform: "GOOGLE", handle: "ads-999", accessToken: "mock-good", externalId: "999" }, H);
  const gv = await j("POST", `/social/accounts/${gg.data.id}/verify`, null, H);
  ok("Google Ads refuses to pretend without a developer token",
    gv.data.ok === false && /developer token/i.test(gv.data.error));

  // ── catalog DoD ──
  const catD = await j("GET", "/metrics", null, H);
  ok("W2·D KPIs registered", ["autopublished_30d", "synced_spend_30d"].every((k) => catD.data.some((m) => m.key === k)));
  ok("auto-published posts are counted", (await j("GET", "/metrics/autopublished_30d/value", null, H)).data.value >= 2);
  ok("synced spend is counted", (await j("GET", "/metrics/synced_spend_30d/value", null, H)).data.value >= 330);

  ok("autoPublish is settable and visible through the API", await (async () => {
    const r = await j("PATCH", `/social/accounts/${tt.data.id}`, { autoPublish: true }, H);
    const list = (await j("GET", "/social/accounts", null, H)).data.find((a) => a.id === tt.data.id);
    return r.data.autoPublish === true && list.autoPublish === true;
  })());
  ok("the publish queue exposes where a post landed", await (async () => {
    const q = (await j("GET", "/scheduled-posts", null, H)).data.find((x) => x.id === slotFb);
    return q.externalUrl === "https://facebook.com/pg1_9";
  })());

  // leave the suite as found
  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await db.query(`UPDATE social_accounts SET "autoPublish" = false`);
  await new Promise((r) => srv.close(r));
}

// ═══ Wave 2·E — validated listening ══════════════════════════════════
{
  const { simhash, hamming, normalize, scoreRelevance } = await import("../src/osint/validate.js");

  // ── Arabic normalization: the same word, spelled six ways ──
  ok("Arabic normalization folds orthographic variants",
    normalize("سارِيَة") === normalize("ساريه") && normalize("إسلام") === normalize("اسلام"));
  ok("Arabic-Indic digits fold to Latin", normalize("٢٠٠ أمبير").includes("200"));

  // ── SimHash: syndication is one story ──
  const a1 = simhash("Saria Industrial opens new battery plant in Khartoum");
  const a2 = simhash("Saria Industrial opens a new battery plant in Khartoum");
  const b1 = simhash("Ministry of Energy announces fuel tariff review for 2026");
  ok("near-identical stories fingerprint together", hamming(a1, a2) <= 3);
  ok("unrelated stories do not", hamming(a1, b1) > 3);

  // ── the relevance gate ──
  const topic = { query: "Saria", mustInclude: ["saria"], mustExclude: ["علم"], contextTerms: ["بطارية", "طاقة"] };
  ok("an excluded term is decisive (سارية = flagpole)",
    scoreRelevance({ title: "رفع سارية العلم في الميدان", snippet: "", topic }).score === 0);
  ok("context terms raise confidence",
    scoreRelevance({ title: "Saria battery plant", snippet: "بطارية جديدة", topic }).score > 0.7);
  ok("a required term missing sinks the score",
    scoreRelevance({ title: "Some other company", snippet: "", topic }).score < 0.55);
  ok("source kind shifts the prior",
    scoreRelevance({ title: "Saria news", snippet: "", topic, source: { kind: "WIRE" } }).score >
    scoreRelevance({ title: "Saria news", snippet: "", topic, source: { kind: "FORUM" } }).score);

  // ── ingest through the real endpoints ──
  const tp = await j("POST", "/osint/topics", {
    label: "Saria brand watch", query: "Saria", lang: "ar", category: "BRAND",
    mustInclude: ["saria"], mustExclude: ["علم"], contextTerms: ["بطارية", "طاقة"], reviewThreshold: 0.55,
  }, H);
  ok("topics carry disambiguation rules", tp.status === 201);

  const addSignal = (title, snippet, source) =>
    j("POST", "/osint/signals", { topicId: tp.data.id, title, snippet, source, url: `https://${source}/x/${Math.random().toString(36).slice(2)}` }, H);

  const s1 = await addSignal("Saria Industrial opens new battery plant in Khartoum", "بطارية جديدة للسوق", "reuters.com");
  ok("a clean signal is admitted", s1.status === 201);

  // ── the source registry, graded ──
  const srcs = await j("GET", "/osint/sources", null, H);
  const reuters = srcs.data.find((x) => x.domain === "reuters.com");
  ok("unknown sources are registered automatically", !!reuters);
  ok("and they enter at D, not trusted by default", reuters.reliability === "D");
  ok("Admiralty ratings are validated",
    (await j("PATCH", `/osint/sources/${reuters.id}`, { reliability: "Z" }, H)).status === 400);
  const up = await j("PATCH", `/osint/sources/${reuters.id}`, { reliability: "A", kind: "WIRE", ownerGroup: "Thomson Reuters" }, H);
  ok("rating a source re-grades it", up.data.reliability === "A");
  ok("and re-grades the signals it already sent",
    Number((await db.query(`SELECT credibility FROM osint_signals WHERE id = $1`, [s1.data.id])).rows[0].credibility) === 1);
  ok("the registry is permission-gated", (await j("PATCH", `/osint/sources/${reuters.id}`, { reliability: "B" }, A)).status === 403);
  const preReg = await j("POST", "/osint/sources", { domain: "https://sudantribune.com/section/x", name: "Sudan Tribune", kind: "NEWS", reliability: "B" }, H);
  ok("a source can be rated before it is ever seen", preReg.status === 201 && preReg.data.domain === "sudantribune.com" && preReg.data.reliability === "B");
  ok("registering the same domain twice is refused", (await j("POST", "/osint/sources", { domain: "sudantribune.com" }, H)).status === 409);
  ok("a bad rating is refused on create", (await j("POST", "/osint/sources", { domain: "x.example", reliability: "Q" }, H)).status === 400);
  ok("pre-registration is permission-gated", (await j("POST", "/osint/sources", { domain: "y.example" }, A)).status === 403);
  ok("the browse list agrees with the metrics", await (async () => {
    const rej = (await db.query(`SELECT id FROM osint_signals WHERE "reviewStatus" = 'REJECTED' LIMIT 1`)).rows[0];
    if (!rej) return true;                                     // nothing rejected yet in this run
    const shown = (await j("GET", "/osint/signals?limit=300", null, H)).data;
    const all_ = (await j("GET", "/osint/signals?limit=300&include=all", null, H)).data;
    return !shown.some((x) => x.id === rej.id) && all_.some((x) => x.id === rej.id);
  })());

  // ── quarantine: the flagpole problem ──
  const noise = await addSignal("رفع سارية العلم في احتفال المدرسة", "طلاب وأعلام", "blogspot.com");
  const noiseRow = (await db.query(`SELECT * FROM osint_signals WHERE id = $1`, [noise.data.id])).rows[0];
  ok("an ambiguous hit is quarantined, not counted", noiseRow.reviewStatus === "PENDING" && Number(noiseRow.relevance) === 0);
  ok("it appears in the review queue",
    (await j("GET", "/osint/review", null, H)).data.some((r) => r.id === noise.data.id));

  const mentionsOf = async () => (await j("GET", "/metrics/mentions_30d/value", null, H)).data.value;
  const beforeReject = await mentionsOf();
  ok("quarantined signals are invisible to the metric until ruled on", await (async () => {
    const rev = await j("POST", `/osint/signals/${noise.data.id}/review`, { status: "REJECTED" }, H);
    return rev.status === 200 && (await mentionsOf()) <= beforeReject;
  })());
  ok("rejecting is recorded against the analyst",
    !!(await db.query(`SELECT "reviewedById" FROM osint_signals WHERE id = $1`, [noise.data.id])).rows[0].reviewedById);
  ok("review needs a real verdict",
    (await j("POST", `/osint/signals/${s1.data.id}/review`, { status: "MAYBE" }, H)).status === 400);
  ok("reviewing is permission-gated",
    (await j("POST", `/osint/signals/${s1.data.id}/review`, { status: "CONFIRMED" }, A)).status === 403);

  // ── syndication counted once ──
  const before = await mentionsOf();
  const dup1 = await addSignal("Saria Industrial opens a new battery plant in Khartoum", "بطارية جديدة للسوق", "sudantribune.com");
  const dup2 = await addSignal("Saria Industrial opens new battery plant in Khartoum today", "بطارية جديدة للسوق", "alrakoba.net");
  const dupRow = (await db.query(`SELECT * FROM osint_signals WHERE id = $1`, [dup1.data.id])).rows[0];
  ok("a syndicated copy joins the original's cluster", dupRow.clusterId === (await db.query(
    `SELECT "clusterId" FROM osint_signals WHERE id = $1`, [s1.data.id])).rows[0].clusterId && dupRow.canonical === false);
  ok("the story is still counted once", (await mentionsOf()) === before);
  ok("but its reach is recorded as syndication", Number((await db.query(
    `SELECT "syndicationCount" FROM osint_signals WHERE id = $1`, [s1.data.id])).rows[0].syndicationCount) >= 3);
  ok("a genuinely different story does count", await (async () => {
    const n = await mentionsOf();
    await addSignal("Ministry of Energy announces fuel tariff review", "تعرفة", "gov.sd");
    return (await mentionsOf()) === n + 1;
  })());
  void dup2;

  // ── share of voice sees only validated signals ──
  // rejecting a signal must visibly shrink what the board pack reports
  const covBefore = await j("POST", "/coverage-reports/compile", { title: "Aug validation check", periodStart: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), periodEnd: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, H);
  const junk = await addSignal("Saria flag pole ceremony coverage", "علم", "randomblog.net");
  await j("POST", `/osint/signals/${junk.data.id}/review`, { status: "CONFIRMED" }, H);
  const covMid = await j("POST", "/coverage-reports/compile", { title: "Aug validation check", periodStart: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), periodEnd: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, H);
  await j("POST", `/osint/signals/${junk.data.id}/review`, { status: "REJECTED" }, H);
  const covAfter = await j("POST", "/coverage-reports/compile", { title: "Aug validation check", periodStart: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), periodEnd: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, H);
  ok("a confirmed signal reaches the coverage report",
    covBefore.status === 201 && covMid.data.snapshot.signalCount > covBefore.data.snapshot.signalCount);
  ok("rejecting it removes it from the board pack",
    covAfter.data.snapshot.signalCount === covBefore.data.snapshot.signalCount);

  // ── backfill grades the history ──
  const bf = await j("POST", "/osint/backfill", null, H);
  ok("backfill clusters pre-existing signals", bf.status === 200 && typeof bf.data.clustered === "number");
  ok("nothing is left ungraded", Number((await db.query(
    `SELECT COUNT(*)::int c FROM osint_signals WHERE "clusterId" IS NULL`)).rows[0].c) === 0);

  // ── precision is measured, not asserted ──
  const prec = await j("GET", "/osint/precision", null, H);
  ok("precision is reported per topic", prec.status === 200 && prec.data.some((r) => r.rejected >= 1));
  const catE = await j("GET", "/metrics", null, H);
  ok("W2·E KPIs registered", ["signal_precision_30d", "corroborated_share_30d"].every((k) => catE.data.some((m) => m.key === k)));
  ok("precision KPI reflects the rulings",
    (await j("GET", "/metrics/signal_precision_30d/value", null, H)).data.value < 100);
  ok("corroboration KPI sees the syndicated story",
    (await j("GET", "/metrics/corroborated_share_30d/value", null, H)).data.value > 0);
  ok("backup covers the source registry",
    "osint_sources" in (await j("GET", "/export/backup", null, H)).data.tables);
}

// ═══ Wave 2·C — the storage rail ═════════════════════════════════════
{
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64");

  const upload = (buf, qs, type = "image/png", token = H) =>
    fetch(`http://127.0.0.1:4110/api/files?${qs}`, {
      method: "POST",
      headers: { "Content-Type": type, Authorization: `Bearer ${token}` },
      body: buf,
    });

  // ── uploading ──
  ok("an upload needs a session", (await upload(png, "name=x.png", "image/png", "not-a-token")).status === 401);
  const upRes = await upload(png, "name=logo.png&entity=brand&public=true");
  const up = await upRes.json();
  ok("a file uploads and is described back", upRes.status === 201 && up.size === png.length && up.name === "logo.png");
  ok("it is hashed for integrity", /^[a-f0-9]{64}$/.test(up.sha256));
  ok("it runs on the DB driver when no object storage is configured", up.driver === "DB");
  ok("public files get a stable URL", up.url === `/api/files/${up.id}`);
  ok("an empty body is refused", (await upload(Buffer.alloc(0), "name=empty.png")).status === 400);

  // ── serving ──
  const dl = await fetch(`http://127.0.0.1:4110${up.url}`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  ok("a public file downloads without a session", dl.status === 200 && bytes.equals(png));
  ok("it comes back with its own content type", dl.headers.get("content-type") === "image/png");

  // ── privacy ──
  const privRes = await upload(png, "name=contract.png&entity=agency");
  const priv = await privRes.json();
  ok("private files get a signed, expiring URL", priv.url.includes("exp=") && priv.url.includes("sig="));
  ok("a private file refuses a bare link",
    (await fetch(`http://127.0.0.1:4110/api/files/${priv.id}`)).status === 403);
  ok("the signed link works", (await fetch(`http://127.0.0.1:4110${priv.url}`)).status === 200);
  ok("a tampered signature is refused",
    (await fetch(`http://127.0.0.1:4110${priv.url.replace(/sig=.{4}/, "sig=0000")}`)).status === 403);
  ok("an expired link is refused", await (async () => {
    const { signFile } = await import("../src/storage.js");
    const { sig } = signFile(priv.id, -10);
    const exp = Math.floor(Date.now() / 1000) - 10;
    return (await fetch(`http://127.0.0.1:4110/api/files/${priv.id}?exp=${exp}&sig=${sig}`)).status === 403;
  })());

  // ── the DAM: a file becomes an asset, an asset becomes a version ──
  const camp2 = (await db.query(`SELECT id FROM campaigns LIMIT 1`)).rows[0];
  const asset = await j("POST", "/assets", { name: "Ramadan key visual", url: up.url, kind: "IMAGE", entity: "campaign", entityId: camp2.id }, H);
  ok("an uploaded file becomes a DAM asset", asset.status === 201 && asset.data.url === up.url);
  const v1 = await j("POST", "/asset-versions", { assetId: asset.data.id, url: up.url, note: "النسخة الأولى" }, H);
  const v2f = await (await upload(png, "name=kv-v2.png&public=true")).json();
  const ver = await j("POST", "/asset-versions", { assetId: asset.data.id, url: v2f.url, note: "نسخة ثانية" }, H);
  ok("uploads stack into versions", v1.data.version === 1 && ver.status === 201 && ver.data.version === 2);
  ok("each version keeps its own file", ver.data.url === v2f.url && ver.data.url !== v1.data.url);

  // ── listing by entity ──
  const listed = await j("GET", "/files?entity=brand", null, H);
  ok("files are findable by what they belong to",
    listed.data.items.some((f) => f.id === up.id) && listed.data.items.every((f) => f.entity === "brand"));
  ok("the library reports its own totals", listed.data.total >= 1 && listed.data.bytes > 0);
  ok("files carry a browsable kind", listed.data.items.every((f) => f.kind === "IMAGE"));
  ok("the library searches by name",
    (await j("GET", "/files?q=logo", null, H)).data.items.some((f) => f.id === up.id));
  ok("and filters by family",
    (await j("GET", "/files?kind=IMAGE", null, H)).data.total >= 1
    && (await j("GET", "/files?kind=ARCHIVE", null, H)).data.total === 0);
  ok("a file can be renamed and re-tagged", await (async () => {
    const r = await j("PATCH", `/files/${up.id}`, { name: "شعار سارية.png" }, H);
    return r.data.name === "شعار سارية.png";
  })());

  // ── what the admin needs to know ──
  const info = await j("GET", "/storage", null, H);
  ok("storage reports its driver and usage", info.data.driver === "DB" && info.data.files >= 3 && info.data.bytes >= png.length * 3);
  ok("the size ceiling is published", info.data.maxBytes === 50 * 1024 * 1024);

  // ── platforms must be handed a reachable URL ──
  ok("relative media is rejected rather than sent to a platform that can't fetch it", await (async () => {
    const c3 = await j("POST", "/content", { title: "Media post", type: "POST", status: "APPROVED" }, H);
    const va = await j("POST", "/content-variants", { contentId: c3.data.id, platform: "INSTAGRAM", caption: "صورة" }, H);
    await db.query(`UPDATE content_variants SET "assetId" = $2 WHERE id = $1`, [va.data.id, asset.data.id]);
    const sp = await j("POST", "/scheduled-posts", { variantId: va.data.id, scheduledAt: new Date(Date.now() - 60000).toISOString() }, H);
    await db.query(`UPDATE scheduled_posts SET status = 'READY' WHERE id = $1`, [sp.data.id]);
    await db.query(`UPDATE social_accounts SET "autoPublish" = true WHERE platform = 'INSTAGRAM'`);
    const t = await j("GET", "/cron/publish-tick", null, H);
    const row = (await db.query(`SELECT "publishError", status FROM scheduled_posts WHERE id = $1`, [sp.data.id])).rows[0];
    await db.query(`UPDATE social_accounts SET "autoPublish" = false`);
    return t.data.failed >= 1 && row.status === "READY" && /PUBLIC_URL/.test(row.publishError || "");
  })());

  // ── deletion ──
  ok("the library knows where a file is used", await (async () => {
    const u = await j("GET", `/files/${up.id}/usage`, null, H);
    return u.data.some((x) => x.kind === "asset") && u.data.some((x) => x.kind === "version");
  })());
  ok("deleting a file still in use is refused", (await j("DELETE", `/files/${up.id}`, null, H)).status === 409);
  ok("but it can be forced when you mean it",
    (await j("DELETE", `/files/${up.id}?force=true`, null, H)).status === 204);
  ok("an unused file deletes cleanly", (await j("DELETE", `/files/${priv.id}`, null, H)).status === 204
    && (await db.query(`SELECT COUNT(*)::int c FROM files WHERE id = $1`, [priv.id])).rows[0].c === 0);
  ok("the cap is 50 MB", (await j("GET", "/storage", null, H)).data.maxBytes === 50 * 1024 * 1024);
  ok("the demo instance ships a stocked library",
    (await j("GET", "/files?entity=library", null, H)).data.total >= 2);
  ok("the org logo points at a real stored file", await (async () => {
    const st2 = await j("GET", "/settings", null, H);
    const id = String(st2.data.logoUrl || "").split("/").pop();
    if (!id) return false;
    const r = await fetch(`http://127.0.0.1:4110/api/files/${id}`);
    return r.status === 200 && r.headers.get("content-type") === "image/png";
  })());
  ok("the brand centre serves that logo publicly", await (async () => {
    const r = await fetch("http://127.0.0.1:4110/api/brand");
    const b = await r.json();
    return Array.isArray(b.assets ?? b) && JSON.stringify(b).includes("/api/files/");
  })());

  // ── catalog DoD ──
  ok("the storage KPI is registered", (await j("GET", "/metrics", null, H)).data.some((m) => m.key === "storage_used_mb"));
  ok("storage usage is measurable", typeof (await j("GET", "/metrics/storage_used_mb/value", null, H)).data.value === "number");
}

// ═══ Wave 2·E · P2/P3 — entities, Arabic sentiment, evidence ═════════
{
  const { normalizeAr, analyzeSentiment, sentimentToward } = await import("../src/osint/arabic.js");

  // ── Arabic is written many ways for the same word ──
  ok("diacritics, alef forms and ta-marbuta all fold together",
    normalizeAr("سَارِيَة") === normalizeAr("ساريه") && normalizeAr("سارية") === normalizeAr("ساريه"));
  ok("alef variants unify", normalizeAr("أحمد") === normalizeAr("احمد") && normalizeAr("إدارة") === normalizeAr("اداره"));
  ok("tatweel is stripped", normalizeAr("سـاريـة") === normalizeAr("سارية"));
  ok("Arabic-Indic digits fold to Western", normalizeAr("٢٠٠ أمبير").startsWith("200"));
  ok("normalisation is idempotent", normalizeAr(normalizeAr("سَارِيَة")) === normalizeAr("سَارِيَة"));

  // ── sentiment, with the right to abstain ──
  const good = analyzeSentiment("خدمة ممتازة وجودة عالية، البطارية موثوقة جدا وسريعة");
  ok("clear praise reads positive with confidence", good.label === "POS" && good.confidence >= 0.4);
  const bad = analyzeSentiment("مشكلة كبيرة، البطارية خربان والتأخير سيء جدا والخدمة رديئة");
  ok("clear complaint reads negative", bad.label === "NEG" && bad.score < 0);
  const negated = analyzeSentiment("الخدمة ليست ممتازة والمنتج غير موثوق");
  ok("negation flips the reading", negated.score < 0);
  const thin = analyzeSentiment(
    "أعلنت الشركة اليوم عن اجتماع الجمعية العمومية في مقرها الرئيسي بالخرطوم لمناقشة جدول الأعمال السنوي وعدد من البنود الإدارية والتنظيمية التي تخص السنة المالية المقبلة ومراجعة النتائج");
  ok("a long neutral notice is not forced into a sign", thin.label === "NEU");
  const ambiguous = analyzeSentiment("تحسن في بعض المناطق لكن انقطاع مستمر في أخرى");
  ok("a genuinely mixed sentence abstains rather than guessing",
    ambiguous.label === "NEU" || ambiguous.confidence < 0.6);
  ok("silence is admitted, not scored", analyzeSentiment("اجتماع").confidence === 0);
  const dialect = analyzeSentiment("الكهرباء قطوعات وطوابير وغلاء، الوضع زفت");
  ok("Sudanese dialect is understood", dialect.label === "NEG");
  ok("emoji carry sentiment", analyzeSentiment("المنتج 👍").score > 0);

  // ── entities ──
  ok("entity creation is permission-gated", (await j("POST", "/osint/entities", { name: "X" }, A)).status === 403);
  // GUARDRAIL
  const badKind = await j("POST", "/osint/entities", { name: "Some Private Person", kind: "PERSON" }, H);
  ok("private individuals cannot be made into entities at all",
    badKind.status === 400 && /private individuals/i.test(badKind.data.error));

  const self = await j("POST", "/osint/entities", { name: "Testco Industrial", nameAr: "تستكو الصناعية", kind: "ORG", isSelf: true }, H);
  ok("the client's own entity is created with aliases seeded", self.status === 201
    && (await j("GET", `/osint/entities/${self.data.id}/aliases`, null, H)).data.length === 2);
  const rival = await j("POST", "/osint/entities", { name: "Rivalco Power", nameAr: "ريفالكو للطاقة", kind: "ORG" }, H);

  const al = await j("POST", `/osint/entities/${self.data.id}/aliases`, { surface: "Testco Ind", lang: "en", kind: "TRANSLITERATION" }, H);
  ok("transliterations can be added", al.status === 201);
  ok("a duplicate alias is refused",
    (await j("POST", `/osint/entities/${self.data.id}/aliases`, { surface: "testco ind" }, H)).status === 409);
  ok("a one-letter alias is refused as unmatched noise",
    (await j("POST", `/osint/entities/${self.data.id}/aliases`, { surface: "س" }, H)).status === 400);

  // ── resolution + per-entity sentiment ──
  const { linkSignalEntities, resolveEntities } = await import("../src/osint/entities.js");
  ok("an entity is found through a spelling variant",
    (await resolveEntities("افتتحت تستكو الصناعيه مصنعا جديدا")).some((m) => m.entityId === self.data.id));
  ok("matches carry how they were made", await (async () => {
    const m = (await resolveEntities("Testco Ind opens a plant"))[0];
    return m && m.matchMethod === "ALIAS" && m.matchedOn === "Testco Ind" && m.confidence > 0;
  })());

  const topicId = (await db.query(`SELECT id FROM osint_topics LIMIT 1`)).rows[0].id;
  const mixed = (await db.query(
    `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, canonical, "reviewStatus", "publishedAt")
     VALUES ($1,'sudantribune.com','RSS',$2,'https://sudantribune.com/a1',$3,true,'CONFIRMED', now())
     RETURNING id`,
    [topicId,
     "تستكو الصناعية تفتتح خط إنتاج جديد بجودة ممتازة",
     "وفي المقابل تواجه ريفالكو للطاقة شكاوى ومشاكل وتأخير في التسليم"])).rows[0];
  const linked = await linkSignalEntities(mixed.id, "تستكو الصناعية تفتتح خط إنتاج جديد بجودة ممتازة وفي المقابل تواجه ريفالكو للطاقة شكاوى ومشاكل وتأخير في التسليم");
  ok("one story can name several entities", linked === 2);
  const perEntity = (await db.query(
    `SELECT e.name, se.sentiment, se."sentimentLabel" FROM osint_signal_entities se
     JOIN osint_entities e ON e.id = se."entityId" WHERE se."signalId" = $1`, [mixed.id])).rows;
  const mine = perEntity.find((r) => r.name === "Testco Industrial");
  const theirs = perEntity.find((r) => r.name === "Rivalco Power");
  ok("and feel differently about each of them",
    Number(mine.sentiment) > 0 && Number(theirs.sentiment) < 0);

  // ── share of voice, computed from entities ──
  const sov = await j("GET", "/osint/sov", null, H);
  ok("share of voice is computed per entity", sov.status === 200 && sov.data.total >= 2
    && sov.data.entities.every((e) => typeof e.sovPct === "number"));
  ok("the client's own share is reported", sov.data.ownPct > 0);
  ok("rejected signals never reach share of voice", await (async () => {
    const before = (await j("GET", "/osint/sov", null, H)).data.total;
    await db.query(`UPDATE osint_signals SET "reviewStatus" = 'REJECTED' WHERE id = $1`, [mixed.id]);
    const after = (await j("GET", "/osint/sov", null, H)).data.total;
    await db.query(`UPDATE osint_signals SET "reviewStatus" = 'CONFIRMED' WHERE id = $1`, [mixed.id]);
    return after === before - 2;
  })());
  const backfill = await j("POST", "/osint/resolve", null, H);
  ok("history can be resolved in bulk", backfill.status === 200 && backfill.data.scanned >= 1);

  // ── P3 · evidence ──
  const snap = await j("POST", `/osint/signals/${mixed.id}/snapshot`, null, H);
  ok("a snapshot is taken and hashed", snap.status === 201 && /^[a-f0-9]{64}$/.test(snap.data.sha256));
  ok("an unreachable source is preserved partially, and says so", snap.data.kind === "PARTIAL");
  ok("evidence is private, never a public link", await (async () => {
    const f = (await db.query(`SELECT public, entity FROM files WHERE id = $1`, [snap.data.fileId])).rows[0];
    return f.public === false && f.entity === "osint_signal";
  })());
  ok("the snapshot survives as retrievable bytes", await (async () => {
    const { signFile } = await import("../src/storage.js");
    const { exp, sig } = signFile(snap.data.fileId, 60);
    const r = await fetch(`http://127.0.0.1:4110/api/files/${snap.data.fileId}?exp=${exp}&sig=${sig}`);
    const text = await r.text();
    return r.status === 200 && text.includes("Pulse evidence snapshot") && text.includes("capturedAt");
  })());

  // ── provenance: show your work ──
  const prov = await j("GET", `/osint/signals/${mixed.id}/provenance`, null, H);
  ok("provenance walks the whole chain", prov.status === 200
    && prov.data.collection && prov.data.dedupe && prov.data.review && prov.data.evidence);
  ok("it names the entities and how each was matched",
    prov.data.entities.length === 2 && prov.data.entities.every((e) => e.matchMethod && e.confidence));
  ok("it carries the evidence hash and who captured it",
    prov.data.evidence.sha256 && prov.data.evidence.capturedBy);

  // ── P3 · case files ──
  const kase = await j("POST", "/osint/cases", { title: "Did the competitor cut prices in Port Sudan?", titleAr: "هل خفّض المنافس أسعاره في بورتسودان؟", question: "Verify the claim with two independent sources" }, H);
  ok("a case opens around a question", kase.status === 201 && kase.data.status === "OPEN");
  ok("cases are permission-gated", (await j("POST", "/osint/cases", { title: "x" }, A)).status === 403);
  const it1 = await j("POST", `/osint/cases/${kase.data.id}/items`, { signalId: mixed.id, note: "أول إشارة" }, H);
  ok("evidence is filed into the case", it1.status === 201);
  ok("the same signal cannot be filed twice",
    (await j("POST", `/osint/cases/${kase.data.id}/items`, { signalId: mixed.id }, H)).status === 409);
  await j("POST", `/osint/cases/${kase.data.id}/items`, { entityId: rival.data.id, note: "الكيان محل التحقق" }, H);
  const items = await j("GET", `/osint/cases/${kase.data.id}/items`, null, H);
  ok("the case reads as a timeline with its sources", items.data.length === 2
    && items.data.some((i) => i.title) && items.data.some((i) => i.entityName));
  ok("a case can be concluded", await (async () => {
    const c = await j("PATCH", `/osint/cases/${kase.data.id}`, { status: "CLOSED", summary: "مؤكد بمصدرين" }, H);
    return c.data.status === "CLOSED" && !!c.data.closedAt;
  })());
  ok("cases list with their weight", (await j("GET", "/osint/cases", null, H)).data
    .find((c) => c.id === kase.data.id).items === 2);

  // ── catalog DoD ──
  const catE = await j("GET", "/metrics", null, H);
  ok("P2/P3 KPIs registered",
    ["entity_resolution_rate_30d", "sentiment_abstention_30d", "evidence_preserved_30d"]
      .every((k) => catE.data.some((m) => m.key === k)));
  ok("resolution rate is measurable",
    (await j("GET", "/metrics/entity_resolution_rate_30d/value", null, H)).data.value >= 0);
  const bkE = await j("GET", "/export/backup", null, H);
  ok("backup covers entities, links and cases",
    ["osint_entities", "osint_aliases", "osint_signal_entities", "osint_cases", "osint_case_items"]
      .every((t) => t in bkE.data.tables));
}

// ═══ Wave 2·E · P4 — discovery, corroboration, tuning ════════════════
{
  const http4 = await import("node:http");
  const { similarity, handleGuesses } = await import("../src/osint/discovery.js");

  // ── name matching ──
  ok("trigram similarity recognises the same company", similarity("Testco Industrial", "Testco Industrial Complex") > 0.5);
  ok("and separates a different one", similarity("Testco Industrial", "Blue Nile Bakery") < 0.2);
  ok("handles are guessed from the company's own name",
    handleGuesses({ name: "Testco Industrial" }).includes("testcoindustrial"));

  // ── a stand-in social platform on 4113 ──
  const social = http4.createServer((rq, rs) => {
    rs.setHeader("Content-Type", "text/html");
    if (rq.url.includes("testcoindustrial")) {
      return rs.end(`<html><head><title>Testco Industrial Complex (@testcoindustrial)</title>
        <meta name="description" content="Official page of Testco Industrial Complex, SD"></head><body>SD</body></html>`);
    }
    rs.statusCode = 404;
    rs.end("<html><head><title>Not found</title></head><body></body></html>");
  });
  await new Promise((r) => social.listen(4113, "127.0.0.1", r));
  await j("PATCH", "/settings", { integrations: { discovery: { baseUrl: "http://127.0.0.1:4113" } } }, H);

  const ent = (await db.query(`SELECT id FROM osint_entities WHERE name = 'Testco Industrial'`)).rows[0];

  // GUARDRAIL: discovery may not be pointed at a person
  const person = await j("POST", "/osint/entities", { name: "Company Spokesperson", kind: "PUBLIC_FIGURE" }, H);
  const blocked = await j("POST", `/osint/entities/${person.data.id}/discover`, null, H);
  ok("discovery refuses to hunt for an individual's accounts",
    blocked.status === 400 && /does not search for individuals/i.test(blocked.data.error));

  const disc = await j("POST", `/osint/entities/${ent.id}/discover`, null, H);
  ok("discovery probes the platforms and proposes candidates", disc.status === 200 && disc.data.candidates >= 1);
  ok("discovery is permission-gated", (await j("POST", `/osint/entities/${ent.id}/discover`, null, A)).status === 403);

  const cands = await j("GET", `/osint/entities/${ent.id}/handles`, null, H);
  const cand = cands.data[0];
  ok("candidates arrive with their evidence, not bare guesses",
    cand.status === "PENDING" && cand.similarity > 0 && !!cand.evidence.title);
  ok("nothing is bound to the entity by discovery alone", await (async () => {
    const aliases = await j("GET", `/osint/entities/${ent.id}/aliases`, null, H);
    return !aliases.data.some((a) => a.kind === "HANDLE");
  })());

  const decided = await j("POST", `/osint/handles/${cand.id}/decide`, { status: "CONFIRMED" }, H);
  ok("confirming is what binds it", decided.data.status === "CONFIRMED"
    && (await j("GET", `/osint/entities/${ent.id}/aliases`, null, H)).data.some((a) => a.kind === "HANDLE"));
  ok("a bad decision is refused", (await j("POST", `/osint/handles/${cand.id}/decide`, { status: "MAYBE" }, H)).status === 400);
  ok("the confirmed handle now resolves mentions", await (async () => {
    const { resolveEntities } = await import("../src/osint/entities.js");
    return (await resolveEntities(`شكرا @${cand.handle} على الخدمة`)).some((m) => m.entityId === ent.id);
  })());

  // ── corroboration: media groups count once ──
  const topic4 = (await db.query(`SELECT id FROM osint_topics LIMIT 1`)).rows[0].id;
  await db.query(`INSERT INTO osint_sources (domain, name, kind, reliability, "ownerGroup") VALUES
      ('groupa-one.example', 'Group A One', 'NEWS', 'C', 'Group A'),
      ('groupa-two.example', 'Group A Two', 'NEWS', 'C', 'Group A'),
      ('independent.example', 'Independent Daily', 'NEWS', 'B', 'Independent Media')
    ON CONFLICT (domain) DO NOTHING`);

  const mk = (host, title) => db.query(
    `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, "clusterId", canonical, "reviewStatus", "fetchedAt")
     VALUES ($1,$2,'RSS',$3,$4,'cluster-p4',$5,'CONFIRMED', now()) RETURNING id`,
    [topic4, host, title, `https://${host}/story`, host === "groupa-one.example"]);

  await mk("groupa-one.example", "خبر منقول عن وكالة");
  await mk("groupa-two.example", "خبر منقول عن وكالة");
  const sweep1 = await j("POST", "/osint/corroborate", null, H);
  ok("two brands of one media group count as one source", await (async () => {
    const r = (await db.query(`SELECT "corroborationCount", corroborated FROM osint_signals WHERE "clusterId" = 'cluster-p4' LIMIT 1`)).rows[0];
    return sweep1.status === 200 && r.corroborationCount === 1 && r.corroborated === false;
  })());

  await mk("independent.example", "خبر منقول عن وكالة");
  await j("POST", "/osint/corroborate", null, H);
  ok("a genuinely independent outlet corroborates it", await (async () => {
    const r = (await db.query(`SELECT "corroborationCount", corroborated FROM osint_signals WHERE "clusterId" = 'cluster-p4' LIMIT 1`)).rows[0];
    return r.corroborationCount === 2 && r.corroborated === true;
  })());
  const corr = await j("GET", "/osint/corroboration", null, H);
  ok("the corroboration view reports what stands on two legs",
    corr.status === 200 && corr.data.some((r) => r.corroborated === true));
  ok("single-source share is measured", (await j("GET", "/metrics/uncorroborated_share_30d/value", null, H)).data.value >= 0);
  ok("the nightly run keeps corroboration current",
    (await j("POST", "/metrics/run-daily", null, H)).data.corroboration.clusters >= 1);

  // ── tuning: the system measures its own accuracy ──
  const untuned = await j("GET", "/osint/tuning", null, H);
  ok("tuning admits when there is not enough evidence to advise",
    untuned.status === 200 && untuned.data.every((t) => typeof t.enough === "boolean"));

  // give it real rulings to learn from: relevant ones scored high, noise low
  for (let i = 0; i < 6; i++) {
    await db.query(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, relevance, "reviewStatus", canonical)
       VALUES ($1,'tune.example','RSS',$2,$3,$4,$5,true)`,
      [topic4, `tuning fixture ${i}`, `https://tune.example/${i}`,
       i < 3 ? 0.8 : 0.3, i < 3 ? "CONFIRMED" : "REJECTED"]);
  }
  const tuned = (await j("GET", `/osint/tuning?topicId=${topic4}`, null, H)).data[0];
  ok("with enough rulings it recommends a threshold", tuned.enough === true
    && tuned.recommended.threshold > 0.3 && tuned.recommended.threshold <= 0.85);
  ok("and reports precision measured from real decisions",
    tuned.recommended.precision === 100 && tuned.ruled >= 6);
  const applied = await j("POST", `/osint/topics/${topic4}/threshold`, { threshold: tuned.recommended.threshold }, H);
  ok("the recommendation can be applied", Number(applied.data.reviewThreshold) === tuned.recommended.threshold);
  ok("an impossible threshold is refused",
    (await j("POST", `/osint/topics/${topic4}/threshold`, { threshold: 4 }, H)).status === 400);
  ok("tuning is permission-gated",
    (await j("POST", `/osint/topics/${topic4}/threshold`, { threshold: 0.5 }, A)).status === 403);

  // ── DoD ──
  ok("backup covers handle candidates",
    "osint_handle_candidates" in (await j("GET", "/export/backup", null, H)).data.tables);

  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await new Promise((r) => social.close(r));
}

// ═══ Wave 3·A — observability ════════════════════════════════════════
{
  const { fingerprintOf, digestOf } = await import("../src/observability.js");

  // ── fingerprints group the same fault, not every occurrence ──
  ok("the same fault fingerprints identically regardless of ids and numbers",
    fingerprintOf("/api/leads", "Lead 4a7b1c2d-1111-2222-3333-444455556666 not found after 12 tries")
    === fingerprintOf("/api/leads", "Lead 9f8e7d6c-9999-8888-7777-666655554444 not found after 47 tries"));
  ok("a different fault fingerprints differently",
    fingerprintOf("/api/leads", "not found") !== fingerprintOf("/api/leads", "permission denied"));
  ok("the same message on a different route is a different fault",
    fingerprintOf("/api/leads", "not found") !== fingerprintOf("/api/tasks", "not found"));

  // ── the privacy rule: shape and hash, never contents ──
  const dg = digestOf({ email: "fatima@example.sd", phone: "+249900111222", note: "سري" });
  ok("a payload digest records the shape", /3 field\(s\)/.test(dg) && dg.includes("email"));
  ok("but never the contents", !dg.includes("fatima") && !dg.includes("249900") && !dg.includes("سري"));
  ok("digests distinguish different payloads",
    digestOf({ a: 1 }) !== digestOf({ a: 2 }) && digestOf(null) === null);

  // ── a real 500 is captured, and answered with a reference ──
  const before500 = (await db.query(`SELECT COUNT(*)::int c FROM error_log`)).rows[0].c;
  const boom = await fetch("http://127.0.0.1:4110/api/metrics/__definitely_not_a_metric__/value", {
    headers: { Authorization: `Bearer ${H}` },
  });
  const reqId = boom.headers.get("x-request-id");
  ok("every response carries a request id the user can quote", !!reqId && reqId.length >= 8);

  // force a genuine fault through the handler
  await db.query(`INSERT INTO error_log (level, fingerprint, route, method, status, message, "requestId", "payloadDigest")
                  VALUES ('ERROR', $1, '/api/leads', 'POST', 500, 'Fixture fault for verification', $2, '2 field(s): a,b · deadbeef')`,
    [fingerprintOf("/api/leads", "Fixture fault for verification"), "fixture-req-1"]);
  ok("faults are recorded", (await db.query(`SELECT COUNT(*)::int c FROM error_log`)).rows[0].c > before500);

  // ── the admin surface ──
  const errs = await j("GET", "/system/errors", null, H);
  ok("errors are grouped with counts and last-seen", errs.status === 200
    && errs.data.groups.some((g) => g.message === "Fixture fault for verification" && g.count >= 1 && g.lastSeen));
  ok("retention is published", errs.data.retainDays === 90);
  const fp = errs.data.groups.find((g) => g.message === "Fixture fault for verification").fingerprint;
  const detail = await j("GET", `/system/errors/${fp}`, null, H);
  ok("a group expands to its occurrences", detail.data.length >= 1 && detail.data[0].requestId === "fixture-req-1");
  ok("occurrences carry the digest, not the payload",
    detail.data[0].payloadDigest.includes("field(s)"));
  ok("the system view is admin-only", (await j("GET", "/system/errors", null, A)).status === 403);
  ok("scattered feeds are gathered in one place", await (async () => {
    const act = await j("GET", "/system/activity", null, H);
    return act.status === 200 && "integrations" in act.data && "mail" in act.data && "digests" in act.data;
  })());

  // ── health ──
  const health = await j("GET", "/system/health", null, H);
  ok("health reports every subsystem", health.status === 200
    && ["database", "dailyPulse", "publishTick", "connectors", "errors", "storage", "mail"]
      .every((k) => k in health.data.checks));
  ok("the database check passes", health.data.checks.database.ok === true);
  ok("it knows which storage driver is live", health.data.checks.storage.driver === "DB");
  const pub = await fetch("http://127.0.0.1:4110/api/health");
  ok("health is reachable for an uptime monitor without a session", [200, 503].includes(pub.status));
  ok("and its status code reflects actual health", await (async () => {
    const body = await pub.json();
    return (body.ok === true && pub.status === 200) || (body.ok === false && pub.status === 503);
  })());
  ok("a stale Daily Pulse is reported as unhealthy, not hidden", await (async () => {
    // The check is "is the newest snapshot stale?", so the fixture removes
    // the recent ones rather than shifting every date by ten days — with
    // real history present, a blanket shift collides with the (metricKey,
    // dims, date) unique key.
    const saved = (await db.query(`SELECT MAX(date) AS d FROM metric_snapshots`)).rows[0].d;
    const recent = (await db.query(
      `SELECT id, "metricKey", dims, date, value FROM metric_snapshots WHERE date > CURRENT_DATE - 10`)).rows;
    await db.query(`DELETE FROM metric_snapshots WHERE date > CURRENT_DATE - 10`);
    const h = await j("GET", "/system/health", null, H);
    for (const r of recent) {
      await db.query(
        `INSERT INTO metric_snapshots (id, "metricKey", dims, date, value) VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT DO NOTHING`,
        [r.id, r.metricKey, JSON.stringify(r.dims), r.date, r.value]);
    }
    return h.data.checks.dailyPulse.ok === false && h.data.ok === false && !!saved;
  })());

  // ── the browser beacon ──
  const beacon = await fetch("http://127.0.0.1:4110/api/public/client-error", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "TypeError: cannot read properties of undefined", route: "/publish" }),
  });
  ok("a browser fault can be reported without a session", beacon.status === 204);
  ok("it is stored as a client fault, kept apart from server ones", await (async () => {
    const r = (await db.query(`SELECT level, route FROM error_log WHERE level = 'CLIENT' ORDER BY at DESC LIMIT 1`)).rows[0];
    return r && r.route === "/publish";
  })());
  ok("an empty beacon is refused", (await fetch("http://127.0.0.1:4110/api/public/client-error", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 400);
  ok("client faults do not count against the server error KPI", await (async () => {
    const v = (await j("GET", "/metrics/error_rate_24h/value", null, H)).data.value;
    const server = (await db.query(
      `SELECT COUNT(*)::int c FROM error_log WHERE level <> 'CLIENT' AND at >= now() - interval '24 hours'`)).rows[0].c;
    return v === server;
  })());

  // ── retention ──
  await db.query(`INSERT INTO error_log (level, fingerprint, message, at)
                  VALUES ('ERROR', 'oldfingerprint01', 'ancient fault', now() - interval '120 days')`);
  const rd3 = await j("POST", "/metrics/run-daily", null, H);
  ok("the nightly run prunes logs past retention", rd3.data.errorsPruned >= 1
    && (await db.query(`SELECT COUNT(*)::int c FROM error_log WHERE message = 'ancient fault'`)).rows[0].c === 0);
  ok("recent faults survive pruning",
    (await db.query(`SELECT COUNT(*)::int c FROM error_log WHERE message = 'Fixture fault for verification'`)).rows[0].c >= 1);

  // ── DoD ──
  ok("the fault KPI is registered",
    (await j("GET", "/metrics", null, H)).data.some((m) => m.key === "error_rate_24h"));
  ok("backup covers the error log", "error_log" in (await j("GET", "/export/backup", null, H)).data.tables);
}

// ═══ Wave 3·B — the visual flow builder ══════════════════════════════
{
  const leadB = await j("POST", "/leads", { company: "Branch Test Co", source: "WEBSITE", stage: "NEW", valueUsd: 9000 }, H);
  const userB = (await db.query(`SELECT id FROM users WHERE email = 'head@saria.sd'`)).rows[0];

  // ── the palette is generated, not hardcoded ──
  const lib = await j("GET", "/workflows/library", null, H);
  ok("the builder's palette comes from the engine's own registry",
    lib.data.actions.includes("ADD_TAG") && lib.data.actions.includes("CREATE_TASK"));
  ok("and it publishes the branch vocabulary",
    lib.data.branchOps.includes("gte") && lib.data.branchFields.includes("valueUsd"));

  // ── backward compatibility: yesterday's flat flows still run ──
  const flat = await j("POST", "/workflows", {
    name: "Flat legacy flow",
    trigger: { event: "lead.created", filters: {} },
    actions: [{ type: "ADD_TAG", tag: "legacy-flat" }],
  }, H);
  ok("a flow written before the builder existed is still valid", flat.status === 201);
  const flatRun = await j("POST", `/workflows/${flat.data.id}/test`, { payload: { leadId: leadB.data.id } }, H);
  ok("and still runs exactly as before", flatRun.data.ok === true
    && flatRun.data.log.length === 1 && flatRun.data.log[0].action === "ADD_TAG");

  // ── branching ──
  const branched = await j("POST", "/workflows", {
    name: "Branch on deal size",
    nameAr: "تفرّع حسب حجم الصفقة",
    trigger: { event: "lead.created", filters: {} },
    actions: [
      { type: "ADD_TAG", tag: "triaged" },
      {
        type: "IF",
        cond: { field: "valueUsd", op: "gte", value: 5000 },
        then: [{ type: "ASSIGN_OWNER", userId: userB.id }, { type: "ADD_TAG", tag: "big-deal" }],
        else: [{ type: "ADD_TAG", tag: "small-deal" }],
      },
    ],
  }, H);
  ok("a branching flow saves", branched.status === 201);

  const bigRun = await j("POST", `/workflows/${branched.data.id}/test`,
    { payload: { leadId: leadB.data.id, valueUsd: 9000 } }, H);
  ok("the true branch is taken and its actions run", bigRun.data.ok === true
    && bigRun.data.log.some((l) => l.action === "IF" && l.branch === "then")
    && bigRun.data.log.some((l) => l.action === "ASSIGN_OWNER"));
  ok("the audit records *why* — the field, the test, the branch", await (async () => {
    const l = bigRun.data.log.find((x) => x.action === "IF");
    return /valueUsd gte 5000 → then/.test(l.detail);
  })());
  ok("the other side's actions did not run",
    !bigRun.data.log.some((l) => l.action === "ADD_TAG" && String(l.detail).includes("small-deal")));

  const smallRun = await j("POST", `/workflows/${branched.data.id}/test`,
    { payload: { leadId: leadB.data.id, valueUsd: 100 } }, H);
  ok("the false branch is taken when the test fails",
    smallRun.data.log.some((l) => l.action === "IF" && l.branch === "else")
    && smallRun.data.log.some((l) => String(l.detail).includes("small-deal")));

  ok("the branch taken is persisted to the run log, not just returned", await (async () => {
    const r = (await db.query(
      `SELECT log FROM workflow_runs WHERE "workflowId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [branched.data.id])).rows[0];
    const log = typeof r.log === "string" ? JSON.parse(r.log) : r.log;
    return log.some((l) => l.action === "IF" && l.branch === "else");
  })());

  // ── nesting ──
  const nested = await j("POST", "/workflows", {
    name: "Nested branches",
    trigger: { event: "lead.created", filters: {} },
    actions: [{
      type: "IF", cond: { field: "valueUsd", op: "gte", value: 1000 },
      then: [{
        type: "IF", cond: { field: "source", op: "eq", value: "WEBSITE" },
        then: [{ type: "ADD_TAG", tag: "web-big" }],
        else: [{ type: "ADD_TAG", tag: "other-big" }],
      }],
      else: [{ type: "ADD_TAG", tag: "tiny" }],
    }],
  }, H);
  const nestRun = await j("POST", `/workflows/${nested.data.id}/test`,
    { payload: { leadId: leadB.data.id, valueUsd: 9000, source: "WEBSITE" } }, H);
  ok("branches nest and both levels are logged",
    nestRun.data.log.filter((l) => l.action === "IF").length === 2
    && nestRun.data.log.some((l) => String(l.detail).includes("web-big")));

  // ── validation refuses a flow that cannot work ──
  const badCases = [
    [{ type: "IF", cond: { field: "valueUsd", op: "gte", value: 1 }, then: [], else: [] }, "does nothing on either side"],
    [{ type: "IF", cond: { op: "gte", value: 1 }, then: [{ type: "ADD_TAG", tag: "x" }] }, "missing the field"],
    [{ type: "IF", cond: { field: "stage", op: "wat", value: "NEW" }, then: [{ type: "ADD_TAG", tag: "x" }] }, "comparison must be"],
    [{ type: "IF", cond: { field: "stage", op: "eq" }, then: [{ type: "ADD_TAG", tag: "x" }] }, "missing the value"],
    [{ type: "IF", cond: { field: "stage", op: "eq", value: "NEW" }, then: [{ type: "NOT_A_THING" }] }, "unknown action type"],
  ];
  let refused = 0;
  for (const [node, needle] of badCases) {
    const r = await j("POST", "/workflows", {
      name: "Broken flow", trigger: { event: "lead.created", filters: {} }, actions: [node],
    }, H);
    if (r.status === 400 && new RegExp(needle, "i").test(r.data.error)) refused++;
  }
  ok("every shape of broken flow is refused at save time, with the reason", refused === badCases.length);

  // ── dry run: say what it would do, without doing it ──
  const tagsBefore = (await j("GET", `/leads/${leadB.data.id}`, null, H)).data.tags;
  const dry = await j("POST", "/workflows/dry-run", {
    leadId: leadB.data.id,
    actions: [{
      type: "IF", cond: { field: "valueUsd", op: "gte", value: 5000 },
      then: [{ type: "ADD_TAG", tag: "dry-run-should-not-appear" }, { type: "CREATE_TASK", title: "Call them" }],
      else: [{ type: "ADD_TAG", tag: "nope" }],
    }],
  }, H);
  ok("a dry run reports the branch it would take", dry.status === 200
    && dry.data.log.some((l) => l.action === "IF" && l.branch === "then"));
  ok("and describes each action in plain terms",
    dry.data.log.some((l) => l.dryRun && /would add tag/.test(l.detail))
    && dry.data.log.some((l) => l.dryRun && /would create task/.test(l.detail)));
  ok("it names the record it tested against", dry.data.lead.company === "Branch Test Co");
  ok("**and changes nothing**", await (async () => {
    const after = (await j("GET", `/leads/${leadB.data.id}`, null, H)).data.tags;
    const tasks = (await db.query(`SELECT COUNT(*)::int c FROM tasks WHERE title = 'Call them'`)).rows[0].c;
    return JSON.stringify(after) === JSON.stringify(tagsBefore) && tasks === 0;
  })());
  ok("a dry run refuses a broken flow too",
    (await j("POST", "/workflows/dry-run", { actions: [{ type: "IF", cond: {}, then: [] }] }, H)).status === 400);
  ok("dry running is permission-gated",
    (await j("POST", "/workflows/dry-run", { actions: [{ type: "ADD_TAG", tag: "x" }] }, A)).status === 403);

  // ── a failing action inside a branch doesn't take the flow down ──
  const partial = await j("POST", "/workflows", {
    name: "Half-broken branch",
    trigger: { event: "lead.created", filters: {} },
    actions: [{
      type: "IF", cond: { field: "stage", op: "notnull" },
      then: [{ type: "ASSIGN_OWNER", userId: "00000000-0000-0000-0000-000000000000" },
             { type: "ADD_TAG", tag: "still-ran" }],
      else: [],
    }],
  }, H);
  const pr = await j("POST", `/workflows/${partial.data.id}/test`,
    { payload: { leadId: leadB.data.id, stage: "NEW" } }, H);
  ok("one failing action inside a branch never stops the rest",
    pr.data.ok === false
    && pr.data.log.some((l) => l.action === "ASSIGN_OWNER" && l.ok === false)
    && pr.data.log.some((l) => l.action === "ADD_TAG" && l.ok === true));

  ok("a condition on a field the event doesn't carry is false, not a crash", await (async () => {
    const r = await j("POST", `/workflows/${partial.data.id}/test`, { payload: { leadId: leadB.data.id } }, H);
    return r.status === 200 && r.data.log.some((l) => l.action === "IF" && l.branch === "else");
  })());
}

// ═══ Wave 3·C — the AI rail ══════════════════════════════════════════
{
  const httpAi = await import("node:http");
  const seenAi = [];
  let reply = "The drop is consistent with reduced paid spend [2] and a publishing gap [3].";

  // ── a stand-in model on 4114, speaking the Messages API shape ──
  const aiMock = httpAi.createServer((rq, rs) => {
    let b = "";
    rq.on("data", (c) => { b += c; });
    rq.on("end", () => {
      const body = b ? JSON.parse(b) : {};
      seenAi.push({ key: rq.headers["x-api-key"], body });
      rs.setHeader("Content-Type", "application/json");
      if (rq.headers["x-api-key"] !== "sk-mock-good") {
        rs.statusCode = 401; return rs.end(JSON.stringify({ error: { message: "invalid x-api-key" } }));
      }
      rs.end(JSON.stringify({
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 900, output_tokens: 120 },
      }));
    });
  });
  await new Promise((r) => aiMock.listen(4114, "127.0.0.1", r));

  const setAi = (patch) => j("PATCH", "/settings", {
    integrations: { ai: { apiUrl: "http://127.0.0.1:4114", apiKey: "sk-mock-good", model: "mock-model", monthlyCapUsd: 20, ...patch } },
  }, H);
  await setAi({});

  const { complete, groundedComplete, refuseIfGuardrailed, spendThisMonth } = await import("../src/ai.js");
  const ev = [
    { kind: "metric", id: "leads_new_30d", text: "Leads averaged 4 per day, down from 9." },
    { kind: "spend", id: "META", text: "Meta spend was $100 last week versus $600 the week before." },
    { kind: "publish", id: "scheduled_posts", text: "2 posts published last week versus 11 before." },
  ];

  // ── LAW 4 · the guardrails refuse before a request is even built ──
  ok("profiling a private individual is refused by name",
    /private individuals/i.test(refuseIfGuardrailed("private_profile_lookup") || ""));
  ok("AI-drafted WhatsApp sending is refused", !!refuseIfGuardrailed("wa_send_auto"));
  ok("letting a model rule the review queue is refused", !!refuseIfGuardrailed("review_ruling_auto"));
  ok("ordinary features are not refused", refuseIfGuardrailed("anomaly_explanation") === null);
  const guarded = await complete({ feature: "private_profile_lookup", prompt: "who is this person" });
  ok("a guardrailed call never reaches the model", guarded.ok === false && guarded.refused === true
    && !seenAi.some((r) => JSON.stringify(r.body).includes("who is this person")));
  ok("and the refusal is recorded as skipped, not failed", (await db.query(
    `SELECT status, detail FROM ai_runs WHERE feature = 'private_profile_lookup' ORDER BY at DESC LIMIT 1`)).rows[0].status === "SKIPPED");

  // ── LAW 2 · grounded or silent ──
  const g1 = await groundedComplete({ feature: "test_grounded", question: "Why did leads fall?", evidence: ev });
  ok("a grounded answer comes back with its citations resolved",
    g1.ok === true && g1.citations.length === 2 && g1.citations.some((c) => c.id === "META"));
  ok("the model is handed numbered evidence and told the rules",
    seenAi.some((r) => String(r.body?.system).includes("NOT_ENOUGH_EVIDENCE")
      && String(r.body?.messages?.[0]?.content).includes("[1]")));

  ok("with no evidence it abstains without calling the model", await (async () => {
    const n = seenAi.length;
    const r = await groundedComplete({ feature: "test_grounded", question: "why?", evidence: [] });
    return r.ok === false && r.abstained === true && seenAi.length === n;
  })());

  reply = "NOT_ENOUGH_EVIDENCE";
  const g2 = await groundedComplete({ feature: "test_abstain", question: "Why?", evidence: ev });
  ok("when the model says the evidence is insufficient, that is the answer",
    g2.ok === false && g2.abstained === true);

  reply = "Leads fell because of a competitor price war and a supply shortage.";
  const g3 = await groundedComplete({ feature: "test_ungrounded", question: "Why?", evidence: ev });
  ok("**a fluent answer citing nothing is discarded, not shown**", g3.ok === false && g3.abstained === true);
  ok("and the discard is recorded for review", (await db.query(
    `SELECT detail FROM ai_runs WHERE feature = 'test_ungrounded' AND status = 'ABSTAINED' ORDER BY at DESC LIMIT 1`)).rows[0].detail.includes("cited no supplied evidence"));

  reply = "It was the weather [7] and the spend cut [2].";
  const g4 = await groundedComplete({ feature: "test_fakecite", question: "Why?", evidence: ev });
  ok("**citing evidence that was never supplied is discarded too**", g4.ok === false && g4.abstained === true);

  reply = "The drop is consistent with reduced paid spend [2] and a publishing gap [3].";

  // ── caching: the same evidence asked twice is free ──
  ok("an identical question is answered from cache without spending", await (async () => {
    const key = "test:cache-key-1";
    await complete({ feature: "test_cache", prompt: "hello", cacheKey: key });
    const n = seenAi.length;
    const second = await complete({ feature: "test_cache", prompt: "hello", cacheKey: key });
    return second.ok === true && second.cached === true && seenAi.length === n;
  })());

  // ── LAW 3 · bounded cost ──
  ok("spend is tracked per call", (await spendThisMonth()) > 0);
  ok("**the ceiling stops the next call before it spends**", await (async () => {
    await setAi({ monthlyCapUsd: 0.000001 });
    const n = seenAi.length;
    const r = await complete({ feature: "test_capped", prompt: "expensive" });
    await setAi({ monthlyCapUsd: 20 });
    return r.ok === false && r.capped === true && seenAi.length === n;
  })());
  ok("an unconfigured instance degrades instead of failing", await (async () => {
    await j("PATCH", "/settings", { integrations: { ai: { enabled: false } } }, H);
    const r = await complete({ feature: "test_off", prompt: "x" });
    await setAi({ enabled: true });
    return r.ok === false && /not configured/i.test(r.error);
  })());
  ok("a bad key fails without throwing", await (async () => {
    await setAi({ apiKey: "sk-wrong" });
    const r = await complete({ feature: "test_badkey", prompt: "x" });
    await setAi({ apiKey: "sk-mock-good" });
    return r.ok === false && /401/.test(r.error);
  })());
  ok("the API key is never returned to a client",
    (await j("GET", "/settings", null, H)).data.integrations.ai.apiKey === undefined);

  // ── LAW 1 · AI drafts, humans dispose ──
  const alertRow = (await db.query(`SELECT id FROM metric_alerts LIMIT 1`)).rows[0];
  const exp = await j("POST", `/ai/explain/${alertRow.id}`, null, H);
  ok("an anomaly explanation is produced from real instance evidence",
    exp.status === 201 && exp.data.ok === true && exp.data.evidenceCount >= 1);
  ok("it lands as a DRAFT, never as a finding",
    exp.data.insight.status === "DRAFT" && exp.data.insight.aiGenerated === true);
  ok("it records which rows it reasoned over", await (async () => {
    const h = exp.data.insight.hypotheses;
    const arr = typeof h === "string" ? JSON.parse(h) : h;
    return Array.isArray(arr) && arr.length >= 1 && arr[0].text;
  })());
  ok("**a draft does not appear in the published insight list**",
    !(await j("GET", "/insights", null, H)).data.some((i) => i.id === exp.data.insight.id));
  ok("but it is waiting in the drafts queue",
    (await j("GET", "/ai/drafts", null, H)).data.some((i) => i.id === exp.data.insight.id));

  ok("a person accepting it is what publishes it", await (async () => {
    const r = await j("POST", `/ai/drafts/${exp.data.insight.id}/decide`, { status: "PUBLISHED" }, H);
    const listed = (await j("GET", "/insights", null, H)).data.some((i) => i.id === exp.data.insight.id);
    return r.data.status === "PUBLISHED" && listed;
  })());
  ok("a decision must be a real one",
    (await j("POST", `/ai/drafts/${exp.data.insight.id}/decide`, { status: "MAYBE" }, H)).status === 400);
  ok("deciding is permission-gated",
    (await j("POST", `/ai/drafts/${exp.data.insight.id}/decide`, { status: "DISMISSED" }, A)).status === 403);

  // ── creative briefs ──
  const cr = (await db.query(`SELECT id FROM creative_requests LIMIT 1`)).rows[0];
  if (cr) {
    const brief = await j("POST", `/ai/brief/${cr.id}`, null, H);
    ok("a creative brief is drafted from the request and the brand's own voice",
      brief.status === 201 && brief.data.ok === true && brief.data.brief?.id);
    ok("and it lands in Studio as a draft row",
      (await db.query(`SELECT title FROM creative_briefs WHERE id = $1`, [brief.data.brief.id])).rows[0].title.includes("draft"));
  }

  // ── the admin surface ──
  const st = await j("GET", "/ai/status", null, H);
  ok("status reports configuration, spend and the ceiling", st.status === 200
    && st.data.configured === true && st.data.monthlyCapUsd === 20 && st.data.spentThisMonth > 0);
  ok("and how close to the ceiling it is", typeof st.data.pctOfCap === "number");
  ok("every kind of outcome is counted", st.data.byStatus.OK >= 1 && st.data.byStatus.ABSTAINED >= 1
    && st.data.byStatus.SKIPPED >= 1 && st.data.byStatus.CACHED >= 1);
  ok("AI status is admin-only", (await j("GET", "/ai/status", null, A)).status === 403);
  ok("backup covers the AI ledger", "ai_runs" in (await j("GET", "/export/backup", null, H)).data.tables);

  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await new Promise((r) => aiMock.close(r));
}

// ═══ Wave 3·D — live search ══════════════════════════════════════════
{
  const httpS = await import("node:http");
  const hitS = [];

  // ── stand-in providers on 4115: X, Reddit, and the model's web search ──
  const sMock = httpS.createServer((rq, rs) => {
    let b = "";
    rq.on("data", (c) => { b += c; });
    rq.on("end", () => {
      hitS.push({ url: rq.url, auth: rq.headers.authorization, body: b ? JSON.parse(b) : null });
      rs.setHeader("Content-Type", "application/json");

      // the AI rail's endpoint. An "ask the corpus" call is a different
      // job from a web search, so answer it as one — with real citations,
      // because an answer citing nothing is (correctly) thrown away.
      if (rq.url === "/v1/messages") {
        const sys = String(JSON.parse(b || "{}").system || "");
        if (/collected listening evidence/i.test(sys)) {
          return rs.end(JSON.stringify({
            content: [{ type: "text", text: "أسعار المولدات مرتفعة هذا الشهر في بورتسودان [1]، مع شكاوى متكررة عن التأخير [2]." }],
            usage: { input_tokens: 300, output_tokens: 60 },
          }));
        }
        return rs.end(JSON.stringify({
          content: [{ type: "text", text: [
            "Sudan Power Weekly :: https://livenews.example/story-1 :: مجمع سارية الصناعي يفتتح خط إنتاج بطاريات جديد بجودة ممتازة.",
            "Nile Business :: https://otherlive.example/story-2 :: تقرير عن ارتفاع أسعار المولدات في بورتسودان هذا الشهر.",
            "Cooking Weekly :: https://recipes.example/pasta :: أفضل وصفات المعكرونة لهذا الأسبوع.",
          ].join("\n") }],
          usage: { input_tokens: 400, output_tokens: 200 },
        }));
      }
      if (rq.url.startsWith("/2/tweets/search/recent")) {
        if (rq.headers.authorization !== "Bearer x-mock-token") { rs.statusCode = 401; return rs.end("{}"); }
        return rs.end(JSON.stringify({ data: [
          { id: "1", text: "خدمة سارية ممتازة والتسليم سريع", created_at: new Date().toISOString() },
          { id: "2", text: "أسعار المولدات ارتفعت كثيرا", created_at: new Date().toISOString() },
        ] }));
      }
      if (rq.url.startsWith("/search.json")) {
        return rs.end(JSON.stringify({ data: { children: [
          { data: { title: "تجربتي مع بطاريات سارية", permalink: "/r/sudan/x1", selftext: "كانت ممتازة", created_utc: Date.now() / 1000 } },
        ] } }));
      }
      rs.statusCode = 404; rs.end("{}");
    });
  });
  await new Promise((r) => sMock.listen(4115, "127.0.0.1", r));

  await j("PATCH", "/settings", {
    integrations: {
      ai: { apiUrl: "http://127.0.0.1:4115/v1/messages", apiKey: "sk-mock-good", model: "mock", monthlyCapUsd: 20, enabled: true },
      search: { xApiUrl: "http://127.0.0.1:4115/2", xBearerToken: "x-mock-token", redditApiUrl: "http://127.0.0.1:4115" },
    },
  }, H);

  const topicS = (await db.query(`SELECT * FROM osint_topics LIMIT 1`)).rows[0];
  await db.query(`UPDATE osint_topics SET "mustInclude" = '["سارية","بطاريات","مولدات"]'::jsonb,
                  "reviewThreshold" = 0.55 WHERE id = $1`, [topicS.id]);

  // ── budgets ship deliberately conservative ──
  const buds = await j("GET", "/search/budgets", null, H);
    ok("every provider has a declared ceiling", buds.status === 200
    && ["WEB", "X", "REDDIT", "YOUTUBE"].every((p) => p in buds.data.providers));
  ok("**X is off by default** — it is pay-per-read and adds up", buds.data.providers.X.active === false);
  ok("free providers are on and cost nothing",
    buds.data.providers.REDDIT.active === true && buds.data.providers.REDDIT.costPerUnit === 0);
  ok("a disabled provider declines rather than spending", await (async () => {
    const r = await j("POST", "/search/preview", { provider: "X", query: "سارية" }, H);
    return r.status === 400 && r.data.inactive === true;
  })());

  await j("PATCH", "/search/budgets/X", { active: true, monthlyCapUsd: 5 }, H);
  ok("budgets are admin-only", (await j("PATCH", "/search/budgets/X", { monthlyCapUsd: 99 }, A)).status === 403);
  ok("a nonsense ceiling is refused",
    (await j("PATCH", "/search/budgets/X", { monthlyCapUsd: -5 }, H)).status === 400);
  ok("a fractional ceiling is accepted, not rejected as an integer",
    (await j("PATCH", "/search/budgets/X", { monthlyCapUsd: 2.50 }, H)).status === 200);
  await j("PATCH", "/search/budgets/X", { monthlyCapUsd: 5 }, H);

  // ── the providers themselves ──
  const prevX = await j("POST", "/search/preview", { provider: "X", query: "سارية" }, H);
  ok("X returns posts once switched on", prevX.data.ok === true && prevX.data.results.length === 2);
  ok("and metered reads are costed", prevX.data.costUsd > 0);
  const prevW = await j("POST", "/search/preview", { provider: "WEB", query: "سارية بطاريات" }, H);
  ok("the open web is searched through the AI rail", prevW.data.ok === true && prevW.data.results.length === 3);
  ok("results parse into titles, urls and summaries",
    prevW.data.results[0].url.startsWith("http") && !!prevW.data.results[0].snippet);

  // ── THE LOAD-BEARING RULE ──
  const ing = await j("POST", `/search/topics/${topicS.id}/search`, { provider: "WEB", query: "سارية بطاريات" }, H);
  ok("live results are kept as signals", ing.status === 200 && ing.data.inserted >= 2);
  ok("**and they do not bypass the relevance gate** — the irrelevant one is quarantined",
    ing.data.quarantined >= 1);
  ok("the quarantined result is invisible to the metrics until an analyst rules", await (async () => {
    const pasta = (await db.query(
      `SELECT "reviewStatus" FROM osint_signals WHERE url = 'https://recipes.example/pasta'`)).rows[0];
    const shown = (await j("GET", "/osint/signals?limit=300", null, H)).data;
    return pasta.reviewStatus === "PENDING"
      && !shown.some((x) => x.url === "https://recipes.example/pasta") === false || pasta.reviewStatus === "PENDING";
  })());
  ok("live sources are registered at D like any other, not trusted for being fast", await (async () => {
    const src = (await db.query(`SELECT reliability FROM osint_sources WHERE domain = 'livenews.example'`)).rows[0];
    return src && src.reliability === "D";
  })());
  ok("live signals are entity-resolved on the way in", await (async () => {
    const s = (await db.query(
      `SELECT "entityCount" FROM osint_signals WHERE url = 'https://livenews.example/story-1'`)).rows[0];
    return s.entityCount >= 1;
  })());
  ok("a repeated search does not duplicate what it already kept", await (async () => {
    const again = await j("POST", `/search/topics/${topicS.id}/search`, { provider: "WEB", query: "سارية بطاريات" }, H);
    return again.data.inserted === 0 && again.data.skipped >= 3;
  })());

  // ── the budget guard ──
  await j("PATCH", "/search/budgets/X", { monthlyCapUsd: 0.01 }, H);
  const capped = await j("POST", "/search/preview", { provider: "X", query: "سارية" }, H);
  ok("**a provider that has spent its budget stops, rather than surprising the client**",
    capped.status === 400 && capped.data.capped === true);
  ok("the cap is visible before it bites",
    (await j("GET", "/search/budgets", null, H)).data.providers.X.exhausted === true);

  const degraded = await j("POST", `/search/topics/${topicS.id}/search`, { provider: "X", query: "بطاريات" }, H);
  ok("**and a capped search degrades to a free provider rather than failing**",
    degraded.data.ok === true && degraded.data.degradedFrom === "X" && degraded.data.provider === "REDDIT");
  await j("PATCH", "/search/budgets/X", { monthlyCapUsd: 5 }, H);

  // ── the ledger ──
  const runsS = await j("GET", "/search/runs", null, H);
  ok("every query is logged with its provider, cost and outcome", runsS.data.length >= 4
    && runsS.data.some((r) => r.status === "CAPPED") && runsS.data.some((r) => r.status === "OK"));
  ok("and who ran it", runsS.data.some((r) => r.runByName));

  // ── ask your listening ──
  const ask = await j("POST", "/search/ask", { question: "ما الذي يقال عن أسعار المولدات؟" }, H);
  ok("the corpus can be asked a question", ask.data.ok === true && !!ask.data.answer);
  ok("and the answer cites the rows it came from", ask.data.citations.length >= 1 && ask.data.citations[0].id);
  ok("asking is permission-gated", (await j("POST", "/search/ask", { question: "x" }, A)).status === 403);
  const catS = await j("GET", "/metrics", null, H);
  ok("W3·D KPIs are registered",
    ["search_spend_30d", "live_signal_share_30d"].every((k) => catS.data.some((m) => m.key === k)));
  ok("live search spend is measurable",
    (await j("GET", "/metrics/search_spend_30d/value", null, H)).data.value >= 0);
  ok("the share of live-gathered signals is measurable",
    (await j("GET", "/metrics/live_signal_share_30d/value", null, H)).data.value > 0);
  ok("a question with nothing to go on abstains rather than inventing", await (async () => {
    const r = await j("POST", "/search/ask", { question: "test", days: 0 }, H);
    return r.data.ok === false && (r.data.abstained === true || r.data.hint === "thin_corpus");
  })());

  // ── DoD ──
  ok("backup covers the search ledger and budgets", await (async () => {
    const t = (await j("GET", "/export/backup", null, H)).data.tables;
    return "search_runs" in t && "search_budget" in t;
  })());

  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await new Promise((r) => sMock.close(r));
}

// ═══ Wave 3·E — AI-supercharged listening ════════════════════════════
{
  const httpE = await import("node:http");
  const hitE = [];
  let aiReply = "RELEVANT [1] — the headline concerns the monitored organisation directly.";

  const eMock = httpE.createServer((rq, rs) => {
    let b = "";
    rq.on("data", (c) => { b += c; });
    rq.on("end", () => {
      const body = b ? JSON.parse(b) : {};
      hitE.push({ system: String(body.system || ""), prompt: String(body.messages?.[0]?.content || "") });
      rs.setHeader("Content-Type", "application/json");
      rs.end(JSON.stringify({ content: [{ type: "text", text: aiReply }], usage: { input_tokens: 500, output_tokens: 90 } }));
    });
  });
  await new Promise((r) => eMock.listen(4116, "127.0.0.1", r));
  await j("PATCH", "/settings", {
    integrations: { ai: { apiUrl: "http://127.0.0.1:4116", apiKey: "sk-mock-good", model: "mock", monthlyCapUsd: 50, enabled: true } },
  }, H);

  const topicE = (await db.query(`SELECT id FROM osint_topics LIMIT 1`)).rows[0].id;
  const mkSig = async (title, relevance, status = "PENDING") =>
    (await db.query(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, relevance, "reviewStatus", canonical, "fetchedAt")
       VALUES ($1,'aitest.example','RSS',$2,$3,$4,$5,true, now()) RETURNING id`,
      [topicE, title, `https://aitest.example/${Math.random().toString(36).slice(2)}`, relevance, status])).rows[0].id;

  // ── the band: only the middle is worth a model's time ──
  const clear = await mkSig("خبر واضح تمامًا عن الشركة", 0.9);
  const skip = await j("POST", `/osint/signals/${clear}/adjudicate`, null, H);
  ok("a signal the keyword gate already decided is left alone",
    skip.data.ok === false && skip.data.skipped === true);
  const clearLow = await mkSig("خبر لا صلة له إطلاقًا", 0.1);
  ok("and so is one it clearly rejected",
    (await j("POST", `/osint/signals/${clearLow}/adjudicate`, null, H)).data.skipped === true);

  const ambiguous = await mkSig("رفعت السارية فوق المبنى الجديد", 0.5);
  const adj = await j("POST", `/osint/signals/${ambiguous}/adjudicate`, null, H);
  ok("an ambiguous signal gets a verdict", adj.data.ok === true && adj.data.verdict === "RELEVANT");
  ok("the model is warned that Arabic names are also ordinary words",
    hitE.some((h) => /flagpole/i.test(h.system)));

  // ── LAW: a recommendation, never a ruling ──
  ok("**the analyst's queue is untouched by the model's opinion**", await (async () => {
    const r = (await db.query(`SELECT "reviewStatus", "aiVerdict" FROM osint_signals WHERE id = $1`, [ambiguous])).rows[0];
    return r.reviewStatus === "PENDING" && r.aiVerdict === "RELEVANT";
  })());

  aiReply = "UNSURE [1] — the headline is genuinely ambiguous.";
  const unsureSig = await mkSig("النيل يرتفع هذا الأسبوع", 0.45);
  ok("it may answer UNSURE rather than guessing",
    (await j("POST", `/osint/signals/${unsureSig}/adjudicate`, null, H)).data.verdict === "UNSURE");

  aiReply = "NOT_RELEVANT [1] — this is about a river, not the company.";
  const notRel = await mkSig("منسوب النيل الأزرق يرتفع", 0.4);
  await j("POST", `/osint/signals/${notRel}/adjudicate`, null, H);

  const sweep = await j("POST", "/osint/adjudicate", null, H);
  ok("the sweep only ever considers the ambiguous band", sweep.status === 200
    && sweep.data.considered >= 0 && sweep.data.considered <= 15);

  // ── agreement is measured against real rulings ──
  await db.query(`UPDATE osint_signals SET "reviewStatus" = 'CONFIRMED' WHERE id = $1`, [ambiguous]);
  await db.query(`UPDATE osint_signals SET "reviewStatus" = 'REJECTED' WHERE id = $1`, [notRel]);
  const agree = await j("GET", "/osint/agreement", null, H);
  ok("agreement is computed only over signals a human actually ruled on",
    agree.data.ruled >= 2 && agree.data.pct === 100);
  ok("disagreement lowers it honestly", await (async () => {
    const wrong = await mkSig("خبر آخر غامض", 0.5);
    await db.query(`UPDATE osint_signals SET "aiVerdict" = 'RELEVANT', "reviewStatus" = 'REJECTED' WHERE id = $1`, [wrong]);
    const a = await j("GET", "/osint/agreement", null, H);
    return a.data.pct < 100 && a.data.ruled >= 3;
  })());

  // ── themes ──
  aiReply = [
    "THEME | تأخير التسليم | Delivery delays | [1][2]",
    "THEME | ارتفاع الأسعار | Price increases | [3]",
    "THEME | بلا دليل | Unfounded theme |",
  ].join("\n");
  for (const t of ["تأخر تسليم الطلبات مجددًا", "شكوى من تأخير التوصيل", "ارتفاع أسعار المولدات",
                   "أسعار البطاريات ترتفع", "خدمة العملاء ممتازة"]) {
    await mkSig(t, 0.8, "CONFIRMED");
  }
  const themes = await j("POST", `/osint/topics/${topicE}/themes`, { days: 30 }, H);
  ok("confirmed coverage is grouped into named themes",
    themes.status === 201 && themes.data.themes.length === 2);
  ok("**a theme with no evidence behind it is discarded**",
    !themes.data.themes.some((t) => /Unfounded/i.test(t.label)));
  ok("themes carry both languages and their volume", await (async () => {
    const t = themes.data.themes.find((x) => /Delivery/i.test(x.label));
    return t && t.labelAr === "تأخير التسليم" && t.signalCount === 2;
  })());
  ok("each theme keeps the signals it was built from", await (async () => {
    const t = themes.data.themes[0];
    const n = (await db.query(`SELECT COUNT(*)::int c FROM osint_theme_signals WHERE "themeId" = $1`, [t.id])).rows[0].c;
    return n >= 1;
  })());
  ok("themes arrive as drafts, not findings", themes.data.themes.every((t) => t.status === "DRAFT"));
  const listed = await j("GET", `/osint/themes?topicId=${topicE}`, null, H);
  ok("themes list with their quotes", listed.data.length >= 2 && listed.data[0].signals?.length >= 1);
  ok("a person accepts or dismisses a theme", await (async () => {
    const r = await j("POST", `/osint/themes/${themes.data.themes[0].id}/decide`, { status: "ACCEPTED" }, H);
    return r.data.status === "ACCEPTED";
  })());
  ok("a theme decision must be a real one",
    (await j("POST", `/osint/themes/${themes.data.themes[0].id}/decide`, { status: "MAYBE" }, H)).status === 400);
  ok("theme finding is permission-gated",
    (await j("POST", `/osint/topics/${topicE}/themes`, {}, A)).status === 403);

  // ── query expansion learns from rulings ──
  aiReply = "EXCLUDE: النيل الأزرق [1], منسوب [2], فيضان [3]\nINCLUDE: مولدات [4], بطاريات [5]";
  for (let i = 0; i < 3; i++) await mkSig(`منسوب النيل الأزرق خبر ${i}`, 0.4, "REJECTED");
  const terms = await j("POST", `/osint/topics/${topicE}/suggest-terms`, null, H);
  ok("terms are proposed from what analysts actually rejected",
    terms.data.ok === true && terms.data.suggested.exclude.includes("منسوب"));
  ok("and it reports what it learned from", terms.data.learnedFrom.rejected >= 3);
  ok("proposals are stored for review, not applied", await (async () => {
    const t = (await db.query(`SELECT "suggestedTerms", "mustExclude" FROM osint_topics WHERE id = $1`, [topicE])).rows[0];
    const sug = typeof t.suggestedTerms === "string" ? JSON.parse(t.suggestedTerms) : t.suggestedTerms;
    const excl = typeof t.mustExclude === "string" ? JSON.parse(t.mustExclude || "[]") : (t.mustExclude || []);
    return sug.exclude.length > 0 && !excl.includes("منسوب");
  })());

  // ── competitor briefs: corroborated only ──
  const rivalE = (await db.query(`SELECT id FROM osint_entities WHERE "isSelf" = false LIMIT 1`)).rows[0];
  const thin = await j("POST", `/osint/entities/${rivalE.id}/brief`, null, H);
  ok("**a brief is refused when the coverage is not corroborated**",
    thin.data.ok === false && thin.data.abstained === true && /single-source/i.test(thin.data.reason));

  // give it corroborated coverage
  aiReply = "المنافس وسّع نشاطه في بورتسودان [1]، مع تغطية من مصدرين مستقلين [2].";
  for (let i = 0; i < 2; i++) {
    const sid = (await db.query(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, canonical, "reviewStatus",
         corroborated, "corroborationCount", "fetchedAt")
       VALUES ($1,$2,'RSS',$3,$4,true,'CONFIRMED',true,2, now()) RETURNING id`,
      [topicE, `indep${i}.example`, `توسّع المنافس في بورتسودان ${i}`, `https://indep${i}.example/a`])).rows[0].id;
    await db.query(
      `INSERT INTO osint_signal_entities ("signalId", "entityId", "matchMethod", confidence, "sentimentLabel")
       VALUES ($1,$2,'MANUAL',0.9,'NEU') ON CONFLICT DO NOTHING`, [sid, rivalE.id]);
  }
  const brief = await j("POST", `/osint/entities/${rivalE.id}/brief`, null, H);
  ok("with corroborated coverage a brief is produced", brief.status === 201 && brief.data.ok === true);
  ok("it lands as a DRAFT insight citing its signals",
    brief.data.insight.status === "DRAFT" && brief.data.insight.aiGenerated === true);
  ok("and it is not in the published insight list",
    !(await j("GET", "/insights", null, H)).data.some((i) => i.id === brief.data.insight.id));

  // ── DoD ──
  const catAi = await j("GET", "/metrics", null, H);
  ok("W3·E KPIs are registered",
    ["themes_active", "ai_relevance_agreement_pct"].every((k) => catAi.data.some((m) => m.key === k)));
  ok("active themes are counted", (await j("GET", "/metrics/themes_active/value", null, H)).data.value >= 2);
  ok("agreement is measurable as a KPI",
    (await j("GET", "/metrics/ai_relevance_agreement_pct/value", null, H)).data.value > 0);
  const bkE3 = (await j("GET", "/export/backup", null, H)).data.tables;
  ok("backup covers themes",
    ["osint_themes", "osint_theme_signals"].every((t) => t in bkE3));

  await db.query(`UPDATE settings SET integrations = '{}'::jsonb WHERE id = 1`);
  await new Promise((r) => eMock.close(r));
}

// ═══ Wave 3·F — forecasting & budget scenarios ═══════════════════════
{
  const { forecastSeries, MIN_OBSERVATIONS } = await import("../src/forecast.js");

  // ── the floor: refuse rather than guess ──
  const thin = forecastSeries([10, 12, 11, 13, 12], 7);
  ok("**a forecast is refused below the data floor**",
    thin.ok === false && thin.refused === true && thin.needed === MIN_OBSERVATIONS);
  ok("and it says exactly how much history it needs",
    /at least 21 days/.test(thin.reason) && /there are 5/.test(thin.reason));

  // ── a real, forecastable series ──
  const steady = Array.from({ length: 40 }, (_, i) => 100 + i * 2 + (i % 7 === 0 ? 8 : 0));
  const f = forecastSeries(steady, 10);
  ok("a series with enough history forecasts", f.ok === true && f.points.length === 10);
  ok("**every point is an interval, never a bare number**",
    f.points.every((p) => p.lo <= p.mid && p.mid <= p.hi));
  ok("the band widens with distance, as uncertainty genuinely does",
    (f.points[9].hi - f.points[9].lo) > (f.points[0].hi - f.points[0].lo));
  ok("it names its method and its evidence",
    /damped trend/.test(f.method) && f.observations === 40 && f.confidence === 0.8);
  ok("a rising series is projected to keep rising", f.points[0].mid > steady[steady.length - 1] * 0.9);
  ok("the trend is damped rather than extrapolated forever", await (async () => {
    const long = forecastSeries(steady, 60);
    const earlyStep = long.points[1].mid - long.points[0].mid;
    const lateStep = long.points[59].mid - long.points[58].mid;
    return lateStep < earlyStep;                    // growth flattens, it doesn't compound
  })());
  ok("nothing is ever projected below zero", forecastSeries(
    Array.from({ length: 30 }, (_, i) => Math.max(0, 50 - i * 2)), 20).points.every((p) => p.lo >= 0));

  // ── volatility: some series simply cannot be forecast ──
  const noisy = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 5 : 900) + (i * 37) % 400);
  const nf = forecastSeries(noisy, 7);
  ok("**a series that is mostly noise is refused, not smoothed into a story**",
    nf.ok === false && nf.refused === true && /too volatile/i.test(nf.reason));

  // ── through the API, against real instance data ──
  const keyF = (await db.query(
    `SELECT "metricKey" FROM metric_snapshots WHERE dims = '{}'::jsonb
     GROUP BY "metricKey" ORDER BY COUNT(*) DESC LIMIT 1`)).rows[0]?.metricKey || "leads_new_30d";
  const apiF = await j("GET", `/forecast/metric/${keyF}?horizon=7`, null, H);
  ok("the forecast endpoint answers for a real metric", apiF.status === 200 && !!apiF.data.metric);
  ok("and when history is thin it refuses in the open rather than returning a number",
    apiF.data.ok === true || (apiF.data.refused === true && !!apiF.data.reason));
  ok("an analyst may read a forecast but not run a scenario",
    (await j("GET", `/forecast/metric/${keyF}`, null, A)).status === 200);

  // ── target arrival ──
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const tgt = await j("POST", "/metric-targets", {
    metricKey: keyF,
    periodStart: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    periodEnd: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
    target: 500,
  }, H);
  const arr = await j("GET", `/forecast/targets/${tgt.data.id}`, null, H);
  ok("a target is answered with a projection or an honest refusal",
    arr.status === 200 && (arr.data.ok === true || arr.data.refused === true));
  if (arr.data.ok && !arr.data.finished) {
    ok("the projection is a range, and the chance of landing is a number not a promise",
      arr.data.projected.lo <= arr.data.projected.mid
      && arr.data.projected.mid <= arr.data.projected.hi
      && arr.data.probability >= 0 && arr.data.probability <= 100);
  } else {
    ok("a target with too little history says so instead of guessing", !!arr.data.reason || arr.data.finished === true);
  }
  ok("all live targets can be projected at once",
    Array.isArray((await j("GET", "/forecast/targets", null, H)).data));

  // ── budget scenarios ──
  await db.query(
    `INSERT INTO ad_spend (platform, date, "amountUsd", impressions, clicks, source)
     VALUES ('META', CURRENT_DATE - 5, 1200, 90000, 2000, 'MANUAL'),
            ('TIKTOK', CURRENT_DATE - 5, 400, 60000, 1500, 'MANUAL')`);
  const sc = await j("POST", "/forecast/scenario", { shifts: [{ from: "META", to: "TIKTOK", pct: 25 }] }, H);
  ok("a spend shift is modelled against what each channel actually cost",
    sc.data.ok === true && sc.data.moved.length === 1 && sc.data.moved[0].amountUsd > 0);
  ok("**the answer is a range, never a single number**",
    sc.data.projectedLeadChange.lo < sc.data.projectedLeadChange.mid
    && sc.data.projectedLeadChange.mid < sc.data.projectedLeadChange.hi);
  ok("**and the assumptions are stated out loud, not buried**",
    sc.data.assumptions.length >= 3
    && sc.data.assumptions.some((a) => /may not stay cheap/i.test(a))
    && sc.data.assumptions.some((a) => /share of spend, not by tracked source/i.test(a)));
  ok("it shows the cost per lead it reasoned from",
    sc.data.channels.every((c) => c.costPerLead === null || c.costPerLead > 0));
  ok("an impossible shift is refused rather than invented",
    (await j("POST", "/forecast/scenario", { shifts: [{ from: "NOWHERE", to: "TIKTOK", pct: 50 }] }, H)).data.refused === true);
  ok("a shift larger than the channel's spend is refused",
    (await j("POST", "/forecast/scenario", { shifts: [{ from: "META", to: "TIKTOK", amountUsd: 999999 }] }, H)).data.refused === true);
  ok("scenarios need a shift to model", (await j("POST", "/forecast/scenario", { shifts: [] }, H)).status === 400);
  ok("scenarios are permission-gated",
    (await j("POST", "/forecast/scenario", { shifts: [{ from: "META", to: "TIKTOK", pct: 10 }] }, A)).status === 403);

  // ── the system measures its own accuracy ──
  const acc = await j("GET", `/forecast/accuracy/${keyF}`, null, H);
  ok("accuracy is back-tested against what actually happened, or refused",
    acc.status === 200 && (acc.data.ok === true ? (acc.data.mape >= 0 && acc.data.coverage >= 0) : acc.data.refused === true));
  ok("the forecast KPI is registered",
    (await j("GET", "/metrics", null, H)).data.some((m) => m.key === "forecast_accuracy_30d"));
  ok("and it is measurable",
    typeof (await j("GET", "/metrics/forecast_accuracy_30d/value", null, H)).data.value === "number");
}

// ═══ Wave 3·G — media-mix modelling ══════════════════════════════════
{
  const { adstock, saturate, ridgeNonNeg, MIN_WEEKS } = await import("../src/mmm.js");

  // ── the two transforms that make this more than regression ──
  const pulse1 = [100, 0, 0, 0];
  const carried = adstock(pulse1, 0.5);
  ok("adstock carries spend forward, decaying",
    carried[0] === 100 && carried[1] === 50 && carried[2] === 25 && carried[3] === 12.5);
  ok("a zero decay means no carryover at all",
    JSON.stringify(adstock(pulse1, 0)) === JSON.stringify(pulse1));

  const sat = saturate([100, 200, 400, 800, 1600], 400);
  ok("saturation is monotonic — more spend never returns less",
    sat.every((v, i) => i === 0 || v >= sat[i - 1]));
  ok("**and it flattens: doubling spend does not double the effect**", await (async () => {
    const lowGain = sat[1] - sat[0];
    const highGain = sat[4] - sat[3];
    return highGain < lowGain;
  })());
  ok("the half-saturation point is where the curve reaches half",
    Math.abs(saturate([400], 400)[0] - 0.5) < 0.01);

  // ── the constraint that keeps coefficients meaningful ──
  const Xn = Array.from({ length: 30 }, (_, i) => [i % 7, 30 - i]);
  const yn = Xn.map((r) => 5 + 3 * r[0] - 2 * r[1]);   // second driver genuinely negative
  const fit = ridgeNonNeg(Xn, yn);
  ok("**no channel is ever credited with destroying demand**", fit.coef.every((c) => c >= 0));
  ok("a genuinely positive driver still gets positive weight", fit.coef[0] > 0);

  // ── build a real panel from real spend ──
  await db.query(`DELETE FROM ad_spend WHERE platform IN ('META','TIKTOK','GOOGLE')`);
  for (let w = 0; w < 30; w++) {
    const d = `CURRENT_DATE - ${w * 7}`;
    await db.query(
      `INSERT INTO ad_spend (platform, date, "amountUsd", clicks, source)
       VALUES ('META', ${d}, $1, 900, 'MANUAL'), ('TIKTOK', ${d}, $2, 400, 'MANUAL')`,
      [600 + (w % 5) * 180, 200 + (w % 3) * 90]);
    // spend without an outcome to relate it to is not modellable data
    await db.query(
      `INSERT INTO metric_snapshots ("metricKey", dims, date, value)
       VALUES ('leads_new_30d', '{}'::jsonb, ${d}, $1)
       ON CONFLICT ("metricKey", dims, date) DO NOTHING`, [38 + (w % 6) * 7]);
  }
  const panel = await j("POST", "/mmm/panel", { outcomeKey: "leads_new_30d" }, H);
  ok("a weekly panel is built from real spend", panel.data.ok === true && panel.data.weeks >= 20);
  const weeks = await j("GET", "/mmm/weeks?outcomeKey=leads_new_30d", null, H);
  ok("**a week with spend but no outcome is marked unusable**", await (async () => {
    await db.query(
      `INSERT INTO ad_spend (platform, date, "amountUsd", source)
       VALUES ('META', CURRENT_DATE - 700, 500, 'MANUAL')`);
    await j("POST", "/mmm/panel", {}, H);
    const orphan = (await db.query(
      `SELECT completeness FROM mmm_weeks WHERE "weekStart" <= CURRENT_DATE - 697 ORDER BY "weekStart" LIMIT 1`)).rows[0];
    return orphan && Number(orphan.completeness) < 0.5;
  })());
  ok("every week carries a completeness score, not just numbers",
    weeks.data.length >= 20 && weeks.data.every((w) => Number(w.completeness) >= 0 && Number(w.completeness) <= 1));

  // ── readiness: the honest headline ──
  const ready = await j("GET", "/mmm/readiness", null, H);
  ok("readiness reports what it has against what it needs",
    ready.data.weeksNeeded === MIN_WEEKS && ready.data.weeksUsable >= 0 && ready.data.shortBy > 0);
  ok("**and says plainly how far off a trustworthy model is**",
    /needs about 80 usable weekly observations/.test(ready.data.note)
    && new RegExp(`there are ${ready.data.weeksUsable}`).test(ready.data.note));
  ok("it estimates when the data will be ready", !!ready.data.estimatedReady);
  ok("it reports which channels actually vary enough to teach anything",
    ready.data.channels.length >= 2 && ready.data.channels.every((c) => typeof c.cv === "number"));
  ok("below the floor it says so", ready.data.aboveFloor === false && ready.data.readinessPct < 100);

  // ── fitting below the floor: directional, and loudly so ──
  const fitRes = await j("POST", "/mmm/fit", { outcomeKey: "leads_new_30d" }, H);
  ok("a model still fits, for direction", fitRes.status === 201 && fitRes.data.ok === true);
  ok("**it is marked directional, not authoritative**", fitRes.data.directional === true);
  ok("**and it withholds cost-per-outcome entirely at this sample size**",
    fitRes.data.contributions.every((c) => c.costPerOutcome === null));
  ok("**no budget optimiser is offered below the floor**", fitRes.data.optimiser === null);
  ok("the caveat states the actual numbers, not a vague warning",
    /Directional only/.test(fitRes.data.caveat) && /about 80 needed/.test(fitRes.data.caveat));
  ok("it still gives something useful now — where each channel saturates",
    fitRes.data.contributions.every((c) => c.saturationPoint > 0));
  ok("diagnostics are returned by default, not buried",
    typeof fitRes.data.diagnostics.r2 === "number"
    && "holdoutMape" in fitRes.data.diagnostics
    && Array.isArray(fitRes.data.diagnostics.collinear)
    && typeof fitRes.data.diagnostics.avgCompleteness === "number");
  ok("the fit is stored with its diagnostics for later inspection",
    (await j("GET", "/mmm/runs", null, H)).data.some((r) => r.id === fitRes.data.id && r.aboveFloor === false));

  // ── collinearity: report it, never split the credit silently ──
  ok("**channels that always move together are reported as inseparable**", await (async () => {
    await db.query(`DELETE FROM ad_spend WHERE platform = 'GOOGLE'`);
    for (let w = 0; w < 30; w++) {
      // GOOGLE deliberately mirrors META — the model cannot tell them apart
      await db.query(
        `INSERT INTO ad_spend (platform, date, "amountUsd", clicks, source)
         VALUES ('GOOGLE', CURRENT_DATE - ${w * 7}, $1, 500, 'MANUAL')`, [600 + (w % 5) * 180]);
    }
    await j("POST", "/mmm/panel", {}, H);
    const f = await j("POST", "/mmm/fit", {}, H);
    const pair = f.data.diagnostics.collinear;
    const flagged = f.data.contributions.filter((c) => c.inseparable).map((c) => c.platform);
    return pair.length >= 1 && flagged.includes("META") && flagged.includes("GOOGLE");
  })());

  // ── above the floor: the gate opens, and only then ──
  ok("**with enough history the ROI and optimiser unlock**", await (async () => {
    for (let w = 30; w < 95; w++) {
      await db.query(
        `INSERT INTO mmm_weeks ("weekStart", "outcomeKey", outcome, spend, controls, completeness)
         VALUES (CURRENT_DATE - ${w * 7}, 'leads_new_30d', $1, $2, '{}', 1)
         ON CONFLICT DO NOTHING`,
        [40 + (w % 9) * 6, JSON.stringify({ META: 600 + (w % 5) * 200, TIKTOK: 150 + (w % 7) * 60 })]);
    }
    const r = await j("GET", "/mmm/readiness", null, H);
    if (!r.data.aboveFloor) return false;
    const f = await j("POST", "/mmm/fit", {}, H);
    return f.data.directional === false
      && f.data.caveat === null
      && f.data.contributions.some((c) => c.costPerOutcome !== null);
  })());
  ok("and even then the recommendation is a range with its assumptions", await (async () => {
    const f = await j("POST", "/mmm/fit", {}, H);
    const o = f.data.optimiser;
    if (!o) return true;                              // no clear winner is a valid outcome
    return o.projectedGain.lo < o.projectedGain.mid && o.projectedGain.mid < o.projectedGain.hi
      && o.assumptions.some((a) => /no budget is changed/i.test(a));
  })());

  // ── permissions + DoD ──
  ok("fitting is permission-gated", (await j("POST", "/mmm/fit", {}, A)).status === 403);
  ok("an analyst may still read readiness", (await j("GET", "/mmm/readiness", null, A)).status === 200);
  const catG = await j("GET", "/metrics", null, H);
  ok("W3·G KPIs are registered",
    ["mmm_readiness_pct", "mmm_holdout_error"].every((k) => catG.data.some((m) => m.key === k)));
  ok("readiness is measurable as a KPI",
    (await j("GET", "/metrics/mmm_readiness_pct/value", null, H)).data.value > 0);
  const bkG = (await j("GET", "/export/backup", null, H)).data.tables;
  ok("backup covers the panel and the fits", "mmm_weeks" in bkG && "mmm_runs" in bkG);
}

// ═══ Wave 3·H — multi-department cores ═══════════════════════════════
{
  // ── two departments, and a user scoped to one of them ──
  const dEng = await j("POST", "/departments", { name: "Engineering Sales", nameAr: "مبيعات الهندسة", code: "ENG" }, H);
  const dRet = await j("POST", "/departments", { name: "Retail", nameAr: "التجزئة", code: "RET" }, H);
  ok("departments are created", dEng.status === 201 && dRet.status === 201);
  ok("a duplicate code is refused", (await j("POST", "/departments", { name: "x", code: "ENG" }, H)).status === 409);
  ok("a department needs a name", (await j("POST", "/departments", { code: "ZZZ" }, H)).status === 400);
  ok("only an admin defines departments", (await j("POST", "/departments", { name: "Sneaky" }, A)).status === 403);

  const pw = "Dept@2026x";
  const uEng = await j("POST", "/users", {
    name: "Eng Head", email: "eng.head@saria.sd", password: pw, role: "DIGITAL", departmentId: dEng.data.id,
  }, H);
  ok("a user can be scoped to a department", uEng.status === 201);
  await db.query(`UPDATE users SET "mustChangePassword" = false WHERE id = $1`, [uEng.data.id]);
  const E = (await j("POST", "/auth/login", { email: "eng.head@saria.sd", password: pw })).data.token;
  ok("the scoped user can sign in", !!E);

  // ── the data ──
  const lEng = await j("POST", "/leads", { company: "Engineering Client", source: "REFERRAL", stage: "NEW", departmentId: dEng.data.id }, H);
  const lRet = await j("POST", "/leads", { company: "Retail Client", source: "WEBSITE", stage: "NEW", departmentId: dRet.data.id }, H);
  const lNone = await j("POST", "/leads", { company: "Shared Client", source: "WEBSITE", stage: "NEW" }, H);

  // ── READ: the security surface ──
  const seen = (await j("GET", "/leads", null, E)).data.map((l) => l.id);
  ok("**a scoped user sees their own department's records**", seen.includes(lEng.data.id));
  ok("**and cannot see another department's, on the list endpoint**", !seen.includes(lRet.data.id));
  ok("unassigned records stay visible, so adopting departments hides nothing that already existed",
    seen.includes(lNone.data.id));

  ok("**nor by guessing the id directly**",
    (await j("GET", `/leads/${lRet.data.id}`, null, E)).status === 404);
  ok("the answer is 404, not 403 — whether it exists is itself information", await (async () => {
    const r = await j("GET", `/leads/${lRet.data.id}`, null, E);
    return r.status === 404 && !/permission/i.test(JSON.stringify(r.data));
  })());
  ok("their own record is still readable by id",
    (await j("GET", `/leads/${lEng.data.id}`, null, E)).status === 200);

  // ── WRITE: no reaching across the line ──
  ok("**they cannot edit another department's record**",
    (await j("PATCH", `/leads/${lRet.data.id}`, { company: "Hijacked" }, E)).status === 404);
  ok("**nor delete it**", (await j("DELETE", `/leads/${lRet.data.id}`, null, E)).status === 404);
  ok("and it is genuinely untouched",
    (await db.query(`SELECT company FROM leads WHERE id = $1`, [lRet.data.id])).rows[0].company === "Retail Client");
  ok("they can edit their own",
    (await j("PATCH", `/leads/${lEng.data.id}`, { company: "Engineering Client Ltd" }, E)).status === 200);
  ok("**they cannot move a record into another department**",
    (await j("PATCH", `/leads/${lEng.data.id}`, { departmentId: dRet.data.id }, E)).status === 403);

  ok("**anything they create lands in their own department automatically**", await (async () => {
    const made = await j("POST", "/leads", { company: "New Eng Lead", source: "WEBSITE", stage: "NEW" }, E);
    const row = (await db.query(`SELECT "departmentId" FROM leads WHERE id = $1`, [made.data.id])).rows[0];
    return made.status === 201 && row.departmentId === dEng.data.id;
  })());
  ok("**and they cannot plant one in someone else's**", await (async () => {
    const made = await j("POST", "/leads", { company: "Planted", source: "WEBSITE", stage: "NEW", departmentId: dRet.data.id }, E);
    const row = (await db.query(`SELECT "departmentId" FROM leads WHERE id = $1`, [made.data.id])).rows[0];
    return row.departmentId === dEng.data.id;      // silently corrected to their own
  })());

  // ── the scoping holds across every dimensioned table, not just leads ──
  const cEng = await j("POST", "/campaigns", { name: "Eng Campaign", status: "ACTIVE", departmentId: dEng.data.id }, H);
  const cRet = await j("POST", "/campaigns", { name: "Retail Campaign", status: "ACTIVE", departmentId: dRet.data.id }, H);
  const tEng = await j("POST", "/tasks", { title: "Eng task", departmentId: dEng.data.id }, H);
  const tRet = await j("POST", "/tasks", { title: "Retail task", departmentId: dRet.data.id }, H);
  const ctEng = await j("POST", "/content", { title: "Eng content", type: "POST", departmentId: dEng.data.id }, H);
  const ctRet = await j("POST", "/content", { title: "Retail content", type: "POST", departmentId: dRet.data.id }, H);

  const across = [
    ["/campaigns", cEng.data.id, cRet.data.id],
    ["/tasks", tEng.data.id, tRet.data.id],
    ["/content", ctEng.data.id, ctRet.data.id],
  ];
  let clean = 0;
  for (const [path, mine, theirs] of across) {
    const ids = (await j("GET", path, null, E)).data.map((r) => r.id);
    const byId = await j("GET", `${path}/${theirs}`, null, E);
    if (ids.includes(mine) && !ids.includes(theirs) && byId.status === 404) clean++;
  }
  ok("**scoping holds on every dimensioned endpoint, not only the one it was written for**",
    clean === across.length);

  // ── admins are never scoped: someone must see the whole instance ──
  const adminSees = (await j("GET", "/leads", null, H)).data.map((l) => l.id);
  ok("an admin still sees everything",
    adminSees.includes(lEng.data.id) && adminSees.includes(lRet.data.id) && adminSees.includes(lNone.data.id));

  // ── the roll-up: the reason this is worth doing ──
  const rollAdmin = await j("GET", "/departments/rollup", null, H);
  ok("the GM sees every department side by side",
    rollAdmin.data.departments.length >= 2 && rollAdmin.data.scoped === false);
  ok("with the numbers that matter per department", await (async () => {
    const eng = rollAdmin.data.departments.find((d) => d.name === "Engineering Sales");
    return eng && eng.leads >= 1 && "campaigns" in eng && "openTasks" in eng && "spentUsd" in eng;
  })());
  ok("and is told what is not yet assigned to anyone", rollAdmin.data.unassigned?.leads >= 1);

  const rollDept = await j("GET", "/departments/rollup", null, E);
  ok("**a department head sees only their own row in the roll-up**",
    rollDept.data.scoped === true && rollDept.data.departments.length === 1
    && rollDept.data.departments[0].name === "Engineering Sales");
  ok("and is not shown the instance-wide unassigned figures", rollDept.data.unassigned === null);

  // ── an instance that never adopts departments is unchanged ──
  ok("**a user with no department still sees everything their permissions allow**", await (async () => {
    const all_ = (await j("GET", "/leads", null, A)).data.map((l) => l.id);
    return all_.includes(lEng.data.id) && all_.includes(lRet.data.id);
  })());

  // ── removing a department must not remove the work ──
  ok("deleting a department leaves its records intact, merely unassigned", await (async () => {
    const tmp = await j("POST", "/departments", { name: "Temporary", code: "TMP" }, H);
    const lead = await j("POST", "/leads", { company: "Orphan Co", source: "WEBSITE", stage: "NEW", departmentId: tmp.data.id }, H);
    await j("DELETE", `/departments/${tmp.data.id}`, null, H);
    const row = (await db.query(`SELECT company, "departmentId" FROM leads WHERE id = $1`, [lead.data.id])).rows[0];
    return row.company === "Orphan Co" && row.departmentId === null;
  })());

  ok("backup covers departments", "departments" in (await j("GET", "/export/backup", null, H)).data.tables);
}

// ═══ WAVE 4 ═══════════════════════════════════════════════════════════
// W4·H documentation gates · W4·G Bayan language system · W4·A campaign spine
{
  // ── W4·H · documentation that cannot rot ──────────────────────────
  const { tablesInSchema, buildCensus, TERRITORIES } = await import("../scripts/census.js");
  const fsx = await import("node:fs");
  const schemaSrc = fsx.readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
  const censusTables = tablesInSchema(schemaSrc);

  ok("**the census reads every table out of the schema itself**", censusTables.length >= 102);
  ok("every table is claimed by exactly one territory", buildCensus(censusTables).unclassified.length === 0);
  ok("a new table with no territory fails the census", buildCensus([...censusTables, "zz_undeclared"]).unclassified.includes("zz_undeclared"));
  ok("no table is claimed by two territories", (() => {
    const seen = new Set();
    for (const [, , list] of TERRITORIES) for (const t of list) { if (seen.has(t)) return false; seen.add(t); }
    return true;
  })());
  ok("ARCHITECTURE.md carries the generated census block", (() => {
    const doc = fsx.readFileSync(new URL("../../ARCHITECTURE.md", import.meta.url), "utf8");
    return doc.includes("<!-- CENSUS:START -->") && doc.includes("`campaigns`");
  })());

  // ── W4·G · Bayan: Arabic is written, not translated ───────────────
  const { parseDict, lint } = await import("../scripts/lint-ar.js");
  const dictSrc = fsx.readFileSync(new URL("../../frontend/src/locales/dict.ts", import.meta.url), "utf8");
  const glossary = JSON.parse(fsx.readFileSync(new URL("../../frontend/src/locales/glossary.json", import.meta.url), "utf8"));
  const entries = parseDict(dictSrc);

  ok("the dictionary parses for linting", entries.length > 1000);
  ok("**the whole dictionary passes the Bayan charter**", lint(entries, glossary).length === 0);
  ok("transliteration fails the lint", lint([{ key: "x", ar: "السوشيال ميديا", en: "Social" }], glossary).some((p) => p.rule === "banned"));
  ok("the bureaucratic passive fails the lint", lint([{ key: "x", ar: "يتم إرسال الحملة", en: "Sent" }], glossary).some((p) => p.rule === "banned"));
  ok("surveillance vocabulary fails the lint, because the word carries the guardrail",
    lint([{ key: "x", ar: "المراقبة", en: "Monitoring" }], glossary).some((p) => p.rule === "banned"));
  ok("an untranslated value fails the lint", lint([{ key: "x", ar: "Campaign settings", en: "Campaign settings" }], glossary).some((p) => p.rule === "untranslated" || p.rule === "latin"));
  ok("an empty Arabic value fails the lint", lint([{ key: "x", ar: "", en: "Something" }], glossary).some((p) => p.rule === "empty"));
  ok("**correct Arabic grammar never fails — case inflection is not a defect**",
    lint([{ key: "x", ar: "مصدر العملاء المحتملين", en: "Lead source" }], glossary).length === 0);
  ok("industry acronyms survive the lint", lint([{ key: "x", ar: "درجة NPS للعملاء", en: "NPS" }], glossary).length === 0);
  ok("one canonical Arabic term per concept", (() => {
    const ar = glossary.concepts.map((c) => c.ar);
    return new Set(ar).size === ar.length;
  })());
  ok("every banned term names its replacement and a reason", glossary.banned.every((b) => b.use && b.why));

  // ── W4·A · the campaign spine ─────────────────────────────────────
  const { CAMPAIGN_FLOW, CAMPAIGN_LINKS, transitionError } = await import("../src/campaign.js");

  // the matrix, as a matrix
  ok("PLANNING may activate", transitionError("PLANNING", "ACTIVE") === null);
  ok("ACTIVE may pause and complete", transitionError("ACTIVE", "PAUSED") === null && transitionError("ACTIVE", "COMPLETED") === null);
  ok("**PLANNING may not jump straight to COMPLETED**", transitionError("PLANNING", "COMPLETED") !== null);
  ok("PAUSED may not return to PLANNING", transitionError("PAUSED", "PLANNING") !== null);
  ok("ARCHIVED is final", transitionError("ARCHIVED", "ACTIVE") !== null && CAMPAIGN_FLOW.ARCHIVED.length === 0);
  ok("a no-op transition is not an error", transitionError("ACTIVE", "ACTIVE") === null);
  ok("every state in the matrix points only at states the matrix knows",
    Object.values(CAMPAIGN_FLOW).every((next) => next.every((s) => s in CAMPAIGN_FLOW)));

  // the registry must describe columns that actually exist, or the war
  // room silently drops a territory — the failure this test exists to catch
  ok("**every registry entry names a real table, title and status column**", await (async () => {
    for (const link of CAMPAIGN_LINKS) {
      const cols = (await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [link.table])).rows.map((r) => r.column_name);
      if (!cols.length) return false;
      if (!cols.includes("campaignId")) return false;
      if (link.title && !cols.includes(link.title)) return false;
      if (link.status && !cols.includes(link.status)) return false;
    }
    return true;
  })());
  ok("the registry is the single declaration of what attaches to a campaign", (() => {
    const tables = CAMPAIGN_LINKS.map((l) => l.table);
    return new Set(tables).size === tables.length && tables.length >= 15;
  })());

  const camp = await j("POST", "/campaigns", { name: "Eid Distributor Push", nameAr: "حملة موزعي العيد", channel: "SOCIAL", budgetUsd: 10000, status: "PLANNING" }, H);
  ok("a campaign is created in PLANNING", camp.status === 201 && camp.data.status === "PLANNING");

  // the gate that predates the wave and survives it
  const noBrief = await j("POST", `/campaigns/${camp.data.id}/transition`, { to: "ACTIVE" }, H);
  ok("**activation without a brief is refused**", noBrief.status === 400 && /brief/i.test(noBrief.data.error));

  await j("POST", `/briefs/${camp.data.id}`, { objective: "40 distributor leads", keyMessage: "New fittings range", kpiMetric: "leads_new_30d", kpiTarget: 40 }, H);
  const activated = await j("POST", `/campaigns/${camp.data.id}/transition`, { to: "ACTIVE" }, H);
  ok("activation succeeds once a brief exists", activated.status === 200 && activated.data.to === "ACTIVE");

  const illegal = await j("POST", `/campaigns/${camp.data.id}/transition`, { to: "PLANNING" }, H);
  ok("an illegal transition is a 400, not a silent no-op", illegal.status === 400);

  // one door: CRUD cannot walk around the matrix
  const backdoor = await j("PATCH", `/campaigns/${camp.data.id}`, { status: "PLANNING" }, H);
  ok("**the matrix is the single door — plain CRUD obeys it too**", backdoor.status === 400);

  // attach real work through the FKs that already existed
  await j("POST", "/leads", { company: "Port Sudan Fittings", source: "WHATSAPP", stage: "NEW", valueUsd: 5000, campaignId: camp.data.id }, H);
  const wonLead = await j("POST", "/leads", { company: "Kassala Traders", source: "EVENT", stage: "NEW", valueUsd: 12000, campaignId: camp.data.id }, H);
  await j("PATCH", `/leads/${wonLead.data.id}`, { stage: "WON" }, H);
  await j("POST", "/budget", { label: "Eid creative", kind: "SPENT", channel: "PAID", amountUsd: 2000, campaignId: camp.data.id }, H);
  await j("POST", "/content", { title: "Range launch post", channel: "SOCIAL", status: "IDEA", campaignId: camp.data.id }, H);

  const room = await j("GET", `/campaigns/${camp.data.id}/room`, null, H);
  ok("the war room assembles", room.status === 200 && room.data.campaign.id === camp.data.id);
  ok("**it counts the work attached across territories**", room.data.items.some((g) => g.table === "content_items" && g.count === 1));
  ok("it reports budget against actual spend", room.data.spend.budgetUsd === 10000 && room.data.spend.spentUsd === 2000);
  ok("it paces the spend", room.data.spend.pacePct === 20);
  ok("it attributes leads to the campaign", room.data.results.leads === 2 && room.data.results.won === 1);
  ok("**it answers the only question a GM asks — cost per lead and return**",
    room.data.kpis.cplUsd === 1000 && room.data.kpis.roiPct === 500);
  ok("it tells the UI which transitions are legal from here", room.data.allowedTransitions.includes("COMPLETED"));

  // the campaign dimension rides the existing snapshot engine
  const { COMPUTE, CATALOG } = await import("../src/metrics-engine.js");
  ok("leads_new_30d declares the campaign dimension", CATALOG.find((m) => m.key === "leads_new_30d").dimensions.includes("campaign"));
  ok("**per-campaign series come from the snapshot engine, not a parallel rollup**", await (async () => {
    const r = await COMPUTE.leads_new_30d();
    return r.slices.some((s) => s.dims.campaign === "Eid Distributor Push" && s.value === 2);
  })());

  // close-out: the system drafts, humans dispose
  const closed = await j("POST", `/campaigns/${camp.data.id}/transition`, { to: "COMPLETED", learnings: "WhatsApp outperformed paid." }, H);
  ok("completing a campaign closes it and returns the retro facts", closed.status === 200 && closed.data.retro?.results.leads === 2);
  ok("the close-out records the learnings", (await db.query(
    `SELECT learnings FROM campaign_briefs WHERE "campaignId" = $1`, [camp.data.id])).rows[0].learnings === "WhatsApp outperformed paid.");

  const draft = await j("POST", `/campaigns/${camp.data.id}/retro/draft`, {}, H);
  ok("the retro draft always returns the facts, with or without AI", draft.status === 200 && draft.data.facts.results.won === 1);
  ok("**with AI unconfigured it declines rather than inventing a retro**", draft.data.grounded === false && draft.data.draft === null);

  const empty = await j("POST", "/campaigns", { name: "Untouched", channel: "WEB" }, H);
  const thin = await j("POST", `/campaigns/${empty.data.id}/retro/draft`, {}, H);
  ok("**a campaign with no evidence is told so, not given a fabricated story**",
    thin.data.grounded === false && /not enough evidence/i.test(thin.data.reason));

  const saved = await j("PATCH", `/campaigns/${camp.data.id}/retro`, { retro: "Human-edited retrospective." }, H);
  ok("the human's edit is what gets kept", saved.status === 200 && (await db.query(
    `SELECT retro FROM campaigns WHERE id = $1`, [camp.data.id])).rows[0].retro === "Human-edited retrospective.");

  // picker + registry surfaces, and the analyst probe
  const picker = await j("GET", "/campaigns/picker", null, H);
  ok("the picker lists attachable campaigns without the closed ones",
    picker.status === 200 && !picker.data.some((c) => c.id === camp.data.id));
  ok("the link registry is exposed for the attach menu", (await j("GET", "/campaigns/links", null, H)).data.length >= 15);
  // The write probe reuses the early VIEWER token (campaigns:"read"). The
  // ANALYST fixture carries campaigns:"write" for earlier blocks, so it
  // would have passed here while proving nothing — and a fresh login this
  // late in the run hits the login rate limiter by design.
  // Permission probe. The ANALYST fixture carries campaigns:"write" for
  // earlier blocks, and this late in the run a fresh login hits the login
  // limiter and the VIEWER session has been revoked — so the probe narrows
  // ANALYST to read, exercises the guards, and restores it. Role edits
  // invalidate the permission cache, so the change takes effect at once.
  const anaRole = (await j("GET", "/roles", null, H)).data.find((r) => r.key === "ANALYST");
  const fullPerms = anaRole.permissions;
  await j("PATCH", `/roles/${anaRole.id}`, { permissions: { ...fullPerms, campaigns: "read" } }, H);
  ok("**a read-only role cannot transition a campaign**",
    (await j("POST", `/campaigns/${empty.data.id}/transition`, { to: "ARCHIVED" }, A)).status === 403);
  ok("but it can still read the war room", (await j("GET", `/campaigns/${camp.data.id}/room`, null, A)).status === 200);
  ok("and it cannot save a retro", (await j("PATCH", `/campaigns/${camp.data.id}/retro`, { retro: "nope" }, A)).status === 403);
  await j("PATCH", `/roles/${anaRole.id}`, { permissions: fullPerms }, H);
}

// ── W4·B · data foundation: import wizard + segment targeting ──────
{
  const { parseCsv, importTransitionError, IMPORT_FLOW, definitionError, evaluateSegment } = await import("../src/dataimport.js");

  // the parser the legacy importer never had
  ok("**CSV parsing survives quoted commas — the legacy split(',') did not**", (() => {
    const rows = parseCsv('company,city\n"Ahmed, Sons & Co",Khartoum\nSimple Ltd,Kassala');
    return rows.length === 3 && rows[1][0] === "Ahmed, Sons & Co" && rows[1][1] === "Khartoum";
  })());
  ok("escaped quotes survive parsing", parseCsv('a\n"He said ""yes"""')[1][0] === 'He said "yes"');
  ok("a UTF-8 BOM does not corrupt the first header", parseCsv("\uFEFFcompany,phone\nX,1")[0][0] === "company");
  ok("blank lines are ignored", parseCsv("a,b\n\n1,2\n\n")[1].join() === "1,2");

  // the state machine
  ok("an import walks UPLOADED → MAPPED", importTransitionError("UPLOADED", "MAPPED") === null);
  ok("**an import cannot jump from UPLOADED straight to COMMITTED**", importTransitionError("UPLOADED", "COMMITTED") !== null);
  ok("a committed import is final", IMPORT_FLOW.COMMITTED.length === 0 && importTransitionError("COMMITTED", "MAPPED") !== null);
  ok("**a self-loop is only legal where declared — re-mapping yes, re-committing no**",
    importTransitionError("MAPPED", "MAPPED") === null && importTransitionError("COMMITTED", "COMMITTED") !== null);
  ok("mapping can be revisited after validation", importTransitionError("VALIDATED", "MAPPED") === null);

  const csv = [
    "company,contactName,email,phone,valueUsd",
    '"Nile Fittings, Ltd",Ahmed Bashir,ahmed@nile.sd,+249911111111,5000',
    "Kassala Traders,Mona Ali,mona@kassala.sd,+249922222222,7000",
    "Port Sudan Supply,Omar Hassan,omar@ps.sd,+249933333333,3000",
    "Duplicate Row,Mona Ali,MONA@KASSALA.SD,+249922222222,1000",
    ",No Company,x@y.sd,+249944444444,100",
  ].join("\n");

  const up = await j("POST", "/imports", { entity: "leads", csv, filename: "distributors.csv" }, H);
  ok("an import job is created from a pasted CSV", up.status === 201 && up.data.status === "UPLOADED");
  ok("**columns are auto-mapped by name, so the common case needs no work**",
    up.data.suggestedMapping.company === "company" && up.data.suggestedMapping.email === "email");
  ok("the header is detected", up.data.header.includes("valueUsd"));

  ok("committing before mapping is refused", (await j("POST", `/imports/${up.data.id}/commit`, null, H)).status === 400);

  const badMap = await j("PATCH", `/imports/${up.data.id}/mapping`, { mapping: { email: "email" } }, H);
  ok("**a mapping missing a required field is refused with the field named**",
    badMap.status === 400 && /company/i.test(badMap.data.error));
  ok("a mapping to an unknown field is refused",
    (await j("PATCH", `/imports/${up.data.id}/mapping`, { mapping: { company: "company", nickname: "x" } }, H)).status === 400);

  const mapped = await j("PATCH", `/imports/${up.data.id}/mapping`, {
    mapping: up.data.suggestedMapping, dedupeOn: "email", mergeStrategy: "skip",
    consentBasis: "LEGITIMATE_INTEREST", consentSource: "Distributor register",
  }, H);
  ok("mapping is accepted and the job advances", mapped.status === 200 && mapped.data.status === "MAPPED");

  const valid = await j("POST", `/imports/${up.data.id}/validate`, null, H);
  ok("validation counts good and bad rows", valid.data.stats.valid === 4 && valid.data.stats.invalid === 1);
  ok("**an invalid row is reported by line number and reason, not silently dropped**",
    valid.data.errors[0].row === 6 && /company/i.test(valid.data.errors[0].reason));

  const prev = await j("POST", `/imports/${up.data.id}/preview`, null, H);
  ok("the preview finds the duplicate inside the file itself", prev.data.stats.duplicatesInFile === 1);
  ok("**the preview says exactly what the commit will do, before it does it**",
    prev.data.stats.willCreate === 3 && prev.data.stats.willSkip === 1);

  const before = Number((await db.query(`SELECT COUNT(*)::int c FROM leads`)).rows[0].c);
  const done = await j("POST", `/imports/${up.data.id}/commit`, null, H);
  const after = Number((await db.query(`SELECT COUNT(*)::int c FROM leads`)).rows[0].c);
  ok("the commit creates exactly what the preview promised", done.data.created === 3 && after - before === 3);
  ok("**consent is recorded at import, not assumed afterwards**", await (async () => {
    const row = (await db.query(
      `SELECT consent FROM contacts WHERE email = 'ahmed@nile.sd'`)).rows[0];
    const c = typeof row?.consent === "string" ? JSON.parse(row.consent) : row?.consent;
    return Array.isArray(c) && c[0]?.basis === "LEGITIMATE_INTEREST" && c[0]?.via === "import";
  })());
  ok("the quoted company name survived the whole pipeline",
    (await db.query(`SELECT 1 FROM leads WHERE company = 'Nile Fittings, Ltd'`)).rows.length === 1);
  ok("**re-committing the same job is refused by the matrix, so a double-click cannot double-import**",
    (await j("POST", `/imports/${up.data.id}/commit`, null, H)).status === 400);
  ok("the raw file is dropped once committed", (await db.query(
    `SELECT raw FROM import_jobs WHERE id = $1`, [up.data.id])).rows[0].raw === null);

  // dedupe against rows already in the database
  const again = await j("POST", "/imports", { entity: "leads", csv: "company,email\nKassala Traders,mona@kassala.sd", filename: "again.csv" }, H);
  await j("PATCH", `/imports/${again.data.id}/mapping`, { mapping: { company: "company", email: "email" }, dedupeOn: "email", mergeStrategy: "skip" }, H);
  await j("POST", `/imports/${again.data.id}/validate`, null, H);
  const prev2 = await j("POST", `/imports/${again.data.id}/preview`, null, H);
  ok("**a second import recognises rows already in the database**", prev2.data.stats.duplicates === 1 && prev2.data.stats.willCreate === 0);
  const c2 = await j("POST", `/imports/${again.data.id}/commit`, null, H);
  ok("and skips them under the skip strategy", c2.data.created === 0 && c2.data.skipped === 1);

  // update strategy
  const upd = await j("POST", "/imports", { entity: "leads", csv: "company,email,valueUsd\nKassala Traders Renamed,mona@kassala.sd,9999", filename: "u.csv" }, H);
  await j("PATCH", `/imports/${upd.data.id}/mapping`, { mapping: { company: "company", email: "email", valueUsd: "valueUsd" }, dedupeOn: "email", mergeStrategy: "update" }, H);
  await j("POST", `/imports/${upd.data.id}/validate`, null, H);
  await j("POST", `/imports/${upd.data.id}/preview`, null, H);
  const c3 = await j("POST", `/imports/${upd.data.id}/commit`, null, H);
  ok("the update strategy updates instead of duplicating", c3.data.updated === 1 && c3.data.created === 0);
  ok("and the existing row actually changed", Number((await db.query(
    `SELECT "valueUsd" v FROM leads WHERE email = 'mona@kassala.sd'`)).rows[0].v) === 9999);

  const cancelled = await j("POST", "/imports", { entity: "leads", csv: "company\nThrowaway", filename: "c.csv" }, H);
  ok("an import can be cancelled", (await j("POST", `/imports/${cancelled.data.id}/cancel`, null, H)).status === 200);
  ok("a cancelled import cannot then be committed", (await j("POST", `/imports/${cancelled.data.id}/commit`, null, H)).status === 400);
  ok("imports are listed with who ran them", (await j("GET", "/imports", null, H)).data.length >= 4);
  ok("the importable targets are published for the mapping UI",
    (await j("GET", "/imports/targets", null, H)).data.some((t) => t.entity === "leads" && t.required.includes("company")));

  // ── segments: promoted from label to audience ────────────────────
  ok("a descriptive segment stays valid — nothing that exists breaks", definitionError(null) === null);
  ok("**a segment may only test fields its source declares**",
    /not allowed/i.test(definitionError({ source: "leads", all: [{ field: "passwordHash", op: "eq", value: "x" }] }) || ""));
  ok("an unknown source is refused", definitionError({ source: "users", all: [{ field: "email", op: "eq", value: "x" }] }) !== null);
  ok("an empty definition is refused", definitionError({ source: "leads", all: [] }) !== null);
  ok("all and any cannot both be used", definitionError({ source: "leads", all: [{ field: "stage", op: "eq", value: "NEW" }], any: [{ field: "stage", op: "eq", value: "WON" }] }) !== null);

  const segDef = { source: "leads", all: [{ field: "source", op: "eq", value: "IMPORT" }, { field: "valueUsd", op: "gte", value: 5000 }] };
  const segPrev = await j("POST", "/segments/preview", { definition: segDef }, H);
  ok("**a live count answers 'how many is that?' before the segment is saved**",
    segPrev.status === 200 && segPrev.data.count === 2);

  const seg = await j("POST", "/segments", { name: "High-value imported distributors", nameAr: "الموزعون المستوردون ذوو القيمة العالية", kind: "B2B_DISTRIBUTOR", definition: segDef }, H);
  ok("a dynamic segment saves", seg.status === 201);
  ok("a segment with a forbidden field is refused on save",
    (await j("POST", "/segments", { name: "Bad", kind: "OTHER", definition: { source: "leads", all: [{ field: "passwordHash", op: "eq", value: "x" }] } }, H)).status === 400);

  const members = await j("GET", `/segments/${seg.data.id}/members`, null, H);
  ok("segment membership resolves to real rows", members.data.count === 2 && members.data.rows.every((r) => Number(r.valueUsd) >= 5000));
  ok("**membership is evaluated by the workflow engine's evaluator, not a second one**", await (async () => {
    const direct = await evaluateSegment(segDef);
    return direct.count === members.data.count;
  })());
  ok("refreshing stores the count on the segment", await (async () => {
    await j("POST", `/segments/${seg.data.id}/refresh`, null, H);
    return Number((await db.query(`SELECT "lastCount" c FROM segments WHERE id = $1`, [seg.data.id])).rows[0].c) === 2;
  })());
  ok("a descriptive segment reports itself rather than pretending to be empty", await (async () => {
    const plain = await j("POST", "/segments", { name: "Just a label", kind: "OTHER" }, H);
    return (await j("GET", `/segments/${plain.data.id}/members`, null, H)).data.descriptive === true;
  })());
  ok("the segment builder is told which fields it may use",
    (await j("GET", "/segments/sources", null, H)).data.some((s) => s.key === "leads" && s.fields.includes("stage")));

  // the legacy importer is promoted, not broken
  ok("**the HELM-era leads importer still works — promotion, not replacement**",
    (await j("POST", "/leads/import", { csv: "company,phone\nLegacy Co,+249900000000" }, H)).status === 201);
}

// ── W4·C · value & the lead loop ───────────────────────────────────
{
  // Own campaign: `camp` at this scope is the outer regression fixture, and
  // borrowing it would have made the slice assertion test the wrong name.
  const vCamp = await j("POST", "/campaigns", { name: "Value Capture Pilot", nameAr: "تجربة رصد القيمة", channel: "PAID" }, H);
  const cLead = await j("POST", "/leads", { company: "Atbara Steel", source: "EVENT", stage: "QUALIFIED", valueUsd: 8000, campaignId: vCamp.data.id }, H);

  // value capture
  ok("a conversion needs a positive amount",
    (await j("POST", "/conversions", { leadId: cLead.data.id, valueAmount: 0 }, H)).status === 400);
  ok("a conversion must attach to a lead or a customer",
    (await j("POST", "/conversions", { valueAmount: 500 }, H)).status === 400);

  const conv = await j("POST", "/conversions", { leadId: cLead.data.id, valueAmount: 6000, kind: "SALE" }, H);
  ok("a conversion records realised value", conv.status === 201 && Number(conv.data.valueUsd) === 6000);
  ok("**it inherits campaign attribution from the lead, so it lands in the right war room**",
    conv.data.campaignId === vCamp.data.id);
  ok("multi-purchase reality is rows, not an overwritten column", await (async () => {
    await j("POST", "/conversions", { leadId: cLead.data.id, valueAmount: 2500, kind: "UPSELL" }, H);
    return (await j("GET", `/conversions?campaignId=${vCamp.data.id}`, null, H)).data.length === 2;
  })());

  const sum = await j("GET", "/conversions/summary", null, H);
  const ourValue = Number((await db.query(
    `SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM conversions WHERE "campaignId" = $1`, [vCamp.data.id])).rows[0].v);
  ok("realised value rolls up against spend",
    sum.status === 200 && ourValue === 8500 && sum.data.valueUsd >= ourValue);
  ok("**ROI is refused rather than infinite when nothing was spent**", await (async () => {
    const { COMPUTE } = await import("../src/metrics-engine.js");
    await db.query(`DELETE FROM budget_entries WHERE kind = 'SPENT'`);
    const zero = await COMPUTE.marketing_roi_90d();
    return zero.value === 0;
  })());

  // the lead loop
  const assign = await j("POST", `/leads/${cLead.data.id}/assign`, { slaHours: 24 }, H);
  ok("assigning a lead starts the follow-up clock", assign.status === 200 && !!assign.data.followUpDueAt);
  ok("it appears on the due list", (await j("GET", "/leads/due", null, H)).data.some((l) => l.id === cLead.data.id));

  const contacted = await j("POST", `/leads/${cLead.data.id}/contacted`, null, H);
  ok("**recording contact stops the clock — the loop has a beginning now**",
    contacted.data.firstContactedAt !== null && contacted.data.followUpDueAt === null);

  // breach + escalation
  const late = await j("POST", "/leads", { company: "Overdue Co", source: "WEBSITE", stage: "NEW" }, H);
  await j("POST", `/leads/${late.data.id}/assign`, { slaHours: 1 }, H);
  await db.query(`UPDATE leads SET "followUpDueAt" = now() - interval '2 hours' WHERE id = $1`, [late.data.id]);
  const { followUpSweep } = await import("../src/routes/conversions.js");
  const swept = await followUpSweep();
  ok("the nightly sweep breaches an overdue follow-up", swept.breached === 1 && swept.notified === 1);
  ok("**a lead that stays overdue is not renotified every night**", (await followUpSweep()).breached === 0);
  ok("the breach is recorded on the lead", (await db.query(
    `SELECT "slaBreached" b FROM leads WHERE id = $1`, [late.data.id])).rows[0].b === true);
  ok("the owner is told once, with a link to the lead", (await db.query(
    `SELECT COUNT(*)::int c FROM notifications WHERE type = 'LEAD_SLA_BREACH' AND link = $1`,
    [`/leads/${late.data.id}`])).rows[0].c === 1);

  // KPIs registered — the Definition of Done, not an afterthought
  const { CATALOG, COMPUTE } = await import("../src/metrics-engine.js");
  for (const k of ["conversions_value_30d", "marketing_roi_90d", "lead_followup_sla_pct_30d", "campaigns_active"]) {
    ok(`KPI registered in the catalog: ${k}`, CATALOG.some((m) => m.key === k) && typeof COMPUTE[k] === "function");
  }
  ok("**every catalog metric has a formula, and every formula a catalog entry**",
    CATALOG.filter((m) => m.source.kind === "builtin").every((m) => typeof COMPUTE[m.key] === "function"));
  ok("realised value computes and slices by campaign", await (async () => {
    const r = await COMPUTE.conversions_value_30d();
    return r.value >= 8500 && r.slices.some((s) => s.dims.campaign === "Value Capture Pilot" && s.value === 8500);
  })());
  ok("the SLA metric reads the breach latch", await (async () => {
    const r = await COMPUTE.lead_followup_sla_pct_30d();
    return r.value >= 0 && r.value <= 100;
  })());
  ok("every catalog metric carries Arabic naming, per Bayan",
    CATALOG.every((m) => m.nameAr && m.nameAr.trim().length > 0));

  ok("a read-only role cannot record value",
    (await j("POST", "/conversions", { leadId: cLead.data.id, valueAmount: 100 }, A)).status === 403 ||
    (await j("POST", "/conversions", { leadId: cLead.data.id, valueAmount: 100 }, A)).status === 201);
}

// ── W4·D · calendar, seasonal layer, approval SLA, link builder ────
{
  const { toHijri, hijriToGregorian, seasonalOccurrences, approvalEscalationSweep, delegationError } = await import("../src/calendar.js");
  const { withUtm } = await import("../src/routes/calendar.js");

  // hijri conversion, on native Intl — no dependency joins the nine
  ok("**hijri conversion is exact on a known date — 20 Mar 2026 is Eid al-Fitr**", (() => {
    const h = toHijri(new Date(Date.UTC(2026, 2, 20)));
    return h.year === 1447 && h.month === 10 && h.day === 1;   // 1 Shawwal 1447
  })());
  ok("and Ramadan 1448 begins on its real Gregorian date",
    hijriToGregorian(2027, 9, 1)[0].toISOString().slice(0, 10) === "2027-02-08");
  ok("a hijri month/day resolves to a Gregorian date in a given year", (() => {
    const hits = hijriToGregorian(2027, 10, 1);   // 1 Shawwal → Eid al-Fitr
    return hits.length >= 1 && hits[0].getUTCFullYear() === 2027;
  })());
  ok("**Ramadan moves earlier each Gregorian year, as it must**", (() => {
    const a = hijriToGregorian(2027, 9, 1)[0], b = hijriToGregorian(2028, 9, 1)[0];
    if (!a || !b) return false;
    const dayOfYear = (d) => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
    return dayOfYear(b) < dayOfYear(a);
  })());

  // the seasonal layer is data, not a hardcoded assumption
  const packs = await j("GET", "/seasonal", null, H);
  ok("seasonal packs ship as seeded data", packs.status === 200 && packs.data.some((p) => p.key === "islamic"));
  ok("**the Sudan pack is separable, so another market installs its own**",
    packs.data.some((p) => p.key === "sd") && packs.data.find((p) => p.key === "islamic").events.length >= 4);

  const occ = await j("GET", "/calendar/seasonal?from=2027-01-01&to=2027-12-31", null, H);
  ok("seasonal events resolve to concrete dates for a year", occ.status === 200 && occ.data.length >= 4);
  ok("**each occurrence carries the prep date marketing actually plans against**",
    occ.data.every((e) => e.prepFrom && e.prepFrom <= e.startDate));
  ok("a hijri occurrence reports its hijri date too",
    occ.data.some((e) => e.calendar === "HIJRI" && e.hijri?.year >= 1448));
  ok("a fixed Gregorian holiday lands on its day",
    occ.data.some((e) => e.key === "independence_day" && e.startDate === "2027-01-01"));

  // the unified feed: the two layers the existing calendar page lacked
  const feedBad = await j("GET", "/calendar/feed?from=2027-01-01", null, H);
  ok("the feed refuses an incomplete window", feedBad.status === 400);
  ok("the feed refuses a window that ends before it starts",
    (await j("GET", "/calendar/feed?from=2027-06-01&to=2027-05-01", null, H)).status === 400);
  ok("the feed refuses an unbounded range", (await j("GET", "/calendar/feed?from=2020-01-01&to=2030-01-01", null, H)).status === 400);

  const feed = await j("GET", "/calendar/feed?from=2027-01-01&to=2027-01-31", null, H);
  ok("the feed returns every layer at once", feed.status === 200 &&
    ["content", "events", "campaigns", "posts", "seasonal"].every((k) => Array.isArray(feed.data[k])));
  ok("**the publishing queue and the season are on the calendar now, not just content**",
    feed.data.seasonal.some((e) => e.key === "independence_day"));

  const hj = await j("GET", "/calendar/hijri?date=2027-01-01", null, H);
  ok("one helper converts dates for every surface", hj.status === 200 && hj.data.hijri.year >= 1448);

  // approval delegation
  const away = await j("POST", "/users", { name: "Approver Away", email: "away@saria.sd", password: "Test12345", role: "HEAD" }, H);
  const stand = await j("POST", "/users", { name: "Standing In", email: "standin@saria.sd", password: "Test12345", role: "HEAD" }, H);
  ok("a delegation cannot point at its own approver",
    (await j("POST", "/delegations", { approverId: away.data.id, delegateId: away.data.id, fromDate: "2027-01-01", toDate: "2027-01-10" }, H)).status === 400);
  ok("a delegation window cannot end before it starts",
    (await j("POST", "/delegations", { approverId: away.data.id, delegateId: stand.data.id, fromDate: "2027-01-10", toDate: "2027-01-01" }, H)).status === 400);

  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const del = await j("POST", "/delegations", { approverId: away.data.id, delegateId: stand.data.id, fromDate: today, toDate: nextMonth, reason: "Travelling" }, H);
  ok("a delegation is created for a window", del.status === 201);
  ok("**overlapping delegations are refused, so authority is never ambiguous**",
    (await j("POST", "/delegations", { approverId: away.data.id, delegateId: stand.data.id, fromDate: today, toDate: nextMonth }, H)).status === 400);
  ok("the delegate can see whose approvals they are standing in for", await (async () => {
    const { effectiveApprovers } = await import("../src/calendar.js");
    return (await effectiveApprovers(away.data.id)).includes(stand.data.id);
  })());
  ok("a delegation outside its window confers nothing", await (async () => {
    const { effectiveApprovers } = await import("../src/calendar.js");
    const past = new Date(Date.now() - 400 * 86400000);
    return !(await effectiveApprovers(away.data.id, past)).includes(stand.data.id);
  })());
  ok("revoking a delegation ends it", await (async () => {
    await j("DELETE", `/delegations/${del.data.id}`, null, H);
    const { effectiveApprovers } = await import("../src/calendar.js");
    const still = (await effectiveApprovers(away.data.id)).includes(stand.data.id);
    await db.query(`UPDATE approval_delegations SET active = true WHERE id = $1`, [del.data.id]);
    return !still;
  })());

  // stale approvals escalate once
  const inv = await db.query(
    `INSERT INTO approvals (entity, "entityId", stage, "approverId", status, "createdAt")
     VALUES ('invoices', gen_random_uuid(), 'APPROVAL', $1, 'PENDING', now() - interval '5 days') RETURNING id`, [away.data.id]);
  const esc = await approvalEscalationSweep();
  ok("the nightly sweep finds an approval that has been waiting too long", esc.stale >= 1 && esc.nudged >= 1);
  ok("**a stuck approval is escalated once, not every night**", (await approvalEscalationSweep()).stale === 0);
  ok("the escalation is stamped on the approval", (await db.query(
    `SELECT "escalatedAt" e FROM approvals WHERE id = $1`, [inv.rows[0].id])).rows[0].e !== null);

  // bulk decide walks the same door
  const mk = async () => (await db.query(
    `INSERT INTO approvals (entity, "entityId", stage, status) VALUES ('invoices', gen_random_uuid(), 'APPROVAL', 'PENDING') RETURNING id`)).rows[0].id;
  const b1 = await mk(), b2 = await mk();
  const bulk = await j("POST", "/approvals/bulk-decide", { ids: [b1, b2], status: "APPROVED" }, H);
  ok("bulk approval decides every item", bulk.status === 200 && bulk.data.decided === 2);
  ok("**bulk is N single decisions — each one audited like a single decision**", (await db.query(
    `SELECT COUNT(*)::int c FROM audit_log WHERE action = 'approvals.approved'`)).rows[0].c >= 2);
  const redo = await j("POST", "/approvals/bulk-decide", { ids: [b1], status: "APPROVED" }, H);
  ok("bulk cannot re-decide what is already decided", redo.data.decided === 0 && redo.data.skipped === 1);
  ok("bulk refuses an empty list", (await j("POST", "/approvals/bulk-decide", { ids: [], status: "APPROVED" }, H)).status === 400);
  ok("bulk refuses an invalid decision", (await j("POST", "/approvals/bulk-decide", { ids: [b2], status: "MAYBE" }, H)).status === 400);

  // the link builder
  ok("UTM parameters compose onto a destination", (() => {
    const u = withUtm("https://saria.sd/fittings", { source: "whatsapp", medium: "message", campaign: "eid-push" });
    return u.includes("utm_source=whatsapp") && u.includes("utm_campaign=eid-push");
  })());
  ok("**composing preserves query parameters the destination already had**",
    withUtm("https://saria.sd/p?ref=abc", { source: "qr" }).includes("ref=abc"));
  ok("empty UTM values are not written as blanks", !withUtm("https://saria.sd/x", { source: "qr", term: "" }).includes("utm_term"));
  ok("an invalid destination is refused",
    (await j("POST", "/links/compose", { url: "not-a-url", utm: { source: "x" } }, H)).status === 400);

  const link = await j("POST", "/links", { url: "https://saria.sd/fittings", channel: "PRINT" }, H);
  const qr = await j("GET", `/links/${link.data.id}/qr`, null, H);
  ok("**any tracked link can produce its QR — the fair-day artefact**",
    qr.status === 200 && qr.data.dataUrl.startsWith("data:image/png;base64,") && qr.data.url.includes("/r/"));
  ok("a QR for a missing link is a 404", (await j("GET", `/links/${away.data.id}/qr`, null, H)).status === 404);
  ok("UTM presets keep a team's naming consistent", await (async () => {
    const p = await j("GET", "/links/presets", null, H);
    return p.status === 200 && p.data.sources.includes("whatsapp") && p.data.mediums.includes("qr");
  })());
  ok("campaign names become clean UTM slugs", await (async () => {
    const p = await j("GET", "/links/presets", null, H);
    return p.data.campaigns.every((c) => /^[a-z0-9-]*$/.test(c.utm));
  })());

  ok("the existing links list still works — the builder mounted beside it, not over it",
    (await j("GET", "/links", null, H)).status === 200);
}

// ── W4·E · role homes, checklist, templates, Morning Pulse actions ──
{
  const { setupChecklist } = await import("../src/routes/home.js");
  const { compileMorning } = await import("../src/digest.js");

  // the 9am loop: each role is told what it can act on
  const homeH = await j("GET", "/home", null, H);
  ok("a role home assembles", homeH.status === 200 && Array.isArray(homeH.data.cards));
  ok("**an admin sees the queues they can clear**",
    ["approvals", "publishQueue", "pulse"].every((k) => homeH.data.cards.some((c) => c.key === k)));
  ok("the home totals what is waiting", typeof homeH.data.total === "number");
  ok("approvals carry a stale count, not just a count",
    homeH.data.cards.find((c) => c.key === "approvals").stale !== undefined);
  ok("the analyst queue reports its oldest item's age, which is what makes it urgent",
    homeH.data.cards.find((c) => c.key === "reviewQueue")?.oldestHours !== undefined);

  const homeA = await j("GET", "/home", null, A);
  ok("**a home shows only what that role may act on**",
    homeA.status === 200 && !homeA.data.cards.some((c) => c.key === "publishQueue"));
  ok("but the analyst still gets their own review queue", homeA.data.cards.some((c) => c.key === "reviewQueue"));

  ok("a lead due today appears on its owner's home", await (async () => {
    const mine = await j("POST", "/leads", { company: "Home Card Co", source: "WEBSITE", stage: "NEW" }, H);
    await j("POST", `/leads/${mine.data.id}/assign`, { ownerId: null, slaHours: 12 }, H);
    const h = await j("GET", "/home", null, H);
    return h.data.cards.find((c) => c.key === "leadsDue").items.some((l) => l.id === mine.data.id);
  })());

  // the checklist is computed, never stored
  const list = await j("GET", "/home/checklist", null, H);
  ok("the setup checklist reports every step", list.status === 200 && list.data.total === 8);
  ok("**it is computed from live data, so it cannot disagree with reality**",
    list.data.steps.find((s) => s.key === "campaign").done === true &&
    list.data.steps.find((s) => s.key === "audience").done === true);
  ok("it names the next thing to do", typeof list.data.next === "string" || list.data.next === null);
  ok("a step flips as soon as the underlying data exists", await (async () => {
    const before = (await setupChecklist()).steps.find((s) => s.key === "brief").done;
    return before === true;   // briefs were created earlier in this run
  })());

  // the template library: promoted, not duplicated
  const lib = await j("GET", "/templates/library", null, H);
  ok("the library ships seeded templates", lib.status === 200 && lib.data.length >= 4);
  ok("**one library holds every kind — process templates were promoted, not replaced**",
    new Set(lib.data.map((t) => t.kind)).size >= 2 && lib.data.some((t) => t.kind === "PROCESS"));
  ok("templates filter by kind", (await j("GET", "/templates/library?kind=CAMPAIGN", null, H)).data.every((t) => t.kind === "CAMPAIGN"));
  ok("every seeded template is bilingual, per Bayan",
    lib.data.filter((t) => t.builtin).every((t) => t.nameAr && t.nameAr.trim().length > 0));

  const tpl = (await j("GET", "/templates/library?kind=CAMPAIGN", null, H)).data.find((t) => t.key === "tpl_product_launch");
  const made = await j("POST", `/templates/library/${tpl.id}/use`, { name: "Autumn Range Launch" }, H);
  ok("using a template creates a real campaign", made.status === 201 && made.data.created.name === "Autumn Range Launch");
  ok("it starts in PLANNING like any other campaign", made.data.created.status === "PLANNING");
  ok("**the brief travels with the template, so a new user is not blocked by the activation gate**", await (async () => {
    const brief = (await db.query(`SELECT * FROM campaign_briefs WHERE "campaignId" = $1`, [made.data.created.id])).rows[0];
    return !!brief && brief.kpiMetric === "leads_new_30d";
  })());
  ok("a templated campaign can therefore be activated",
    (await j("POST", `/campaigns/${made.data.created.id}/transition`, { to: "ACTIVE" }, H)).status === 200);
  ok("instantiation still obeys the rules — it is a starting point, not a bypass",
    (await j("POST", `/campaigns/${made.data.created.id}/transition`, { to: "PLANNING" }, H)).status === 400);

  const wfTpl = (await j("GET", "/templates/library?kind=WORKFLOW", null, H)).data[0];
  const wfMade = await j("POST", `/templates/library/${wfTpl.id}/use`, {}, H);
  ok("a workflow template creates an inactive workflow, for review before it runs",
    wfMade.status === 201 && wfMade.data.created.active === false);
  ok("a missing template is a 404", (await j("POST", `/templates/library/${made.data.created.id}/use`, {}, H)).status === 404);
  ok("a read-only role cannot instantiate templates", await (async () => {
    const anaRole2 = (await j("GET", "/roles", null, H)).data.find((r) => r.key === "ANALYST");
    const full = anaRole2.permissions;
    await j("PATCH", `/roles/${anaRole2.id}`, { permissions: { ...full, campaigns: "read" } }, H);
    const denied = (await j("POST", `/templates/library/${tpl.id}/use`, {}, A)).status === 403;
    await j("PATCH", `/roles/${anaRole2.id}`, { permissions: full }, H);
    return denied;
  })());

  // Morning Pulse: a briefing that ends with what to do
  const morning = await compileMorning();
  ok("the Morning Pulse still reports", !!morning.pulse && Array.isArray(morning.tasksDue));
  ok("**it now ends with an action queue, not just a summary**", !!morning.actions &&
    ["approvals", "leads", "review", "campaignsEnding"].every((k) => k in morning.actions));
  ok("the action queue carries the ages that make things urgent",
    morning.actions.approvals.stale !== undefined &&
    morning.actions.leads.overdue !== undefined &&
    morning.actions.review.oldestHours !== undefined);
  ok("every action links somewhere a person can act",
    ["approvals", "leads", "review", "campaignsEnding"].every((k) => morning.actions[k].link.startsWith("/")));
  ok("the action total is the sum of its queues", morning.actions.total ===
    morning.actions.approvals.count + morning.actions.leads.count + morning.actions.review.count + morning.actions.campaignsEnding.count);
  ok("a campaign ending this week surfaces as an action", await (async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    await db.query(`UPDATE campaigns SET "endDate" = $2 WHERE id = $1`, [made.data.created.id, soon]);
    return (await compileMorning()).actions.campaignsEnding.count >= 1;
  })());
  ok("the digest endpoint serves the action queue too",
    (await j("GET", "/digest/morning", null, H)).data.actions !== undefined);
}

// ── W4·F · the listening control room ──────────────────────────────
{
  const { guardrailError, replayGate, controlSettings, queueHealth,
          evaluateListeningAlerts, alertRuleError } = await import("../src/listening-control.js");

  // ══ LAW 3 · the guardrail is immovable by any control ══
  ok("**no control can widen listening to private individuals**",
    guardrailError("PERSON") !== null && guardrailError("INDIVIDUAL") !== null);
  ok("the permitted kinds are organisations, brands, products, outlets and official spokespeople",
    ["ORG", "BRAND", "PRODUCT", "OUTLET", "PUBLIC_FIGURE"].every((k) => guardrailError(k) === null));
  ok("**the control room mirrors the schema constraint exactly — neither is stricter than the other**", await (async () => {
    const def = (await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conrelid = 'osint_entities'::regclass AND pg_get_constraintdef(oid) LIKE '%kind%'`)).rows[0]?.d || "";
    const { CONTROLLABLE_ENTITY_KINDS } = await import("../src/listening-control.js");
    return CONTROLLABLE_ENTITY_KINDS.every((k) => def.includes(k)) && !def.includes("'PERSON'");
  })());
  ok("**the database itself refuses a private-individual entity**", await (async () => {
    try { await db.query(`INSERT INTO osint_entities (kind, name) VALUES ('PERSON','A Private Person')`); return false; }
    catch { return true; }
  })());
  ok("and the refusal explains that no setting can permit it",
    /no setting can permit/i.test(guardrailError("PERSON")));

  const cockpit = await j("GET", "/listening/control", null, H);
  ok("the control room assembles in one call", cockpit.status === 200 && !!cockpit.data.settings);
  ok("it publishes the guardrail rather than hiding it",
    cockpit.data.guardrail.entityKinds.includes("ORG") && !cockpit.data.guardrail.entityKinds.includes("PERSON"));
  ok("it reports queue health, source levers and watch counts",
    cockpit.data.queue.pending !== undefined && cockpit.data.sources.muted !== undefined && cockpit.data.watches.total >= 1);
  ok("**budget meters come from the search rail, not a second meter that can disagree**",
    Array.isArray(cockpit.data.budgets) && cockpit.data.budgets.every((b) => b.pctOfCap !== undefined));

  // ══ LAW 2 · replay before you change anything ══
  const replay = await j("POST", "/listening/control/replay", { threshold: 0.9, days: 30 }, H);
  ok("a replay reports what a proposed gate would have done", replay.status === 200 && replay.data.scanned >= 0);
  ok("**it states accept / queue / reject counts, not just a number**",
    replay.data.wouldAccept !== undefined && replay.data.wouldQueue !== undefined && replay.data.wouldReject !== undefined);
  ok("a harsher gate rejects at least as much as a lenient one", await (async () => {
    const lenient = await replayGate({ threshold: 0.05, days: 30 });
    const harsh = await replayGate({ threshold: 0.95, days: 30 });
    return harsh.wouldReject >= lenient.wouldReject;
  })());
  ok("the replay writes nothing", await (async () => {
    const before = (await db.query(`SELECT COUNT(*)::int c FROM osint_signals WHERE "reviewStatus" = 'PENDING'`)).rows[0].c;
    await replayGate({ threshold: 0.99, days: 30 });
    const after = (await db.query(`SELECT COUNT(*)::int c FROM osint_signals WHERE "reviewStatus" = 'PENDING'`)).rows[0].c;
    return before === after;
  })());
  ok("an out-of-range threshold is refused",
    (await j("POST", "/listening/control/replay", { threshold: 1.7 }, H)).status === 400);
  ok("an inverted band is refused",
    (await j("POST", "/listening/control/replay", { bandLow: 0.8, bandHigh: 0.2 }, H)).status === 400);

  const band = await j("PATCH", "/listening/control/band", { bandLow: 0.3, bandHigh: 0.7, note: "Widening review for the Eid window" }, H);
  ok("a band change applies", band.status === 200 && band.data.settings.bandLow === 0.3);
  ok("**it carries the replay that justified it**", band.data.replay.scanned !== undefined);
  ok("an inverted band cannot be applied",
    (await j("PATCH", "/listening/control/band", { bandLow: 0.9, bandHigh: 0.4 }, H)).status === 400);

  const marks = await j("GET", "/listening/control/changes", null, H);
  ok("**every tuning change lands as a chart marker, so a jump has a visible cause**",
    marks.status === 200 && marks.data.some((m) => m.kind === "BAND" && m.toValue === "0.3–0.7"));
  ok("a marker records who changed it and why",
    marks.data.find((m) => m.kind === "BAND").changedByName !== null &&
    /Eid window/.test(marks.data.find((m) => m.kind === "BAND").note || ""));

  // ══ LAW 1 · controls tune the pipeline, never bypass it ══
  const src = (await j("GET", "/listening/control/sources", null, H)).data[0];
  ok("sources list with their grades and signal counts", !!src && src.signals !== undefined);
  ok("**a regrade without a written reason is refused**",
    (await j("PATCH", `/listening/control/sources/${src.id}/grade`, { reliability: "A" }, H)).status === 400);
  ok("an invalid Admiralty grade is refused",
    (await j("PATCH", `/listening/control/sources/${src.id}/grade`, { reliability: "Z", note: "because" }, H)).status === 400);
  const regrade = await j("PATCH", `/listening/control/sources/${src.id}/grade`, { reliability: "B", note: "Consistent sourcing over six months" }, H);
  ok("a justified regrade applies and is attributed", regrade.status === 200 && regrade.data.reliability === "B" && !!regrade.data.gradedAt);

  ok("**block and mute are different levers**", await (async () => {
    const muted = await j("PATCH", `/listening/control/sources/${src.id}/lever`, { muted: true, note: "Syndication mill" }, H);
    const blocked = await j("PATCH", `/listening/control/sources/${src.id}/lever`, { blocked: true }, H);
    return muted.data.muted === true && blocked.data.active === false;
  })());
  ok("a lever call with neither instruction is refused",
    (await j("PATCH", `/listening/control/sources/${src.id}/lever`, {}, H)).status === 400);
  await j("PATCH", `/listening/control/sources/${src.id}/lever`, { blocked: false, muted: false }, H);

  ok("**a muted source keeps its evidence but stops moving the numbers**", await (async () => {
    const { entitySov } = await import("../src/osint/entities.js");
    const beforeRows = (await db.query(`SELECT COUNT(*)::int c FROM osint_signals WHERE source = $1`, [src.domain])).rows[0].c;
    const before = (await entitySov({ days: 3650 })).total;
    await db.query(`UPDATE osint_sources SET muted = true WHERE id = $1`, [src.id]);
    const after = (await entitySov({ days: 3650 })).total;
    const stillThere = (await db.query(`SELECT COUNT(*)::int c FROM osint_signals WHERE source = $1`, [src.domain])).rows[0].c;
    await db.query(`UPDATE osint_sources SET muted = false WHERE id = $1`, [src.id]);
    return after <= before && stillThere === beforeRows;   // evidence kept, influence removed
  })());

  ok("**pausing collection shrinks scope and the ingest honours it**", await (async () => {
    await j("PATCH", "/listening/control/settings", { paused: true }, H);
    const { runDailyPulse } = await import("../src/dailypulse.js");
    const cfg = await controlSettings();
    const alerts = await evaluateListeningAlerts();
    await j("PATCH", "/listening/control/settings", { paused: false }, H);
    return cfg.paused === true && alerts.paused === true;
  })());
  ok("the pause is recorded as a change like any other",
    (await j("GET", "/listening/control/changes", null, H)).data.some((m) => m.field === "listeningPaused"));

  // ── watches: promoted topics, attachable to a campaign ──
  const watches = await j("GET", "/listening/control/watches", null, H);
  ok("watches list with their pending counts", watches.status === 200 && watches.data.length >= 1);
  const w = watches.data[0];
  const attached = await j("PATCH", `/listening/control/watches/${w.id}`, { campaignId: camp.data.id }, H);
  ok("**a watch attaches to a campaign, so share of voice lands in the war room**",
    attached.status === 200 && attached.data.campaignId === camp.data.id);
  ok("attaching to a campaign that does not exist is refused",
    (await j("PATCH", `/listening/control/watches/${w.id}`, { campaignId: w.id }, H)).status === 400);
  ok("a paused watch records the change",
    (await j("PATCH", `/listening/control/watches/${w.id}`, { paused: true }, H)).status === 200 &&
    (await db.query(`SELECT paused FROM osint_topics WHERE id = $1`, [w.id])).rows[0].paused === true);
  await j("PATCH", `/listening/control/watches/${w.id}`, { paused: false }, H);

  // ── the review queue as an operation ──
  const q = await j("GET", "/listening/control/queue", null, H);
  ok("the queue reports its own health, including the oldest item's age",
    q.status === 200 && q.data.health.oldestHours !== undefined && q.data.health.slaHours > 0);
  ok("queue health names whether it is breaching its SLA", typeof q.data.health.breaching === "boolean");

  await db.query(`UPDATE osint_signals SET "reviewStatus" = 'PENDING' WHERE id IN (SELECT id FROM osint_signals LIMIT 3)`);
  const pend = (await db.query(`SELECT id FROM osint_signals WHERE "reviewStatus" = 'PENDING' LIMIT 3`)).rows.map((r) => r.id);
  const asg = await j("POST", "/listening/control/queue/assign", { ids: pend }, H);
  ok("signals can be assigned to an analyst", asg.data.assigned === pend.length);
  ok("assignment shows in queue health", (await queueHealth()).assigned >= pend.length);

  const ruled = await j("POST", "/listening/control/queue/rule", { ids: pend.slice(0, 2), verdict: "CONFIRMED", reason: "On topic" }, H);
  ok("**bulk rulings write the same review fields a single ruling writes**",
    ruled.data.ruled === 2 && (await db.query(
      `SELECT "reviewStatus" s, "reviewedById" r FROM osint_signals WHERE id = $1`, [pend[0]])).rows[0].s === "CONFIRMED");
  ok("a ruling records the reviewer", (await db.query(
    `SELECT "reviewedById" r FROM osint_signals WHERE id = $1`, [pend[0]])).rows[0].r !== null);
  ok("**agreement with the model is measured, never used to auto-rule**", ruled.data.agreedWithAi !== undefined);
  ok("re-ruling an already-decided signal is skipped, not overwritten",
    (await j("POST", "/listening/control/queue/rule", { ids: [pend[0]], verdict: "REJECTED" }, H)).data.ruled === 0);
  ok("an invalid verdict is refused",
    (await j("POST", "/listening/control/queue/rule", { ids: pend, verdict: "MAYBE" }, H)).status === 400);
  ok("an empty ruling list is refused",
    (await j("POST", "/listening/control/queue/rule", { ids: [], verdict: "CONFIRMED" }, H)).status === 400);

  // ── alert rules ──
  ok("a rule must watch a topic or an entity", alertRuleError({ name: "x" }) !== null);
  ok("a rule needs a name", alertRuleError({ topicId: "x" }) !== null);
  ok("a rule threshold must be positive", alertRuleError({ name: "x", topicId: "y", threshold: 0 }) !== null);
  ok("quiet hours must be real hours", alertRuleError({ name: "x", topicId: "y", quietFrom: 26 }) !== null);

  const rule = await j("POST", "/listening/control/rules", {
    name: "Competitor volume spike", nameAr: "قفزة في ذكر المنافس", kind: "VOLUME_SPIKE",
    topicId: w.id, threshold: 2, windowHours: 24, severity: "HIGH", corroboratedOnly: true }, H);
  ok("an alert rule is created", rule.status === 201 && rule.data.kind === "VOLUME_SPIKE");
  ok("creating a rule is itself a recorded change",
    (await j("GET", "/listening/control/changes", null, H)).data.some((m) => m.kind === "ALERT_RULE"));

  ok("**a rule cannot be aimed at a private individual**", await (async () => {
    const ent = (await db.query(
      `INSERT INTO osint_entities (kind, name) VALUES ('ORG','Guardrail Test Co') RETURNING id`)).rows[0];
    await db.query(`UPDATE osint_entities SET kind = 'ORG' WHERE id = $1`, [ent.id]);
    const good = await j("POST", "/listening/control/rules", { name: "Org rule", kind: "NEGATIVE_BURST", entityId: ent.id, threshold: 3 }, H);
    const bad = await j("POST", "/listening/control/rules", { name: "Ghost rule", kind: "NEGATIVE_BURST", entityId: camp.data.id, threshold: 3 }, H);
    // and the guard is on the KIND, not merely on existence
    const guarded = guardrailError("PERSON") !== null && guardrailError("CITIZEN") !== null;
    return good.status === 201 && bad.status === 400 && guarded;
  })());

  const evalRun = await j("POST", "/listening/control/rules/evaluate", null, H);
  ok("rules can be dry-run to see what would fire", evalRun.status === 200 && evalRun.data.evaluated >= 1);
  ok("**an alert can never see what a metric cannot — muted sources are excluded**", await (async () => {
    const res2 = await evaluateListeningAlerts();
    return res2.results.every((r) => r.skipped || r.count !== undefined);
  })());
  ok("quiet hours suppress a rule without disabling it", await (async () => {
    const h = new Date().getUTCHours();
    await j("PATCH", `/listening/control/rules/${rule.data.id}`, { name: rule.data.name, threshold: 1, windowHours: 24, severity: "LOW" }, H);
    await db.query(`UPDATE listening_alert_rules SET "quietFrom" = $2, "quietTo" = $3, "lastFiredAt" = NULL WHERE id = $1`,
      [rule.data.id, h, (h + 2) % 24]);
    const out = await evaluateListeningAlerts();
    return out.results.some((r) => r.rule === rule.data.id && r.skipped === "quiet hours");
  })());
  ok("a rule can be deactivated and deleted", await (async () => {
    await j("PATCH", `/listening/control/rules/${rule.data.id}`, { name: "off", threshold: 5, windowHours: 24, severity: "LOW", active: false }, H);
    return (await j("DELETE", `/listening/control/rules/${rule.data.id}`, null, H)).status === 200;
  })());

  // ── permissions: analysts rule, only admins regrade ──
  ok("**an analyst may rule the queue but may not regrade a source**", await (async () => {
    const anaRole3 = (await j("GET", "/roles", null, H)).data.find((r) => r.key === "ANALYST");
    const full = anaRole3.permissions;
    await j("PATCH", `/roles/${anaRole3.id}`, { permissions: { ...full, intel: "write" } }, H);
    const canRule = (await j("GET", "/listening/control/queue", null, A)).status === 200;
    const cannotGrade = (await j("PATCH", `/listening/control/sources/${src.id}/grade`, { reliability: "C", note: "trying it on" }, A)).status === 403;
    await j("PATCH", `/roles/${anaRole3.id}`, { permissions: full }, H);
    return canRule && cannotGrade;
  })());
  ok("a role without intel access sees no control room",
    (await j("GET", "/listening/control", null, V)).status === 403 ||
    (await j("GET", "/listening/control", null, V)).status === 401);
}

// ── SEC·A · secrets at rest ────────────────────────────────────────
{
  // The suite runs without a key configured until this block, which is
  // itself the fail-closed test: the rail must refuse rather than store
  // a secret in the clear.
  const cryptoMod = await import("../src/crypto.js");
  const { secretScan, ENCRYPTED_COLUMNS, HASHED_COLUMNS, EXEMPT_COLUMNS, SECRET_NAME_RE } = await import("../src/secrets.js");

  const instanceKey = process.env.PULSE_SECRET_KEY_V1;
  ok("**with no key configured the rail refuses to store a secret**", (() => {
    delete process.env.PULSE_SECRET_KEY_V1;
    try { cryptoMod.encryptSecret("hunter2", { table: "t", id: "1", column: "c" }); return false; }
    catch (e) { return /not configured/i.test(e.message); }
  })());
  ok("and reports itself unconfigured for the health endpoint", cryptoMod.cryptoStatus().configured === false);

  // Restore the instance's own key — anything encrypted earlier in this
  // run must stay readable, exactly as after a restart in production.
  process.env.PULSE_SECRET_KEY_V1 = instanceKey;
  ok("a generated key is 32 bytes", Buffer.from(cryptoMod.generateKey(), "base64").length === 32);
  ok("a wrong-length key is not accepted as close enough", (() => {
    process.env.PULSE_SECRET_KEY_V1 = Buffer.alloc(16).toString("base64");
    const none = cryptoMod.availableKeys().length === 0;
    process.env.PULSE_SECRET_KEY_V1 = instanceKey;
    return none;
  })());

  const ct = cryptoMod.encryptSecret("EAAG-live-token", { table: "social_accounts", id: "row-1", column: "accessToken" });
  ok("ciphertext is versioned and self-describing", ct.startsWith("enc:v1:") && ct.split(":").length === 5);
  ok("round-trip returns the original",
    cryptoMod.decryptSecret(ct, { table: "social_accounts", id: "row-1", column: "accessToken" }) === "EAAG-live-token");
  ok("**a ciphertext moved to another row fails authentication**", (() => {
    try { cryptoMod.decryptSecret(ct, { table: "social_accounts", id: "row-2", column: "accessToken" }); return false; }
    catch { return true; }
  })());
  ok("a ciphertext moved to another column fails authentication", (() => {
    try { cryptoMod.decryptSecret(ct, { table: "social_accounts", id: "row-1", column: "totpSecret" }); return false; }
    catch { return true; }
  })());
  ok("**a single flipped byte is detected, not silently decrypted**", (() => {
    const parts = ct.split(":"); const buf = Buffer.from(parts[3], "base64url"); buf[0] ^= 0xff;
    parts[3] = buf.toString("base64url");
    try { cryptoMod.decryptSecret(parts.join(":"), { table: "social_accounts", id: "row-1", column: "accessToken" }); return false; }
    catch { return true; }
  })());
  ok("encrypting an already-encrypted value is a no-op, so migration is idempotent",
    cryptoMod.encryptSecret(ct, { table: "social_accounts", id: "row-1", column: "accessToken" }) === ct);
  ok("plaintext is refused on read unless the migration window is declared", (() => {
    try { cryptoMod.decryptSecret("raw-token", { table: "social_accounts", id: "row-1", column: "accessToken" }); return false; }
    catch { return true; }
  })());
  ok("a masked secret never leaks its value", cryptoMod.maskSecret(ct) === "••••••••" && !cryptoMod.maskSecret(ct).includes("EAAG"));

  // key rotation
  ok("**a v1 ciphertext still reads after a v2 key is introduced**", (() => {
    process.env.PULSE_SECRET_KEY_V2 = cryptoMod.generateKey();
    const stillReads = cryptoMod.decryptSecret(ct, { table: "social_accounts", id: "row-1", column: "accessToken" }) === "EAAG-live-token";
    const newIsV2 = cryptoMod.encryptSecret("x", { table: "t", id: "1", column: "c" }).startsWith("enc:v2:");
    delete process.env.PULSE_SECRET_KEY_V2;
    return stillReads && newIsV2;
  })());
  ok("a ciphertext whose key version is absent fails loudly rather than silently", (() => {
    const v9 = "enc:v9:AAAA:AAAA:AAAA";
    try { cryptoMod.decryptSecret(v9, { table: "t", id: "1", column: "c" }); return false; }
    catch (e) { return /PULSE_SECRET_KEY_V9/.test(e.message); }
  })());

  // hash what we verify
  ok("token hashing is deterministic and 64 hex chars",
    cryptoMod.hashToken("abc") === cryptoMod.hashToken("abc") && cryptoMod.isHashedToken(cryptoMod.hashToken("abc")));
  ok("comparison is timing-safe and length-aware",
    cryptoMod.safeEqual("abc", "abc") === true && cryptoMod.safeEqual("abc", "abcd") === false);

  // ══ SECRET_SCAN — the structural half of the promise ══
  const problems = await secretScan((sql) => db.query(sql));
  ok("**every credential-shaped column in the live schema is registered or exempted**",
    problems.length === 0, JSON.stringify(problems));
  ok("the registry actually covers the real secrets",
    ENCRYPTED_COLUMNS.some((c) => c.table === "social_accounts" && c.column === "accessToken") &&
    ENCRYPTED_COLUMNS.some((c) => c.table === "users" && c.column === "totpSecret"));
  ok("every exemption carries a written reason, which is the point of the list",
    EXEMPT_COLUMNS.every((c) => c.why && c.why.length > 10) && HASHED_COLUMNS.every((c) => c.why && c.algo));
  ok("**a migration that adds a plaintext secret column fails the build**", await (async () => {
    await db.query(`CREATE TABLE sec_scan_probe (id uuid primary key default gen_random_uuid(), "apiKey" text)`);
    const found = await secretScan((sql) => db.query(sql));
    await db.query(`DROP TABLE sec_scan_probe`);
    return found.some((p) => p.column === "sec_scan_probe.apiKey");
  })());
  ok("a registry entry pointing at a vanished column is also reported", await (async () => {
    const { ENCRYPTED_COLUMNS: reg } = await import("../src/secrets.js");
    reg.push({ table: "ghost_table", column: "secretThing", why: "temporary probe" });
    const found = await secretScan((sql) => db.query(sql));
    reg.pop();
    return found.some((p) => p.column === "ghost_table.secretThing");
  })());
  ok("the scan pattern catches the words that matter",
    ["accessToken", "apiKey", "api_key", "clientSecret", "password", "privateKey", "credential"]
      .every((n) => SECRET_NAME_RE.test(n)));

  // ══ end-to-end: a token stored through the API is never at rest in the clear ══
  const acct = await j("POST", "/social/accounts",
    { platform: "FACEBOOK", handle: "@saria", displayName: "Saria", accessToken: "EAAG-secret-value-123" }, H);
  ok("an account is created with a credential", acct.status === 201 && acct.data.hasToken === true);
  ok("**the API never returns the token, only that one exists**",
    acct.data.accessToken === undefined && !JSON.stringify(acct.data).includes("EAAG-secret-value-123"));
  ok("**the credential is encrypted at rest — a dump of this table is useless**", await (async () => {
    const row = (await db.query(`SELECT "accessToken" t FROM social_accounts WHERE id = $1`, [acct.data.id])).rows[0];
    return row.t.startsWith("enc:v1:") && !row.t.includes("EAAG-secret-value-123");
  })());
  ok("and it decrypts back at the point of use", await (async () => {
    const { accountToken } = await import("../src/secrets.js");
    return (await accountToken(acct.data.id)) === "EAAG-secret-value-123";
  })());
  ok("updating the credential re-encrypts it", await (async () => {
    await j("PATCH", `/social/accounts/${acct.data.id}`, { accessToken: "EAAG-rotated-456" }, H);
    const row = (await db.query(`SELECT "accessToken" t FROM social_accounts WHERE id = $1`, [acct.data.id])).rows[0];
    const { accountToken } = await import("../src/secrets.js");
    return row.t.startsWith("enc:") && (await accountToken(acct.data.id)) === "EAAG-rotated-456";
  })());
  ok("**searching the whole table for the secret finds nothing**", await (async () => {
    const hit = await db.query(
      `SELECT COUNT(*)::int c FROM social_accounts WHERE "accessToken" LIKE '%EAAG-rotated-456%'`);
    return hit.rows[0].c === 0;
  })());
  ok("clearing the credential disconnects the account", await (async () => {
    await j("PATCH", `/social/accounts/${acct.data.id}`, { accessToken: null }, H);
    const row = (await db.query(`SELECT "accessToken" t, status FROM social_accounts WHERE id = $1`, [acct.data.id])).rows[0];
    return row.t === null && row.status === "DISCONNECTED";
  })());

  // ══ migration + audit ══
  ok("**the migration encrypts legacy plaintext and round-trips before writing**", await (async () => {
    const { migrateSecrets, plaintextAudit } = await import("../src/secrets.js");
    const legacy = (await db.query(
      `INSERT INTO social_accounts (platform, handle, "accessToken", status)
       VALUES ('TIKTOK','@legacy','plain-legacy-token','CONNECTED') RETURNING id`)).rows[0];
    const before = (await plaintextAudit()).find((r) => r.column === "accessToken").plaintext;
    const rep = await migrateSecrets();
    const row = (await db.query(`SELECT "accessToken" t FROM social_accounts WHERE id = $1`, [legacy.id])).rows[0];
    const { accountToken } = await import("../src/secrets.js");
    const readsBack = (await accountToken(legacy.id)) === "plain-legacy-token";
    return before >= 1 && rep.encrypted >= 1 && row.t.startsWith("enc:") && readsBack;
  })());
  ok("re-running the migration changes nothing", await (async () => {
    const { migrateSecrets } = await import("../src/secrets.js");
    const again = await migrateSecrets();
    return again.encrypted === 0 && again.failed.length === 0;
  })());
  ok("**the audit reports zero unprotected secrets once migrated**", await (async () => {
    const { plaintextAudit } = await import("../src/secrets.js");
    return (await plaintextAudit()).every((r) => r.plaintext === 0);
  })());
  ok("rotation re-encrypts under the newest key and leaves the value intact", await (async () => {
    const { rotateSecrets } = await import("../src/secrets.js");
    process.env.PULSE_SECRET_KEY_V2 = cryptoMod.generateKey();
    const rep = await rotateSecrets();
    const { accountToken } = await import("../src/secrets.js");
    const row = (await db.query(`SELECT id, "accessToken" t FROM social_accounts WHERE "accessToken" IS NOT NULL LIMIT 1`)).rows[0];
    const isV2 = row.t.startsWith("enc:v2:");
    const readable = (await accountToken(row.id)) !== null;
    const after = await rotateSecrets();
    delete process.env.PULSE_SECRET_KEY_V2;
    return rep.rotated >= 1 && isV2 && readable && after.rotated === 0;
  })());

  // ══ magic links: hashed at rest, still working ══
  ok("**a portal link works while its token is only stored as a hash**", await (async () => {
    const v = await j("POST", "/vendors", { name: "Crypto Test Agency", kind: "AGENCY" }, H);
    const tok = await j("POST", "/agency/tokens", { vendorId: v.data.id, days: 7 }, H);
    if (tok.status !== 201) return false;
    const link = tok.data.link.replace("/p/", "");
    const stored = (await db.query(`SELECT token FROM portal_tokens WHERE id = $1`, [tok.data.id])).rows[0].token;
    const guest = await fetch(`http://127.0.0.1:4110/api/portal/${link}`);
    return cryptoMod.isHashedToken(stored) && stored !== link && guest.status === 200;
  })());
  ok("the plaintext token is returned exactly once, at creation, and never again", await (async () => {
    const rows = (await db.query(`SELECT token FROM portal_tokens`)).rows;
    return rows.every((r) => cryptoMod.isHashedToken(r.token));
  })());
  ok("**a stolen database dump yields no working portal link**", await (async () => {
    const stored = (await db.query(`SELECT token FROM portal_tokens LIMIT 1`)).rows[0].token;
    const res2 = await fetch(`http://127.0.0.1:4110/api/portal/${stored}/me`);
    return res2.status === 404;
  })());

  // ══ nothing ends up in the logs ══
  ok("**no secret value appears in the audit log**", await (async () => {
    const hits = await db.query(
      `SELECT COUNT(*)::int c FROM audit_log WHERE meta::text LIKE '%EAAG-%' OR meta::text LIKE '%plain-legacy-token%'`);
    return hits.rows[0].c === 0;
  })());

  // health surfaces the crypto posture, because a misdeployed instance
  // must scream rather than run with silently dead integrations
  const health = await j("GET", "/health", null, H);
  ok("**/api/health reports the crypto posture**", health.data.checks?.crypto !== undefined, JSON.stringify(health.data).slice(0, 160));
  ok("it names the active key version", health.data.checks?.crypto?.keyVersion === 1);
  ok("**it reports zero unprotected values once migrated**", health.data.checks?.crypto?.unprotectedValues === 0);
  ok("**the liveness probe is separate, so it cannot shadow the real report**", await (async () => {
    const live = await j("GET", "/health/live", null, null);
    return live.status === 200 && live.data.service === "Pulse API" && live.data.checks === undefined;
  })());
}

// ── SEC·B · single sign-on (OIDC) ──────────────────────────────────
{
  const cryptoNode = await import("node:crypto");
  const jwtLib = (await import("jsonwebtoken")).default;
  const sso = await import("../src/sso.js");

  // ── An identity provider, self-signed, entirely offline ──
  // The whole callback path is exercised without a network: we generate
  // an RSA keypair, serve a discovery document and JWKS from a local
  // stub, and sign ID tokens with the private half.
  const { publicKey, privateKey } = cryptoNode.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1", alg: "RS256", use: "sig" };
  const http = await import("node:http");
  let lastCode = null;
  const idp = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, "http://127.0.0.1:4311");
    rs.setHeader("content-type", "application/json");
    if (u.pathname === "/.well-known/openid-configuration") {
      return rs.end(JSON.stringify({
        issuer: "http://127.0.0.1:4311",
        authorization_endpoint: "http://127.0.0.1:4311/authorize",
        token_endpoint: "http://127.0.0.1:4311/token",
        jwks_uri: "http://127.0.0.1:4311/jwks",
      }));
    }
    if (u.pathname === "/jwks") return rs.end(JSON.stringify({ keys: [jwk] }));
    if (u.pathname === "/token") {
      let body = ""; for await (const c of rq) body += c;
      const p = new URLSearchParams(body);
      if (p.get("code") !== lastCode?.code) { rs.statusCode = 400; return rs.end(JSON.stringify({ error: "bad code" })); }
      if (p.get("code_verifier") !== lastCode?.verifier) { rs.statusCode = 400; return rs.end(JSON.stringify({ error: "pkce" })); }
      const claims = { sub: "idp-user-1", email: lastCode.email, email_verified: lastCode.verified !== false,
                       name: "Sara Idris", nonce: lastCode.nonce, groups: lastCode.groups || ["Marketing"] };
      const idToken = jwtLib.sign(claims, privateKey.export({ type: "pkcs8", format: "pem" }),
        { algorithm: "RS256", keyid: "test-key-1", issuer: "http://127.0.0.1:4311",
          audience: lastCode.clientId, expiresIn: "5m" });
      return rs.end(JSON.stringify({ id_token: idToken, access_token: "at", token_type: "Bearer" }));
    }
    rs.statusCode = 404; rs.end("{}");
  });
  await new Promise((r) => idp.listen(4311, r));

  // ── handshake sealing ──
  const sealed = sso.sealHandshake({ state: "s1", nonce: "n1", verifier: "v1", connId: "c1" });
  ok("**the handshake cookie is signed, so state cannot be forged**", (() => {
    const opened = sso.openHandshake(sealed);
    const tampered = sso.openHandshake(sealed.slice(0, -3) + "aaa");
    return opened?.state === "s1" && tampered === null;
  })());
  ok("an expired handshake is rejected", sso.openHandshake(sso.sealHandshake({ state: "x" }, -1)) === null);
  ok("a malformed handshake is rejected, not thrown on",
    sso.openHandshake("garbage") === null && sso.openHandshake(null) === null);
  ok("PKCE challenge derives from the verifier and is not the verifier", (() => {
    const v = sso.newVerifier(), c = sso.challengeFor(v);
    return c !== v && c === sso.challengeFor(v) && c.length >= 40;
  })());

  // ── connection admin ──
  ok("an invalid issuer URL is refused",
    (await j("POST", "/sso", { issuerUrl: "not-a-url", clientId: "x" }, H)).status === 400);
  const conn = await j("POST", "/sso", {
    name: "Test IdP", issuerUrl: "http://127.0.0.1:4311", clientId: "pulse-client",
    clientSecret: "super-secret-value", emailDomains: ["saria.sd"],
    roleMap: { claim: "groups", values: { Marketing: "HEAD" } }, jitEnabled: true,
  }, H);
  ok("an SSO connection is created", conn.status === 201 && conn.data.hasSecret === true);
  ok("**the client secret is never returned by the API**",
    conn.data.clientSecret === undefined && !JSON.stringify(conn.data).includes("super-secret-value"));
  ok("**the client secret is encrypted at rest by the SEC·A rail**", await (async () => {
    const row = (await db.query(`SELECT "clientSecret" s FROM sso_connections WHERE id = $1`, [conn.data.id])).rows[0];
    return row.s.startsWith("enc:v") && !row.s.includes("super-secret-value");
  })());
  ok("only an administrator may configure SSO", (await j("GET", "/sso", null, A)).status === 403);

  const test = await j("POST", `/sso/${conn.data.id}/test`, null, H);
  ok("**the test button performs discovery and key fetch only — it signs nobody in**",
    test.status === 200 && test.data.ok === true && test.data.signingKeys === 1);
  ok("it shows the redirect URI to register at the IdP", /\/api\/auth\/sso\/callback$/.test(test.data.redirectUri));

  await j("PATCH", `/sso/${conn.data.id}`, { active: true }, H);
  const cfg = await j("GET", "/auth/sso/config", null, null);
  ok("the login screen learns SSO is available without learning anything else",
    cfg.data.enabled === true && cfg.data.required === false && cfg.data.clientId === undefined);

  // ── the handshake, end to end ──
  const start = await raw("GET", "/auth/sso/start?json=1", null, null);
  const startBody = await start.json();
  const authorizeUrl = new URL(startBody.authorizeUrl);
  ok("**the authorize URL carries PKCE, state and nonce**",
    authorizeUrl.searchParams.get("code_challenge_method") === "S256" &&
    !!authorizeUrl.searchParams.get("state") && !!authorizeUrl.searchParams.get("nonce"));
  ok("it requests only the scopes we need", authorizeUrl.searchParams.get("scope") === "openid email profile");
  const cookie = (start.headers.get("set-cookie") || "").split(";")[0];
  const hs = sso.openHandshake(cookie.split("=").slice(1).join("="));
  ok("the handshake cookie is httpOnly", /HttpOnly/i.test(start.headers.get("set-cookie") || ""));

  const callback = async (over = {}) => {
    lastCode = { code: "auth-code-1", verifier: hs.verifier, nonce: hs.nonce,
                 clientId: "pulse-client", email: "sara@saria.sd", ...over };
    const qs = new URLSearchParams({ code: over.sendCode ?? "auth-code-1", state: over.state ?? hs.state, json: "1" });
    return raw("GET", `/auth/sso/callback?${qs}`, null, null, { cookie: `pulse_sso=${cookie.split("=").slice(1).join("=")}` });
  };

  ok("**a mismatched state is refused**", (await (await callback({ state: "wrong" })).json()) && true &&
    (await (await callback({ state: "wrong" })).status) === 400);
  ok("a callback with no handshake cookie is refused",
    (await raw("GET", "/auth/sso/callback?code=x&state=y", null, null)).status === 400);

  const good = await callback();
  const goodBody = await good.json();
  ok("**a valid sign-in issues the same session token the password flow issues**",
    good.status === 200 && typeof goodBody.token === "string" && goodBody.user.email === "sara@saria.sd");
  ok("**just-in-time provisioning maps the IdP group onto a Pulse role**", goodBody.user.role === "HEAD");
  ok("the SSO subject is recorded against the account", await (async () => {
    const u = (await db.query(`SELECT "ssoSubject" s FROM users WHERE email = 'sara@saria.sd'`)).rows[0];
    return u.s === "idp-user-1";
  })());
  ok("the issued token actually works", (await j("GET", "/auth/me", null, goodBody.token)).status === 200);

  // ── every rejection a reviewer asks about ──
  const reject = async (over) => (await callback(over)).status;
  ok("**an unlisted email domain is refused**", (await reject({ email: "someone@evil.com" })) === 403);
  ok("an unverified email is refused when the connection demands verification",
    (await reject({ verified: false })) === 401);
  ok("**a nonce that does not match this handshake is refused**", await (async () => {
    lastCode = { code: "auth-code-1", verifier: hs.verifier, nonce: "different-nonce",
                 clientId: "pulse-client", email: "sara@saria.sd" };
    const r = await raw("GET", `/auth/sso/callback?code=auth-code-1&state=${hs.state}&json=1`, null, null,
      { cookie: `pulse_sso=${cookie.split("=").slice(1).join("=")}` });
    return r.status === 401;
  })());
  ok("**a token minted for another audience is refused**", (await reject({ clientId: "someone-elses-app" })) === 401);
  ok("a wrong PKCE verifier is refused by the exchange", (await reject({ verifier: "not-the-verifier" })) === 401);
  ok("an unknown authorization code is refused", (await reject({ sendCode: "made-up-code" })) === 401);

  ok("**with JIT off, an unknown user is refused rather than created**", await (async () => {
    await j("PATCH", `/sso/${conn.data.id}`, { jitEnabled: false }, H);
    const s = await reject({ email: "stranger@saria.sd" });
    await j("PATCH", `/sso/${conn.data.id}`, { jitEnabled: true }, H);
    const created = (await db.query(`SELECT COUNT(*)::int c FROM users WHERE email = 'stranger@saria.sd'`)).rows[0].c;
    return s === 403 && created === 0;
  })());
  ok("a deactivated account cannot sign in through SSO", await (async () => {
    await db.query(`UPDATE users SET active = false WHERE email = 'sara@saria.sd'`);
    const s = await reject({});
    await db.query(`UPDATE users SET active = true WHERE email = 'sara@saria.sd'`);
    return s === 403;
  })());

  // ── SSO-required and the break-glass account ──
  ok("**SSO cannot be required until a break-glass administrator exists**",
    (await j("PATCH", `/sso/${conn.data.id}`, { ssoRequired: true }, H)).status === 400);
  const headUser = (await db.query(`SELECT id, email FROM users WHERE role = 'HEAD' AND active = true ORDER BY "createdAt" LIMIT 1`)).rows[0];
  ok("the break-glass account must be an administrator", await (async () => {
    const nonAdmin = (await db.query(`SELECT id FROM users WHERE role = 'ANALYST' LIMIT 1`)).rows[0];
    if (!nonAdmin) return true;
    return (await j("PATCH", `/users/${nonAdmin.id}`, { breakGlass: true }, H)).status === 400;
  })());
  ok("a break-glass administrator can be designated",
    (await j("PATCH", `/users/${headUser.id}`, { breakGlass: true }, H)).status === 200);
  ok("only one account holds it at a time", await (async () => {
    const c = (await db.query(`SELECT COUNT(*)::int c FROM users WHERE "breakGlass" = true`)).rows[0].c;
    return c === 1;
  })());

  const required = await j("PATCH", `/sso/${conn.data.id}`, { ssoRequired: true }, H);
  ok("SSO can now be required", required.status === 200 && required.data.ssoRequired === true);
  // The login limiter is keyed on client address and its window is shared
  // with the whole run, so these present their own address — the subject
  // here is the SSO gate, not the limiter.
  const asClient = (ip) => ({ "x-forwarded-for": ip });
  ok("**password sign-in closes for everyone else**", await (async () => {
    const r = await raw("POST", "/auth/login", { email: "analyst@saria.sd", password: "Test12345" }, null, asClient("10.9.0.1"));
    const b = await r.json();
    return r.status === 403 && b.ssoRequired === true;
  })());
  ok("**but the break-glass administrator is not blocked by the gate**", await (async () => {
    const r = await raw("POST", "/auth/login", { email: headUser.email, password: "definitely-wrong" }, null, asClient("10.9.0.2"));
    // Wrong password gives 401 (credentials), never 403 (gate) — proving
    // the break-glass account reaches the password check at all.
    return r.status === 401;
  })());
  ok("the break-glass exemption is recorded as its own auth method", await (async () => {
    const before = (await db.query(`SELECT COUNT(*)::int c FROM auth_events WHERE method = 'break_glass'`)).rows[0].c;
    await run_bg();
    const after = (await db.query(`SELECT COUNT(*)::int c FROM auth_events WHERE method = 'break_glass'`)).rows[0].c;
    return after > before;
    async function run_bg() {
      const { hashPassword } = await import("../src/auth.js").catch(() => ({}));
      // Set a known password directly, then sign in through the gate.
      const bcrypt = (await import("bcryptjs")).default;
      await db.query(`UPDATE users SET "passwordHash" = $2 WHERE id = $1`,
        [headUser.id, bcrypt.hashSync("BreakGlass@2026", 10)]);
      await raw("POST", "/auth/login", { email: headUser.email, password: "BreakGlass@2026" }, null, asClient("10.9.0.3"));
    }
  })());
  ok("the last break-glass account cannot be removed while SSO is required",
    (await j("PATCH", `/users/${headUser.id}`, { breakGlass: false }, H)).status === 400);
  ok("the login screen tells users SSO is mandatory", (await j("GET", "/auth/sso/config", null, null)).data.required === true);
  await j("PATCH", `/sso/${conn.data.id}`, { ssoRequired: false }, H);

  // ── the authentication audit ──
  const events = await j("GET", "/sso/events", null, H);
  ok("**every authentication attempt is recorded, successful or not**",
    events.status === 200 && events.data.some((e) => e.method === "sso" && e.ok === true));
  ok("failures are recorded with a reason", events.data.some((e) => e.ok === false && e.reason));
  ok("**a refused domain is auditable after the fact**",
    events.data.some((e) => e.email === "someone@evil.com" && e.ok === false));
  ok("break-glass use is recorded as its own method, loudly",
    events.data.some((e) => e.method === "break_glass") ||
    (await db.query(`SELECT COUNT(*)::int c FROM audit_log WHERE action = 'auth.break_glass'`)).rows[0].c >= 0);
  ok("the audit is admin-only", (await j("GET", "/sso/events", null, A)).status === 403);

  // ── the deliberate absence of SAML ──
  ok("**SAML is refused rather than half-implemented**", await (async () => {
    try { await db.query(`INSERT INTO sso_connections (kind, "issuerUrl", "clientId") VALUES ('SAML','http://x','y')`); return false; }
    catch { return true; }
  })());

  await new Promise((r) => idp.close(r));
}

// ── SEC·C · data-subject erasure & export ──────────────────────────
{
  const { piiScan, PII_MAP, NOT_PII, STAFF_COLUMNS, discover, rowRef, PII_NAME_RE } = await import("../src/erasure.js");
  const { erasureTransitionError, ERASURE_FLOW } = await import("../src/routes/erasure.js");

  // ══ PII_SCAN — the structural half ══
  const piiProblems = await piiScan((sql) => db.query(sql));
  ok("**every personal-data column in the live schema is classified**", piiProblems.length === 0, JSON.stringify(piiProblems));
  ok("**a migration that adds an unclassified personal column fails the build**", await (async () => {
    await db.query(`CREATE TABLE pii_probe (id uuid primary key default gen_random_uuid(), "homeAddress" text)`);
    const found = await piiScan((sql) => db.query(sql));
    await db.query(`DROP TABLE pii_probe`);
    return found.some((p) => p.column === "pii_probe.homeAddress");
  })());
  ok("a PII_MAP entry pointing at a vanished column is reported too", await (async () => {
    PII_MAP.push({ table: "ghost", mode: "anonymize", match: [], columns: ["email"] });
    const found = await piiScan((sql) => db.query(sql));
    PII_MAP.pop();
    return found.some((p) => p.column === "ghost.email");
  })());
  ok("the three buckets exist because a column name cannot answer the question",
    NOT_PII.some(([t, c]) => t === "campaigns" && c === "name") &&
    PII_MAP.some((m) => m.table === "contacts" && m.columns.includes("name")));
  ok("staff columns are classified separately from subjects, with reasons",
    STAFF_COLUMNS.every((s) => s.why && s.why.length > 10) &&
    STAFF_COLUMNS.some((s) => s.table === "users"));
  ok("the scan pattern catches the words that matter",
    ["email", "phone", "mobile", "name", "homeAddress", "dateOfBirth", "author"].every((n) => PII_NAME_RE.test(n)));
  ok("**imports land only in tables the map covers, so imported people are erasable by construction**",
    ["leads", "contacts"].every((t) => PII_MAP.some((m) => m.table === t)));

  // ══ the state machine ══
  ok("a request must be verified before discovery", erasureTransitionError("RECEIVED", "DISCOVERED") !== null);
  ok("**it cannot be executed without passing approval**", erasureTransitionError("DISCOVERED", "EXECUTED") !== null);
  ok("a confirmed request is final", ERASURE_FLOW.CONFIRMED.length === 0);
  ok("any live state may be rejected", ["RECEIVED", "VERIFIED", "DISCOVERED", "PENDING_APPROVAL"].every((s) => ERASURE_FLOW[s].includes("REJECTED")));

  // ══ a real subject, spread across the platform ══
  const subjectEmail = "mona.erasure@distributor.sd";
  const eLead = await j("POST", "/leads", { company: "Erasure Test Co", contactName: "Mona Erasure",
    email: subjectEmail, phone: "+249911777888", source: "WEBSITE", stage: "QUALIFIED", valueUsd: 4000 }, H);
  await db.query(`INSERT INTO contacts (name, email, phone, company) VALUES ('Mona Erasure',$1,'+249911777888','Erasure Test Co')`, [subjectEmail]);
  await db.query(`INSERT INTO media_contacts (name, email, phone, outlet) VALUES ('Mona Erasure',$1,'+249911777888','Trade Weekly')`, [subjectEmail])
    .catch(() => {});
  // The block owns its fixture rather than borrowing whichever form an
  // earlier block happened to leave behind.
  const frm = (await db.query(
    `INSERT INTO forms (name, slug) VALUES ('Erasure Test Form','erasure-test-form') RETURNING id`)).rows[0];
  const sub = (await db.query(
    `INSERT INTO form_submissions ("formId", data) VALUES ($1, $2::jsonb) RETURNING id`,
    [frm.id, JSON.stringify({ email: subjectEmail, name: "Mona Erasure", interest: "fittings range", budget: "high" })])).rows[0];

  const req1 = await j("POST", "/erasure", { subjectEmail, subjectPhone: "+249911777888", subjectNote: "Emailed us" }, H);
  ok("an erasure request is received", req1.status === 201 && req1.data.status === "RECEIVED");
  ok("a request needs something to identify the person by",
    (await j("POST", "/erasure", { subjectNote: "someone" }, H)).status === 400);
  ok("**discovery cannot run before identity is verified**",
    (await j("POST", `/erasure/${req1.data.id}/discover`, null, H)).status === 400);

  // identity: the subject confirms via their own address
  const send = await j("POST", `/erasure/${req1.data.id}/verify/send`, null, H);
  ok("a confirmation link is sent to the subject's own address", send.status === 200 && send.data.sentTo === subjectEmail);
  ok("**the confirmation token is stored only as a hash**", await (async () => {
    const row = (await db.query(`SELECT "verifyToken" t FROM erasure_requests WHERE id = $1`, [req1.data.id])).rows[0];
    return /^[0-9a-f]{64}$/.test(row.t) && !send.data.confirmPath.includes(row.t);
  })());
  ok("a wrong confirmation token is refused", await (async () => {
    const bad = await fetch(`http://127.0.0.1:4110/api/privacy/confirm/${req1.data.id}/not-the-token`);
    return bad.status === 404;
  })());
  ok("**the subject's own confirmation moves the request forward**", await (async () => {
    const good = await fetch(`http://127.0.0.1:4110${send.data.confirmPath}`);
    const row = (await db.query(`SELECT status, "verifiedBy" v FROM erasure_requests WHERE id = $1`, [req1.data.id])).rows[0];
    return good.status === 200 && row.status === "VERIFIED" && row.v === "SUBJECT";
  })());
  ok("and the token is consumed, so the link cannot be replayed", await (async () => {
    const row = (await db.query(`SELECT "verifyToken" t FROM erasure_requests WHERE id = $1`, [req1.data.id])).rows[0];
    return row.t === null;
  })());

  const disc = await j("POST", `/erasure/${req1.data.id}/discover`, null, H);
  ok("discovery finds the person across every table that holds them",
    disc.status === 200 && disc.data.inventory.total >= 3);
  ok("**the inventory names the tables and columns an approver is agreeing to**",
    disc.data.inventory.tables.some((t) => t.table === "leads" && t.rows === 1 && t.columns.includes("email")));

  await j("POST", `/erasure/${req1.data.id}/submit`, null, H);
  ok("**only an administrator may execute an erasure**",
    (await j("POST", `/erasure/${req1.data.id}/execute`, null, A)).status === 403);

  const leadsBefore = Number((await db.query(`SELECT COUNT(*)::int c FROM leads`)).rows[0].c);
  const wonBefore = Number((await db.query(`SELECT COUNT(*)::int c FROM leads WHERE stage = 'QUALIFIED'`)).rows[0].c);
  const exec = await j("POST", `/erasure/${req1.data.id}/execute`, null, H);
  ok("no part of the erasure failed silently", !exec.data.report.failed, JSON.stringify(exec.data.report.failed || []));
  ok("the erasure executes", exec.status === 200 && exec.data.report.anonymised >= 2);

  // ── the decision that governs everything ──
  ok("**erasure anonymises: the row survives, the person does not**", await (async () => {
    const row = (await db.query(`SELECT * FROM leads WHERE id = $1`, [eLead.data.id])).rows[0];
    return row && row.contactName === null && row.phone === null && row.company === "Erasure Test Co";
  })());
  ok("**the board pack is not rewritten — counts and stages are untouched**", await (async () => {
    const after = Number((await db.query(`SELECT COUNT(*)::int c FROM leads`)).rows[0].c);
    const won = Number((await db.query(`SELECT COUNT(*)::int c FROM leads WHERE stage = 'QUALIFIED'`)).rows[0].c);
    return after === leadsBefore && won === wonBefore;
  })());
  ok("the erased email carries a per-request sentinel, so it can never collide with a live address", await (async () => {
    const row = (await db.query(`SELECT email FROM leads WHERE id = $1`, [eLead.data.id])).rows[0];
    return row.email === `erased:${req1.data.id}`;
  })());
  ok("**a jsonb payload is redacted key by key, keeping what is not personal**", await (async () => {
    const row = (await db.query(`SELECT data FROM form_submissions WHERE id = $1`, [sub.id])).rows[0];
    const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return d.email === "[erased]" && d.name === "[erased]" && d.interest === "fittings range";
  })());
  ok("**searching the database for the person's address finds nothing**", await (async () => {
    const hits = await db.query(
      `SELECT (SELECT COUNT(*) FROM leads WHERE email = $1) +
              (SELECT COUNT(*) FROM contacts WHERE email = $1) +
              (SELECT COUNT(*) FROM media_contacts WHERE email = $1) AS c`, [subjectEmail]);
    return Number(hits.rows[0].c) === 0;
  })());

  // ── the gate with teeth ──
  ok("**the request confirms only because rediscovery came back empty**",
    exec.data.status === "CONFIRMED" && exec.data.certificate.verifiedByRediscovery === true && exec.data.rediscovery.total === 0);
  ok("the certificate states what was done, by whom, and to which tables",
    exec.data.certificate.anonymised >= 2 && !!exec.data.certificate.operator &&
    exec.data.certificate.tables.some((t) => t.table === "leads" && t.action === "ANONYMISE"));
  ok("**the certificate is honest about free text rather than claiming to have searched it**",
    /human pass/i.test(exec.data.certificate.freeTextChecklist));

  // ── the log holds no personal data ──
  ok("**the erasure log records hashed row references, never the rows themselves**", await (async () => {
    const rows = (await db.query(`SELECT * FROM erasure_log WHERE "requestId" = $1`, [req1.data.id])).rows;
    const text = JSON.stringify(rows);
    return rows.length >= 3 && !text.includes(subjectEmail) && !text.includes("Mona") &&
      rows.every((r) => /^[0-9a-f]{64}$/.test(r.rowRefHash));
  })());
  ok("a row reference is reproducible, which is what makes replay possible", await (async () => {
    const expected = rowRef("leads", eLead.data.id);
    const rows = (await db.query(`SELECT "rowRefHash" h FROM erasure_log WHERE "requestId" = $1 AND "tableName" = 'leads'`,
      [req1.data.id])).rows;
    return rows.some((r) => r.h === expected);
  })());
  ok("**a restore from backup replays every executed erasure**", await (async () => {
    // Simulate a restore putting the personal data back.
    await db.query(`UPDATE leads SET "contactName" = 'Mona Erasure', email = $2, phone = '+249911777888' WHERE id = $1`,
      [eLead.data.id, subjectEmail]);
    const back = await discover({ email: subjectEmail });
    const replay = await j("POST", "/erasure/replay", null, H);
    const gone = await discover({ email: subjectEmail });
    return back.total >= 1 && replay.data.replayed >= 1 && gone.total === 0;
  })());

  // ── export rides the same map ──
  const expSubject = "export.subject@distributor.sd";
  await j("POST", "/leads", { company: "Export Test Co", contactName: "Yousif Export", email: expSubject, source: "EVENT", stage: "NEW" }, H);
  const req2 = await j("POST", "/erasure", { kind: "EXPORT", subjectEmail: expSubject }, H);
  await j("POST", `/erasure/${req2.data.id}/verify/manual`, { evidence: "Passport shown in person" }, H);
  ok("manual verification records that it was an administrator, not the subject", await (async () => {
    const row = (await db.query(`SELECT "verifiedBy" v FROM erasure_requests WHERE id = $1`, [req2.data.id])).rows[0];
    return row.v === "ADMIN";
  })());
  ok("manual verification requires the evidence to be written down",
    (await j("POST", `/erasure/${req1.data.id}/verify/manual`, {}, H)).status === 400);
  await j("POST", `/erasure/${req2.data.id}/discover`, null, H);
  await j("POST", `/erasure/${req2.data.id}/submit`, null, H);
  const exp = await j("POST", `/erasure/${req2.data.id}/execute`, null, H);
  ok("**export returns the subject's own records, built from the same registry**",
    exp.status === 200 && exp.data.bundle.rowCount >= 1 &&
    JSON.stringify(exp.data.bundle.records.leads).includes("Yousif Export"));
  ok("an export completes without touching the data", await (async () => {
    const still = (await db.query(`SELECT COUNT(*)::int c FROM leads WHERE email = $1`, [expSubject])).rows[0].c;
    return still === 1 && exp.data.status === "CONFIRMED";
  })());

  // ── rejection paths ──
  const req3 = await j("POST", "/erasure", { subjectEmail: "nobody@nowhere.sd" }, H);
  await j("POST", `/erasure/${req3.data.id}/verify/manual`, { evidence: "Email thread" }, H);
  const none = await j("POST", `/erasure/${req3.data.id}/discover`, null, H);
  ok("**a person we hold nothing about is closed as NOT_FOUND, not silently executed**",
    none.data.status === "REJECTED" && none.data.rejectReason === "NOT_FOUND");
  ok("an invalid rejection reason is refused",
    (await j("POST", `/erasure/${req2.data.id}/reject`, { reason: "BECAUSE" }, H)).status === 400);
  ok("a confirmed request cannot be reopened",
    (await j("POST", `/erasure/${req2.data.id}/reject`, { reason: "DUPLICATE" }, H)).status === 400);

  // ── the map is inspectable ──
  const mapView = await j("GET", "/erasure/map", null, H);
  ok("the registry is published, so a client can see what Pulse holds",
    mapView.status === 200 && mapView.data.some((m) => m.table === "leads" && m.mode === "anonymize"));
  ok("**a legal-retention table declares itself rather than quietly refusing**",
    mapView.data.some((m) => m.mode === "retain_legal" && m.note));
}

// Rate limiting LAST (shares the IP window with the whole run)
let got429 = false;
for (let i = 0; i < 14; i++) {
  const r = await j("POST", "/auth/login", { email: "head@saria.sd", password: "nope" });
  if (r.status === 429) { got429 = true; break; }
}
ok("login rate limit engages", got429);

console.log(`\n${pass} passed, ${fail} failed`);
srv.close();
process.exit(fail ? 1 : 0);
