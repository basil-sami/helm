# SOCIAL-API-BRIEF — the connector layer (W2·B + W2·D, unified)
*Architected by Fable 5, 2026-08-01 · phased execution · targets: 84 tables · ~505+ checks · catalog ~63*

## The one architectural law
**No platform ever touches the product.** Publish, inbox, metrics, ad-spend and WhatsApp sends all
call a single connector contract; Meta/TikTok/Google/WABA are adapters behind it. The product code
that exists today (`scheduled_posts` machine, `inbox_items`, `social_metrics`, `ad_spend`,
`wa_templates`) does not change shape — connectors feed it. This is the mail-rail philosophy again:
two rails, one contract; here it's four platforms, one contract.

**Corollary (testability law):** every adapter's base URL is overridable per instance
(`settings.integrations.<platform>.apiUrl`), pinned versions live in one constants block, and the
suite runs against a local mock platform server. This sandbox cannot reach graph.facebook.com — and
must never need to. The first real-credential test is the **"تحقق من الاتصال" button** on the
deployed instance (the adapter `verify()` capability). That button is the user-acceptance step.

## §0 · Ritual + traps
Run §0 of `W2A-EXECUTION-BRIEF.md` (restore, pglite re-add, setup.sql rebuild law, rindex seed law,
dict brace-walk, Modal `open`, temp-file test splicing, crash-trace grep). New traps specific to
this work:
- **rawBody/HMAC**: `app.js:63` is `express.json({limit:"1mb"})` with no raw capture. Webhook
  signature verification (X-Hub-Signature-256) MUST hash the raw bytes. Change to
  `express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } })` and HMAC
  over `req.rawBody`. Parsed-then-restringified JSON will not match — this fails silently in prod.
- **social_accounts platform check** excludes `'WA'` — migration must drop + re-add the constraint
  (follow the `osint_signals_sourceType_check` precedent in APPLY-LATEST around line 45).
- **Mock server port**: use 4111 (4110 is the app). Start/stop it inside the test block scope.
- **Budget idempotence**: manual `ad_spend` afterWrite already writes a SPENT budget entry. Synced
  rows must write it **once, on first insert only** — upsert updates must NOT re-write (or double)
  the ledger. Amount corrections on later syncs → boundary (log to integration_runs detail).
- **Timing reality**: the only cron is 05:00 daily. Auto-publish therefore needs its own tick —
  see §5. A 15-minute Vercel cron requires a paid tier; document the fallback.

## §1 · The connector contract — `backend/src/connectors/`
```
connectors/
  index.js    — registry, capability map, platformFetch (15s timeout, error-text capture,
                integration_runs logging), connectorSweep() for the Daily Pulse
  waba.js     — WhatsApp Business (Cloud API)
  meta.js     — Facebook Pages + Instagram Business (Graph API, pin e.g. v21.0 in CONSTANTS)
  tiktok.js   — Content Posting + reporting
  googleads.js— ad-spend sync only (skeleton acceptable; see §7 gates)
```
Adapter shape (capabilities-based; absent = unsupported):
```js
export default {
  key: "META",
  caps: { verify:1, publish:1, inbox:1, metrics:1, adspend:1, send:0 },
  verify(account, cfg)            -> { ok, externalId?, name?, error? }
  publish(account, cfg, {text, mediaUrls?, link?}) -> { externalUrl, externalId }
  pullInbox(account, cfg, since)  -> [{ kind:COMMENT|DM|MENTION, author, text, url, externalId, at }]
  pullMetrics(account, cfg)       -> { followers, impressions, reach, engagement, clicks }
  pullAdSpend(account, cfg, since)-> [{ date, amountUsd, impressions, clicks, campaignRef }]
  sendMessage(account, cfg, {to, templateName?, params?, text?}) -> { externalId }  // WABA only
}
```
`platformFetch(url, {headers, body, method})`: JSON in/out, `AbortSignal.timeout(15000)`, non-2xx →
throw with `status + body.slice(0,300)`. Every adapter call is wrapped by index.js which writes an
`integration_runs` row (OK/FAILED + detail) — the admin's "is it working" surface.

`connectorSweep()` (new Daily Pulse step, after `out.emails`): for each CONNECTED account whose
platform has an adapter: pullMetrics → `social_metrics` (source `'API'`, upsert on accountId+date);
pullInbox since last OK run → `inbox_items` (dedupe on externalId); pullAdSpend (Meta/TikTok/Google)
→ `ad_spend` upsert. Per-account try/catch; one bad token never blocks the night. Token expiry:
if `tokenExpiresAt` within 7 days → notify admins (`TOKEN_EXPIRING`, dedupe 20h).

## §2 · Credentials & config
- **Per-account tokens** stay in `social_accounts.accessToken` (masked `hasToken` — pattern exists).
- **App-level secrets** → `settings.integrations` jsonb, masked + merge-preserved exactly like
  `settings.mail` (generalize `maskMail` → also strip `integrations.*.{appSecret, verifyToken,
  developerToken, refreshToken}` into `has*` booleans):
  `{ wa:{verifyToken, appSecret, apiUrl?}, meta:{appSecret, apiUrl?}, tiktok:{clientKey, clientSecret, apiUrl?}, google:{developerToken, clientId, clientSecret, refreshToken, customerId, apiUrl?} }`
- **Webhook URLs** are derived (`https://<instance>/api/public/hooks/wa` etc.) — display-only in
  the Settings Integrations card with copy buttons. They ride the existing `/api/(.*)` Vercel
  rewrite — no vercel.json change for hooks.
- Env overrides win, mirroring mail: `WA_TOKEN`, `META_APP_SECRET`, … (document, don't gold-plate).

## §3 · Schema deltas (one block; 83 → 84 tables)
```sql
create table if not exists integration_runs (
  id uuid primary key default gen_random_uuid(),
  platform text not null, "accountId" uuid references social_accounts(id) on delete cascade,
  kind text not null check (kind in ('VERIFY','METRICS','INBOX','ADSPEND','PUBLISH','SEND','WEBHOOK')),
  status text not null check (status in ('OK','FAILED')),
  detail text, at timestamptz not null default now()
);
create index if not exists idx_intruns on integration_runs (platform, at desc);

alter table social_accounts drop constraint if exists social_accounts_platform_check;
alter table social_accounts add constraint social_accounts_platform_check
  check (platform in ('FACEBOOK','INSTAGRAM','X','LINKEDIN','YOUTUBE','TIKTOK','WA'));
alter table social_accounts add column if not exists "autoPublish" boolean not null default false;
alter table social_accounts add column if not exists "tokenExpiresAt" timestamptz;
alter table settings add column if not exists integrations jsonb not null default '{}';

alter table inbox_items add column if not exists "externalId" text;
alter table inbox_items add column if not exists via text not null default 'MANUAL' check (via in ('MANUAL','API'));
create unique index if not exists uq_inbox_ext on inbox_items (platform, "externalId") where "externalId" is not null;

alter table scheduled_posts add column if not exists "externalUrl" text;
alter table scheduled_posts add column if not exists "publishError" text;

alter table ad_spend add column if not exists source text not null default 'MANUAL' check (source in ('MANUAL','SYNC'));
alter table ad_spend add column if not exists "campaignRef" text;
create unique index if not exists uq_adspend_sync on ad_spend (platform, "campaignRef", date) where source = 'SYNC';

alter table wa_templates add column if not exists "waTemplateName" text;
```
(setup.sql rebuild after, as always.)

## §4 · PHASE 1 — Connector core + WABA (execute first; everything else stands on it)
**Webhooks** (`routes/hooks.js`, mounted at `/api/public/hooks`, no auth):
- `GET /wa`: Meta verification handshake — echo `hub.challenge` iff `hub.verify_token` matches
  `integrations.wa.verifyToken`; else 403.
- `POST /wa`: check `X-Hub-Signature-256` = HMAC-SHA256(appSecret, rawBody); on mismatch → 401 +
  integration_runs WEBHOOK/FAILED. Parse WABA envelope → for each message: insert `inbox_items`
  (platform 'WA', kind 'DM', author = wa_id/profile name, text, externalId = message id, via 'API')
  — dedupe by the unique index (insert … on conflict do nothing). Statuses (delivered/read) v1:
  ignore. Always answer 200 fast (Meta retries aggressively; heavy work stays out of the handler).
**Sends** (`sendMessage` in waba.js — Cloud API `/<phoneNumberId>/messages`):
- **The compliance split, non-negotiable:** business-initiated messages require a Meta-**approved
  template** (`type:"template"`, `waTemplateName` + params). Free-form `type:"text"` is only legal
  inside the 24-hour customer-service window after the customer's last inbound message.
- Product hooks: (a) **Inbox reply** — reply box on WA items; if last inbound < 24h → free text,
  else force template picker (compute window from the item's receivedAt / latest WA inbox row for
  that author). (b) **Outreach touch send** — existing modal gains "إرسال عبر الواجهة" beside the
  wa.me link when a WA account is CONNECTED; uses the template's `waTemplateName` (block with a
  clear message if unset). Workflows keep producing DRAFTs — auto-sending marketing via workflow
  is a compliance trap → boundary (W3, with template-status tracking).
- WA account row: platform 'WA', externalId = phoneNumberId, accessToken = token, connect via the
  existing accounts UI + a verify button (calls `verify()` → Graph `/<phoneNumberId>` check).
**Tests (~24, mock server):** handshake ok/bad token · signature ok/bad/missing → 401 · inbound →
inbox_items via API + kind + author · redelivery deduped · malformed envelope → 200 + FAILED run ·
template send hits mock with template payload · 24h window: fresh inbound → free text allowed,
stale → rejected with the template message · outreach send via API marks touch SENT + integration_runs
SEND/OK · integrations secrets masked (`hasAppSecret` etc.) + merge-preserved · analyst 403s ·
export/backup covers integration_runs.
**KPIs (DoD):** `wa_sent_30d` (HIGHER), `inbox_api_7d` (HIGHER). Catalog 59 → 61.

## §5 · PHASE 2 — Meta (Facebook Pages + Instagram Business)
- `verify()`: GET `/me?fields=id,name` with the page/IG token → status CONNECTED + externalId.
- `publish()`: FB → `POST /<pageId>/feed` (message, link); IG → the two-step container flow
  (`/media` then `/media_publish`; **IG requires a media URL** — text-only falls back to FB or
  errors clearly). Store returned permalink → `scheduled_posts.externalUrl`.
- **Auto-publish path** (the state machine's *actors* change, not its states): new
  `POST /api/cron/publish-tick` — for each `scheduled_posts` READY, `scheduledAt <= now()`,
  `externalUrl is null`, variant's account CONNECTED + `autoPublish` → attempt publish; success →
  PUBLISHED + externalUrl; failure → stays READY, `publishError` set, owner notified
  (`PUBLISH_FAILED`, 20h dedupe). Manual accounts keep today's NOTIFIED flow untouched. Add
  vercel.json cron `*/15 * * * *` for the tick — **note: sub-daily crons need Vercel Pro; on
  hobby, the tick also runs inside the 05:00 Daily Pulse and via a manual "انشر الآن" button** (the
  button already exists in the queue; wire it to attempt the API path first when eligible).
- Inbox ingest: webhooks `POST /hooks/meta` (same handshake+HMAC helper, shared) for page feed
  comments + mentions + messenger DMs → inbox_items via API; plus a polling fallback in
  `connectorSweep` for comments (webhook subscriptions are an app-review privilege — see gates).
- Metrics: page `insights` + IG `insights` → social_metrics source 'API'.
- Ad-spend: Marketing API `/act_<id>/insights?level=campaign&time_increment=1` → upsert per
  (campaignRef, date); auto-match `campaignRef` to `campaigns.name` (exact, case-insensitive) else
  leave unmapped + visible in Growth for manual reassignment. Budget entry on first insert only.
- Token hygiene: store `tokenExpiresAt` when known (debug_token); expiry warning per §1.
**Tests (~20):** verify ok/bad · FB publish → PUBLISHED + externalUrl · IG without media → clear
error, stays READY + publishError · autoPublish off → untouched (NOTIFIED path intact) · tick
idempotent (second run publishes nothing) · comment webhook → inbox dedupe · adspend upsert: same
day re-sync doesn't duplicate budget · campaign name auto-match + unmapped ref preserved ·
metrics row source API.
**KPIs:** `autopublished_30d` (HIGHER), `synced_spend_30d` (usd, LOWER). Catalog → 63.

## §6 · PHASE 3 — TikTok
Publish (Content Posting API: init upload with `video_url`/photo, poll status) + metrics
(user/video stats) only. TikTok comment/DM APIs are restricted-tier → inbox for TikTok is a
**boundary**, stated in the UI (the accounts row shows which capabilities are live per platform —
drive it from the adapter `caps` map, don't hardcode). Tests ~8. No new KPIs (rides autopublished).

## §7 · PHASE 4 — Google Ads (spend only)
`googleads.js` skeleton against the mock: `searchStream` GAQL for campaign/day cost_micros →
ad_spend upsert (amountUsd = cost_micros/1e6). **Real-world gate:** Google Ads API needs an
approved **developer token** + OAuth refresh token; v1 accepts pasted refresh-token credentials in
`integrations.google`, full OAuth consent flow → boundary. If credentials absent the adapter is
dormant and the card says so. Tests ~6.

## §8 · The mock platform server (test rig)
~60 lines in the test harness, `http.createServer` on **4111**, started/stopped inside the block:
- `GET /verify-ok` style routes aren't enough — route by path shape: `/<id>/messages` (WABA send →
  echo `{messages:[{id:"wamid.MOCK"}]}`), `/me` (`{id:"pg1",name:"Mock Page"}`), `/<id>/feed`
  (`{id:"pg1_post9"}`), `/media` + `/media_publish`, `/insights` (canned rows), `/act_x/insights`
  (two campaign-days incl. one matching a demo campaign name), plus `/fail-500` and a token check
  (`Authorization: Bearer mock-good` else 401) so bad-token paths are real.
- Point adapters at it via `integrations.<p>.apiUrl = "http://127.0.0.1:4111"` inside tests; reset
  integrations to `{}` at block end (leave the suite as found — the mail block set the precedent).

## §9 · Frontend (per phase, Nabd standard)
- **Settings → التكاملات card** (P1): per-platform secret fields (masked placeholders, blank=keep),
  webhook URL display + copy, last-10 `integration_runs` feed with status dots.
- **Social accounts list** (P1/P2): add WA platform option · تحقق (verify) button with result toast ·
  autoPublish toggle (only where `caps.publish`) · capability chips from the adapter map · token
  expiry warning chip.
- **Inbox** (P1): `API` badge on ingested items · WA reply box with the 24h-window logic (free text
  vs template picker) · sends logged to the item thread? v1: toast + integration_runs only.
- **Publish queue** (P2): "auto ⚡" chip on eligible slots · externalUrl link on PUBLISHED ·
  publishError surfaced inline with retry (re-attempt = the tick logic for one row).
- **Growth → Ad spend** (P2): `SYNC` badge · unmapped campaignRef shown amber with a reassign
  select.
- Dict prefixes: `cn_` (connectors) + extend `ix_`/`gr_` keys (`ig_` verified free but unused).
  Collision-check every key regardless (the law).

## §10 · Sequencing, demo, docs, close-out
- Execute **P1 → P2 → P3 → P4**, each phase a full cluster: SQL → adapter(s) → wiring → tests
  green → frontend → dict → docs → package. W2·C (storage) may interleave after P1 if priorities
  shift — nothing here depends on it.
- **Demo seed:** no fake tokens, ever. Demo stays in manual mode; optionally 3–4 `integration_runs`
  rows are NOT seeded (empty card with its explainer is the honest demo). The WA/Meta story is
  told on the deployed instance with real credentials.
- **Docs:** ADMIN-GUIDE gains "التكاملات" (webhook setup walkthrough per platform, the 24h-window
  explanation in plain Arabic, token renewal, the Vercel cron tier note). Masterplan: mark each
  phase ✅ with boundaries on close. README counters per phase.
- **Boundaries (recorded now):** workflow auto-WA-send (W3, needs template-status tracking) ·
  WA template sync/approval status from Meta · TikTok inbox · Google OAuth consent flow · media
  upload for publish beyond URL-hosted assets (needs W2·C storage — natural pairing) · webhook
  retry queue/backoff · X/LinkedIn/YouTube adapters (contract makes them cheap later).

## ⚠ Real-world gates — start these NOW, in parallel with any coding
These take **weeks** and no code can shortcut them:
1. **Meta Business verification** for the Saria business portfolio.
2. **App review** permissions: `pages_manage_posts`, `pages_read_engagement`,
   `instagram_content_publish`, `instagram_manage_comments`, `whatsapp_business_messaging`.
3. **WABA**: a phone number for WhatsApp Business (cannot be simultaneously on the consumer app),
   display-name approval, and **message templates submitted for approval** (write the Arabic
   follow-up + NPS templates from `wa_templates` and submit them as-is).
4. **TikTok** developer app + Content Posting API access request.
5. **Google Ads** developer token (basic access) — longest, least critical (spend sync only).
Until approvals land, everything runs against verify buttons + the mock — the code will be waiting
for the platforms, not the reverse.
