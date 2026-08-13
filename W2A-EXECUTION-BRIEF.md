# W2·A EXECUTION BRIEF — Mail rail (SMTP + Morning Pulse email)
*Architected by Fable 5, 2026-07-31 · for mechanical execution (Opus 4.8) · target: suite 416 → ~430, tables 82 → 83, catalog 58 → 59*

## 0 · Environment ritual (do this first, always)
```
cd /home/claude/pulse/backend && npm install --no-audit --no-fund && npm i --no-save @electric-sql/pglite
cd ../frontend && npm install --no-audit --no-fund
```
**Traps (all have bitten before):**
- ANY `npm i <pkg>` prunes the no-save pglite → re-run `npm i --no-save @electric-sql/pglite` after installing nodemailer.
- After ANY schema change, rebuild `supabase/setup.sql` = fixed header + schema.sql + seed.sql concat (harness loads it directly).
- Suite crash printing only `Node.js v22.22.2` → `npm test 2>&1 | grep -E "^(\s+)?(error|Error|name|message|severity|detail|code|position)"`.
- Python `.replace()` without `assert old in s` silently no-ops. Heredoc `\n` escapes corrupt big blocks → write block to a temp file, splice via python (established pattern).
- Demo seed: insert before the **last** `commit;` via `s.rindex('commit;')`; prepend new tables to the truncate list.
- dict.ts inserts: brace-walk from `export const t: Dict = {` anchor `= {`; collision-check every key first.
- Modal needs `open` prop; `api.post(path, body)` needs a body; Card takes no onClick (wrap inner div); no `Array.at()`.
- Exit: green suite → strip node_modules/dist/.env → zip to /mnt/user-data/outputs/pulse.zip (exclude .git) → cp APPLY-LATEST.sql → present.

## 1 · Scope (and nothing more)
SMTP mail rail with a transport abstraction so everything tests offline; Morning Pulse email to opted-in users; admin mail settings with masked password; test-send button; full audit in `mail_log`. **Not in scope** (boundaries, record them in masterplan on close): per-notification emails, digest batching, per-user language templates, API providers (Resend/SES), attachments.

## 2 · SQL (schema.sql + APPLY-LATEST.sql + setup.sql rebuild)
```sql
-- W2·A — the mail rail: every send audited, whatever the transport
create table if not exists mail_log (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null default 'MORNING_PULSE',        -- MORNING_PULSE | TEST
  "to"      text not null,
  subject   text,
  status    text not null default 'LOGGED' check (status in ('SENT','FAILED','LOGGED')),
  error     text,
  "sentAt"  timestamptz not null default now()
);
alter table users add column if not exists "morningEmail" boolean not null default false;
```
(`digest_log` stays the compile record; `mail_log` is the delivery record. Do not touch digest_log.)

## 3 · backend/src/mail.js (new)
- `npm i nodemailer` (then re-add pglite!).
- `getMailCfg()` reads `settings.mail` jsonb `{host, port, secure, user, pass, from, fromName}`; env override `SMTP_URL` wins if set.
- `sendMail({to, subject, html, text, kind})`: if cfg complete → nodemailer SMTP, status SENT/FAILED(+error); else → status LOGGED (no throw ever). **Always** insert a mail_log row. Return {status}.
- `renderMorningHtml(payload)`: RTL Arabic-first, inline styles only, amber accent bar, big pulse number + ▲/▼ delta (no SVG dial — email clients), the four lanes as simple tables, footer "أُعدّ بواسطة نبض". Reuse the payload shape from digest.js `compileMorning()`.
- `emailMorningDigest()`: today's digest payload (from digest_log else compile) → for each active user with `morningEmail=true` → dedupe via mail_log (same `to`+kind+`sentAt::date`) → sendMail. Return count attempted. Never throws.

## 4 · Wiring
- `routes/settings.js`: GET masks `mail.pass` → return `hasPass: (pass set)` and omit pass (mirror the `hasToken` pattern in routes/social.js:17,26). PATCH: if `mail.pass === ""` or undefined, keep the stored one; a non-empty value replaces it.
- New `POST /api/mail/test` (admin only, requirePerm on a core module or role check like other admin-only routes — copy the strictest existing pattern): sends kind TEST to the caller's email, returns the mail_log row status.
- `routes/users.js`: expose + accept `morningEmail` (self-editable + admin). Check the existing fields list mechanism.
- `dailypulse.js`: after `out.digest` step → `try { out.emails = await emailMorningDigest(); } catch …` (LAST step before `return out;`).
- `metrics-engine.js`: register `emails_sent_30d` (CONNECT, count, HIGHER, `mail_log status='SENT' OR 'LOGGED'` last 30d — count LOGGED too so the demo/log mode shows life). Catalog → 59.
- `routes/export.js`: append `"mail_log"` to BOTH arrays.

## 5 · Tests (~14, splice before the rate-limit block via the temp-file pattern)
1. settings PATCH mail cfg (no real host) → GET returns hasPass true, no pass value in JSON.
2. PATCH with pass omitted → stored pass survives (probe via hasPass still true after another PATCH).
3. analyst 403 on /mail/test.
4. POST /mail/test → 200, mail_log +1 kind TEST status LOGGED (no SMTP in tests).
5. users PATCH morningEmail true on H's user; run-daily → out.emails >= 1; mail_log has MORNING_PULSE row to H's email.
6. Idempotent: second run-daily → 0 new MORNING_PULSE rows for today (dedupe holds).
7. Opt-out: set morningEmail false, delete today's rows via db.query, run-daily → 0.
8. renderMorningHtml smoke: the logged row/subject contains the Arabic greeting; fetch the html via a direct import call in-test (`(await import("../src/mail.js")).renderMorningHtml(payload)`) → includes pulse value + "صباح".
9. emails_sent_30d metric ≥ 1; catalog has the key.
10. backup covers mail_log.
**Interaction analysis (required):** earlier blocks' run-daily calls will now also attempt emails — with no opted-in users at that point, count 0, harmless; opt-in happens inside this block only. Digest DELETE in the W1·G block doesn't touch mail_log. Confirm no assert elsewhere reads `out` keys exhaustively.

## 6 · Frontend
- **Settings.tsx**: new "البريد الصادر" card (admin gate like siblings): host/port/secure/user/pass(placeholder "••••" when hasPass, empty submit = keep)/from/fromName + "إرسال بريد تجريبي" button → toast with status. ~12 dict keys `ml_*`.
- **Users page or profile**: `morningEmail` toggle "بريد صباح النبض" (find where user self-settings live; if none, admin toggle in Users.tsx rows). ~3 keys.
- **Morning.tsx** footer: if any admin, append hint line keyed `mo_emailHint` ("يمكن وصول هذا الموجز بريديًا — فعّله من الإعدادات").
- Dict inserts: collision-check `ml_` prefix first; brace-walk anchor; then `npm run build` and fix TS strictly by the trap list above.

## 7 · Demo seed
None needed (log mode generates believable mail_log on first nightly). Only: set `morningEmail=true` on the head demo user in seed-demo (UPDATE users … where email='head@saria.sd' — before last commit). Verify suite still green after.

## 8 · Docs + close-out
- ADMIN-GUIDE: "## البريد الصادر (W2·A)" section before the Daily Pulse section: config, log mode, port 587 note for Vercel, test-send.
- Masterplan: mark W2·A ✅ SHIPPED with boundaries; README counters (83 tables, ~430 checks, 59 metrics).
- Exit ritual per §0. Close-out message: what shipped, deploy order, Vercel note (SMTP from serverless: use 587/TLS; API provider = W2·A polish), boundaries, next = W2·B.
