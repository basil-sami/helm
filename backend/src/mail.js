import nodemailer from "nodemailer";
import { all, get, run } from "./db.js";

// ═══ THE MAIL RAIL (Wave 2·A) ════════════════════════════════════════
// One transport abstraction. Configured → real SMTP. Unconfigured →
// "log mode": the send is recorded, nothing leaves the building, and
// nothing throws. Tests and fresh instances run happily in log mode.

export const RESEND_URL = "https://api.resend.com/emails";

// Two rails, one contract. HTTP providers (Resend and its API-compatible
// kin) survive serverless hosts that throttle or block SMTP ports; SMTP
// stays for clients who must keep mail inside their own infrastructure.
export async function getMailCfg() {
  if (process.env.RESEND_API_KEY) {
    return {
      provider: "RESEND", apiKey: process.env.RESEND_API_KEY, apiUrl: process.env.RESEND_URL || RESEND_URL,
      from: process.env.SMTP_FROM || "pulse@localhost", fromName: process.env.SMTP_FROM_NAME || "Pulse",
    };
  }
  if (process.env.SMTP_URL) {
    return { provider: "SMTP", url: process.env.SMTP_URL, from: process.env.SMTP_FROM || "pulse@localhost", fromName: process.env.SMTP_FROM_NAME || "Pulse" };
  }
  const s = await get(`SELECT mail FROM settings WHERE id = 1`);
  const m = typeof s?.mail === "string" ? JSON.parse(s.mail) : (s?.mail || {});
  // legacy configs carry no provider — infer it from what was filled in
  const provider = m.provider || (m.apiKey ? "RESEND" : m.host ? "SMTP" : "");
  if (provider === "RESEND") return m.apiKey && m.from ? { ...m, provider } : null;
  if (provider === "SMTP") return m.host && m.user && m.pass && m.from ? { ...m, provider } : null;
  return null;
}

/** Resend-compatible HTTP send. Throws on non-2xx so sendMail records it. */
async function sendViaApi(cfg, { to, subject, html, text }) {
  const res = await fetch(cfg.apiUrl || RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from,
      to: [to], subject, html, ...(text ? { text } : {}),
    }),
    // a wedged provider must never hold the nightly run hostage
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
}

/** Send one message. Never throws — mail must not break the nightly run. */
export async function sendMail({ to, subject, html, text, kind = "TEST" }) {
  if (!to) return { status: "FAILED", error: "no recipient" };
  let status = "LOGGED", error = null;
  try {
    const cfg = await getMailCfg();
    if (cfg?.provider === "RESEND") {
      await sendViaApi(cfg, { to, subject, html, text });
      status = "SENT";
    } else if (cfg) {
      const transport = cfg.url
        ? nodemailer.createTransport(cfg.url)
        : nodemailer.createTransport({
            host: cfg.host, port: Number(cfg.port) || 587, secure: !!cfg.secure,
            auth: { user: cfg.user, pass: cfg.pass },
          });
      await transport.sendMail({
        from: cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from,
        to, subject, html, text: text || undefined,
      });
      status = "SENT";
    }
  } catch (e) {
    status = "FAILED";
    error = String(e?.message || e).slice(0, 300);
  }
  await run(`INSERT INTO mail_log (kind, "to", subject, status, error) VALUES ($1,$2,$3,$4,$5)`,
    [kind, to, subject || null, status, error]).catch(() => {});
  return { status, error };
}

// ── The Morning Pulse, as email ──────────────────────────────────────
// Inline styles only, RTL, no SVG: email clients are a hostile runtime.
const esc = (v) => String(v ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

function lane(title, rows) {
  if (!rows?.length) return "";
  const items = rows.map((r) => `<tr><td style="padding:4px 0;color:#33333a;font-size:14px">• ${esc(r)}</td></tr>`).join("");
  return `<table width="100%" style="margin:14px 0 4px"><tr><td style="font-size:11px;font-weight:bold;color:#8a8a94;letter-spacing:.5px">${esc(title)}</td></tr>${items}</table>`;
}

export function renderMorningHtml(p, orgName = "Pulse") {
  const v = p?.pulse?.value;
  const d = Number(p?.pulse?.delta || 0);
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
  const tone = v == null ? "#8a8a94" : v >= 70 ? "#4f7a4a" : v >= 45 ? "#c98a2e" : "#b4553f";
  const won = p?.wonYesterday?.length
    ? `<div style="background:#eaf1e8;color:#3d6139;padding:10px 14px;border-radius:12px;font-size:14px;margin:12px 0">🎉 فوز الأمس: ${esc(p.wonYesterday.map((w) => w.company).join("، "))}</div>`
    : "";
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#faf7f0;font-family:system-ui,'Segoe UI',Tahoma,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
<tr><td style="height:4px;background:linear-gradient(90deg,#E8A33D,rgba(232,163,61,.25))"></td></tr>
<tr><td style="padding:22px 24px">
  <div style="font-size:20px;font-weight:bold;color:#1b1b1f">صباح النبض ☀️</div>
  <div style="font-size:13px;color:#8a8a94;margin-top:2px">${esc(orgName)} · ${esc(p?.date || "")}</div>
  <table width="100%" style="margin:18px 0"><tr>
    <td align="center" style="padding:14px;background:#faf7f0;border-radius:14px">
      <div style="font-size:38px;font-weight:bold;color:${tone};line-height:1">${v == null ? "—" : v}</div>
      <div style="font-size:12px;color:${tone};margin-top:2px" dir="ltr">${arrow} ${Math.abs(d)}</div>
      <div style="font-size:11px;color:#8a8a94;margin-top:6px">مؤشر النبض</div>
    </td></tr></table>
  ${won}
  ${lane("مهام اليوم", (p?.tasksDue || []).map((t) => t.title))}
  ${lane("نشر اليوم", (p?.publishDue || []).map((x) => x.title))}
  ${lane("تواصل مستحق", (p?.outreachDue || []).map((o) => `${o.targetName} — ${o.campaign}`))}
  ${lane("عملاء ساخنون", (p?.hotLeads || []).map((l) => `${l.company} (${l.score})`))}
  ${p?.counts?.inboxOpen ? `<div style="font-size:13px;color:#8a8a94;margin-top:14px">💬 ${p.counts.inboxOpen} تفاعل بانتظار الرد</div>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;background:#faf7f0;font-size:11px;color:#8a8a94;text-align:center">أُعدّ بواسطة نبض — إحساسك بالسوق</td></tr>
</table></td></tr></table></body></html>`;
}

/** Daily Pulse step: mail today's briefing to everyone who opted in. */
export async function emailMorningDigest() {
  const users = await all(
    `SELECT id, name, email FROM users WHERE active = true AND "morningEmail" = true AND email IS NOT NULL`);
  if (!users.length) return 0;

  const row = await get(
    `SELECT payload FROM digest_log WHERE kind = 'MORNING_PULSE' AND "sentAt"::date = CURRENT_DATE
     ORDER BY "sentAt" DESC LIMIT 1`);
  let payload;
  if (row) payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  else {
    const { compileMorning } = await import("./digest.js");
    payload = await compileMorning();
  }
  const org = (await get(`SELECT "orgNameAr", "orgName" FROM settings WHERE id = 1`)) || {};
  const html = renderMorningHtml(payload, org.orgNameAr || org.orgName || "Pulse");
  const subject = `صباح النبض · ${payload?.date || ""}`;

  let sent = 0;
  for (const u of users) {
    // one briefing per person per day, whatever else the night retries
    const dup = await get(
      `SELECT 1 FROM mail_log WHERE kind = 'MORNING_PULSE' AND "to" = $1 AND "sentAt"::date = CURRENT_DATE LIMIT 1`,
      [u.email]);
    if (dup) continue;
    await sendMail({ to: u.email, subject, html, kind: "MORNING_PULSE" });
    sent++;
  }
  return sent;
}
