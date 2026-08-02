import { Router } from "express";
import crypto from "crypto";
import { all, get, run } from "./db.js";
import { requireAuth, requirePerm } from "./auth.js";
import { logAudit } from "./audit.js";

// ═══ pulse.js (Wave 1·G) — "own your pixel" ══════════════════════════
// A first-party analytics snippet any client drops on their website;
// traffic flows into their own Pulse instance, not a third party's.

// ── Sites registry ───────────────────────────────────────────────────
export const sitesRouter = Router();
sitesRouter.use(requireAuth);

sitesRouter.get("/", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.*,
         (SELECT COUNT(*)::int FROM web_events e WHERE e."siteKey" = s."snippetKey"
            AND e.at >= now() - interval '7 days') AS "events7d"
       FROM sites s ORDER BY s."createdAt" DESC`));
  } catch (e) { next(e); }
});

sitesRouter.post("/", requirePerm("intel"), async (req, res, next) => {
  try {
    const { name, domain } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const key = "ps_" + crypto.randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const row = await get(
      `INSERT INTO sites (name, domain, "snippetKey") VALUES ($1,$2,$3) RETURNING *`,
      [name, domain || null, key]);
    logAudit(req, "sites.create", "sites", row.id, { key });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

sitesRouter.patch("/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const s = await get(`SELECT * FROM sites WHERE id = $1`, [req.params.id]);
    if (!s) return res.status(404).json({ error: "Not found" });
    for (const f of ["name", "domain", "active"]) if (req.body[f] !== undefined) {
      await run(`UPDATE sites SET "${f}" = $2 WHERE id = $1`, [s.id, req.body[f]]);
    }
    res.json(await get(`SELECT * FROM sites WHERE id = $1`, [s.id]));
  } catch (e) { next(e); }
});

// Traffic overview for one site: daily series + top pages + sources.
sitesRouter.get("/:id/stats", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const s = await get(`SELECT * FROM sites WHERE id = $1`, [req.params.id]);
    if (!s) return res.status(404).json({ error: "Not found" });
    const K = [s.snippetKey];
    const days = await all(
      `SELECT at::date AS d, COUNT(*)::int AS views, COUNT(DISTINCT "visitorHash")::int AS visitors
       FROM web_events WHERE "siteKey" = $1 AND kind = 'PAGEVIEW' AND at >= now() - interval '14 days'
       GROUP BY at::date ORDER BY d ASC`, K);
    const pages = await all(
      `SELECT path, COUNT(*)::int AS views FROM web_events
       WHERE "siteKey" = $1 AND kind = 'PAGEVIEW' AND at >= now() - interval '30 days'
       GROUP BY path ORDER BY views DESC LIMIT 10`, K);
    const sources = await all(
      `SELECT COALESCE(NULLIF(src, ''), NULLIF(utm->>'utm_source', ''), NULLIF(ref, ''), 'direct') AS source,
              COUNT(*)::int AS views
       FROM web_events WHERE "siteKey" = $1 AND at >= now() - interval '30 days'
       GROUP BY 1 ORDER BY views DESC LIMIT 10`, K);
    res.json({ site: s, days, pages, sources });
  } catch (e) { next(e); }
});

// ── The public side: snippet + collect ───────────────────────────────
// Tiny in-memory rate limit: 120 events/min per IP — enough for humans,
// hostile to floods. Resets every minute.
const bucket = new Map();
setInterval(() => bucket.clear(), 60_000).unref?.();
function allow(ip) {
  const n = (bucket.get(ip) || 0) + 1;
  bucket.set(ip, n);
  return n <= 120;
}

// Site-key cache (60s) so collect stays one cheap lookup.
let keyCache = { at: 0, keys: new Set() };
async function activeKeys() {
  if (Date.now() - keyCache.at > 60_000) {
    const rows = await all(`SELECT "snippetKey" FROM sites WHERE active = true`);
    keyCache = { at: Date.now(), keys: new Set(rows.map((r) => r.snippetKey)) };
  }
  return keyCache.keys;
}
export const bustSiteKeyCache = () => { keyCache.at = 0; };

const SNIPPET = `(function(){
var s=document.currentScript,k=s&&s.getAttribute("data-key");if(!k)return;
var api=(s.getAttribute("data-api")||s.src.replace(/\\/(api\\/public\\/)?pulse\\.js.*$/,""))+"/api/public/collect";
var id;try{id=localStorage.getItem("_pulse_id");if(!id){id=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem("_pulse_id",id)}}catch(e){id="anon"}
var q={};location.search.replace(/[?&]([^=&]+)=([^&]*)/g,function(_,a,b){q[decodeURIComponent(a)]=decodeURIComponent(b)});
var utm={};["utm_source","utm_medium","utm_campaign","utm_content","utm_term"].forEach(function(u){if(q[u])utm[u]=q[u]});
function send(kind,path){var p=JSON.stringify({key:k,kind:kind,path:path||location.pathname,ref:document.referrer||null,utm:utm,src:q.src||null,visitor:id});
if(navigator.sendBeacon){navigator.sendBeacon(api,new Blob([p],{type:"application/json"}))}else{fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:p,keepalive:true}).catch(function(){})}}
send("PAGEVIEW");window.pulse=function(name){send("EVENT",String(name||"event"))};
})();`;

export const pulseJsRouter = Router();
pulseJsRouter.get("/", (_req, res) => {
  res.set("Content-Type", "application/javascript; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(SNIPPET);
});

export const collectRouter = Router();
collectRouter.post("/", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "?";
    if (!allow(ip)) return res.status(429).end();
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { key, kind, path, ref, utm, src, visitor } = body || {};
    if (!key || !(await activeKeys()).has(key)) return res.status(204).end(); // silent drop
    await run(
      `INSERT INTO web_events ("siteKey", kind, path, ref, utm, src, "visitorHash")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [key, kind === "EVENT" ? "EVENT" : "PAGEVIEW", String(path || "/").slice(0, 300),
       ref ? String(ref).slice(0, 300) : null, JSON.stringify(utm && typeof utm === "object" ? utm : {}),
       src ? String(src).slice(0, 80) : null, visitor ? String(visitor).slice(0, 64) : null]);
    res.status(204).end();
  } catch { res.status(204).end(); } // analytics never breaks a client page
});
