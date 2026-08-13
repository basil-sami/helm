import { Router } from "express";
import { get } from "../db.js";
import { rateLimit } from "../security.js";
import { notify, usersWithModuleWrite } from "../notify.js";
import { logActivity } from "../leadlog.js";
import { run } from "../db.js";

// PUBLIC capture layer — no auth by design. Defenses: strict field allowlist,
// honeypot, per-IP rate limit, 1 MB global body cap, length caps.
export const captureRouter = Router();

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const T = {
  ar: { title: "تواصل معنا", sub: "اترك بياناتك وسيتواصل معك فريق التسويق", company: "اسم الشركة / الجهة *", name: "الاسم", phone: "رقم الهاتف *", email: "البريد الإلكتروني", notes: "كيف نساعدك؟", send: "إرسال", ok: "شكراً لك! تم استلام طلبك وسنتواصل معك قريباً.", err: "تعذّر الإرسال — حاول مرة أخرى", req: "يرجى تعبئة الحقول المطلوبة", ev: "التسجيل في" },
  en: { title: "Get in touch", sub: "Leave your details and our marketing team will contact you", company: "Company / organization *", name: "Your name", phone: "Phone number *", email: "Email", notes: "How can we help?", send: "Send", ok: "Thank you! We received your request and will contact you soon.", err: "Could not send — please try again", req: "Please fill the required fields", ev: "Registering for" },
};

captureRouter.get("/form", async (req, res) => {
  const lang = req.query.lang === "en" ? "en" : "ar";
  const t = T[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  let event = null;
  if (typeof req.query.event === "string" && UUID_RE.test(req.query.event)) {
    try { event = await get(`SELECT id, name, "nameAr" FROM events WHERE id = $1`, [req.query.event]); } catch { /* ignore */ }
  }
  const evName = event ? (lang === "ar" && event.nameAr ? event.nameAr : event.name) : null;
  const srcCode = typeof req.query.src === "string" && /^[a-z0-9-]{3,30}$/.test(req.query.src) ? req.query.src : null;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="${lang}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(t.title)} — حلم</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box;margin:0}
body{font-family:"IBM Plex Sans Arabic","IBM Plex Sans",system-ui,sans-serif;background:#F7F5F0;color:#161B22;
 min-height:100dvh;display:grid;place-items:center;padding:20px;
 background-image:radial-gradient(640px 320px at 12% -4%,rgba(232,163,61,.08),transparent 62%),
 linear-gradient(rgba(20,18,12,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(20,18,12,.05) 1px,transparent 1px);
 background-size:100% 100%,28px 28px,28px 28px}
.card{width:100%;max-width:430px;background:#fff;border:1px solid #E2DED2;border-radius:16px;box-shadow:0 18px 50px -20px rgba(14,17,23,.25);overflow:hidden}
.head{background:linear-gradient(180deg,#090C12,#111726);color:#F7F5F0;padding:20px 22px;display:flex;gap:12px;align-items:center}
.mark{width:40px;height:40px;border-radius:10px;background:#E8A33D;color:#0E1117;display:grid;place-items:center;font-size:22px;font-weight:700}
.head b{font-size:17px;display:block}.head span{font-size:12px;opacity:.65}
form{padding:20px 22px;display:grid;gap:12px}
label{font-size:12px;color:#5C6878;display:grid;gap:5px}
input,textarea{width:100%;border:1px solid #E2DED2;border-radius:10px;padding:10px 12px;font:inherit;background:#FBF9F5}
input:focus,textarea:focus{outline:2px solid #E8A33D;outline-offset:1px;border-color:#E8A33D;background:#fff}
button{background:#E8A33D;color:#0E1117;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6}
.ev{background:#FCF3E1;color:#A5681B;border:1px solid rgba(232,163,61,.35);border-radius:10px;padding:8px 12px;font-size:13px}
.msg{padding:26px 22px;text-align:center;font-size:15px;line-height:1.7}
.err{color:#C2603E;font-size:13px;display:none}
.hp{position:absolute;opacity:0;height:0;overflow:hidden}
</style></head><body>
<div class="card"><div class="head"><div class="mark">ح</div><div><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div></div>
<form id="f" autocomplete="on">
${evName ? `<div class="ev">${esc(t.ev)}: <b>${esc(evName)}</b></div>` : ""}
<label>${esc(t.company)}<input name="company" maxlength="200" required></label>
<label>${esc(t.name)}<input name="contactName" maxlength="120"></label>
<label>${esc(t.phone)}<input name="phone" maxlength="40" inputmode="tel" required></label>
<label>${esc(t.email)}<input name="email" type="email" maxlength="160"></label>
<label>${esc(t.notes)}<textarea name="notes" maxlength="1000" rows="3"></textarea></label>
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="err" id="e">${esc(t.err)}</div>
<button id="b">${esc(t.send)}</button>
</form></div>
<script>
const f=document.getElementById("f"),b=document.getElementById("b"),e=document.getElementById("e");
f.addEventListener("submit",async(ev)=>{ev.preventDefault();e.style.display="none";b.disabled=true;
const d=Object.fromEntries(new FormData(f));${event ? `d.eventId=${JSON.stringify(event.id)};` : ""}${srcCode ? `d.src=${JSON.stringify(srcCode)};` : ""}
try{const r=await fetch("/api/capture/lead",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
if(!r.ok)throw 0;f.closest(".card").lastElementChild.remove();
const m=document.createElement("div");m.className="msg";m.textContent=${JSON.stringify(T[lang].ok)};f.replaceWith(m);}
catch{e.style.display="block";b.disabled=false;}});
</script></body></html>`);
});

const captureLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many submissions — try again later" });

captureRouter.post("/lead", captureLimiter, async (req, res, next) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: pretend success, store nothing
  const company = String(b.company || "").trim().slice(0, 200);
  const contactName = String(b.contactName || "").trim().slice(0, 120) || null;
  const phone = String(b.phone || "").trim().slice(0, 40);
  const email = String(b.email || "").trim().slice(0, 160) || null;
  const notes = String(b.notes || "").trim().slice(0, 1000) || null;
  if (company.length < 2 || phone.length < 5) return res.status(400).json({ error: "company and phone are required" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "invalid email" });
  try {
    let source = "WEB_FORM", eventName = null, eventId = null, campaignId = null, src = null;
    if (typeof b.eventId === "string" && UUID_RE.test(b.eventId)) {
      const ev = await get(`SELECT id, name FROM events WHERE id = $1`, [b.eventId]);
      if (ev) { source = "EVENT"; eventName = ev.name; eventId = ev.id; }
    }
    if (typeof b.src === "string" && /^[a-z0-9-]{3,30}$/.test(b.src)) {
      const link = await get(`SELECT code, "campaignId" FROM tracked_links WHERE code = $1`, [b.src]);
      if (link) { src = link.code; campaignId = link.campaignId; }
    }
    const lead = await get(
      `INSERT INTO leads (company, "contactName", phone, email, source, notes, "campaignId")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, company`,
      [company, contactName, phone, email, source, notes, campaignId]
    );
    if (eventId) {
      run(`INSERT INTO event_registrations ("eventId", "leadId", source)
           VALUES ($1,$2,'CAPTURE') ON CONFLICT ("eventId","leadId") DO NOTHING`, [eventId, lead.id]).catch(() => {});
    }
    const pseudoReq = { user: { id: null, name: source === "EVENT" ? `Event: ${eventName}` : "Web form" } };
    logActivity(pseudoReq, lead.id, "CAPTURE", notes, { via: source, event: eventName, src });
    notify(await usersWithModuleWrite("leads"), "LEAD_CAPTURED", { company: lead.company, via: source }, "/leads");
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});


// ── Public feedback (CSAT) — same defenses as lead capture ───────────
const FT = {
  ar: { title: "قيّم تجربتك", sub: "رأيك يساعدنا نتحسّن", comment: "ملاحظاتك (اختياري)", send: "إرسال", ok: "شكراً لتقييمك!" },
  en: { title: "Rate your experience", sub: "Your feedback helps us improve", comment: "Comments (optional)", send: "Send", ok: "Thank you for your feedback!" },
};
captureRouter.get("/feedback-form", async (req, res) => {
  const lang = req.query.lang === "en" ? "en" : "ar";
  const t = FT[lang]; const dir = lang === "ar" ? "rtl" : "ltr";
  const ids = {};
  for (const k of ["customer", "event", "lead"]) {
    if (typeof req.query[k] === "string" && UUID_RE.test(req.query[k])) ids[k + "Id"] = req.query[k];
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(t.title)} — حلم</title><style>
*{box-sizing:border-box;margin:0}body{font-family:"IBM Plex Sans Arabic",system-ui,sans-serif;background:#F7F5F0;min-height:100dvh;display:grid;place-items:center;padding:20px}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #E2DED2;border-radius:16px;padding:24px;box-shadow:0 18px 50px -20px rgba(14,17,23,.25);text-align:center}
h1{font-size:18px;color:#161B22}p{font-size:13px;color:#5C6878;margin:6px 0 16px}
.stars{display:flex;justify-content:center;gap:8px;direction:ltr;margin-bottom:14px}
.stars button{font-size:30px;background:none;border:0;cursor:pointer;color:#E2DED2;transition:.15s}
.stars button.on{color:#E8A33D}
textarea{width:100%;border:1px solid #E2DED2;border-radius:10px;padding:10px;font:inherit;background:#FBF9F5;margin-bottom:12px}
.send{width:100%;background:#E8A33D;color:#0E1117;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.send:disabled{opacity:.5}</style></head><body>
<div class="card"><h1>${esc(t.title)}</h1><p>${esc(t.sub)}</p>
<div class="stars" id="s">${[1,2,3,4,5].map((i) => `<button data-v="${i}">★</button>`).join("")}</div>
<textarea id="c" rows="3" maxlength="1000" placeholder="${esc(t.comment)}"></textarea>
<button class="send" id="b" disabled>${esc(t.send)}</button></div>
<script>
let score=0;const S=document.getElementById("s"),B=document.getElementById("b");
S.addEventListener("click",(e)=>{const v=e.target.dataset.v;if(!v)return;score=+v;B.disabled=false;
[...S.children].forEach((b,i)=>b.classList.toggle("on",i<score));});
B.addEventListener("click",async()=>{B.disabled=true;
try{const r=await fetch("/api/capture/feedback",{method:"POST",headers:{"content-type":"application/json"},
body:JSON.stringify({score,comment:document.getElementById("c").value,...${JSON.stringify(ids)}})});
if(!r.ok)throw 0;document.querySelector(".card").innerHTML="<h1>${esc(t.ok)}</h1>";}catch{B.disabled=false;}});
</script></body></html>`);
});

captureRouter.post("/feedback", captureLimiter, async (req, res, next) => {
  const b = req.body || {};
  const score = parseInt(b.score, 10);
  if (!(score >= 1 && score <= 5)) return res.status(400).json({ error: "score 1–5 required" });
  const comment = String(b.comment || "").trim().slice(0, 1000) || null;
  const pick = (k) => (typeof b[k] === "string" && UUID_RE.test(b[k]) ? b[k] : null);
  try {
    await run(
      `INSERT INTO feedback (score, comment, "customerId", "leadId", "eventId", source)
       VALUES ($1,$2,$3,$4,$5,'FORM')`,
      [score, comment, pick("customerId"), pick("leadId"), pick("eventId")]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
