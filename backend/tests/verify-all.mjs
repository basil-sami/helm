// HELM regression suite — runs on an in-memory Postgres (PGlite), no external DB.
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

/* ══ B. Full API regression on PGlite ═════════════════════════════════ */
const db = new PGlite();
const sql = fs.readFileSync(path.join(HERE, "../../supabase/setup.sql"), "utf8")
  .replace(/create extension if not exists pgcrypto;/g, "");
await db.exec(sql);
globalThis.__HELM_DB_CLIENT__ = db;

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

// Auth + roles
const head = await j("POST", "/auth/login", { email: "head@saria.sd", password: "Helm@2026" });
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

const cb = await j("POST", "/auth/login", { email: "content@saria.sd", password: "Helm@2026" });
const C = cb.data.token;
ok("builtin continuity: content@ campaigns 201, osint 403",
  (await j("POST", "/campaigns", { name: "by content" }, C)).status === 201 &&
  (await j("POST", "/osint/topics", { label: "x", query: "x" }, C)).status === 403);

// CRUD lifecycle per module (as head)
const camp = await j("POST", "/campaigns", { name: "Regression Campaign", status: "PLANNING", channel: "PAID" }, H);
ok("campaigns: create", camp.status === 201 && !!camp.data?.id, JSON.stringify(camp.data));
const campId = camp.data?.id;
if (!campId) { console.log("ABORT: campaign create failed"); srv.close(); process.exit(1); }
ok("campaigns: patch", (await j("PATCH", `/campaigns/${campId}`, { status: "PAUSED" }, H)).data?.status === "PAUSED");
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
  cron.status === 200 && cron.data.ok === true && cron.data.inserted === 0 && cron.data.errors.length >= 3 &&
  typeof cron.data.alertsPushed === "number" && typeof cron.data.sweepPushed === "number");
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
ok("templates: 4 built-ins seeded", tps.data.filter((t) => t.builtin).length === 4);
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
  (await j("GET", "/products", null, H)).data.length === bk2.data.tables.products.length);

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
