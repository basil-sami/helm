<div align="center">

# HELM
### Marketing Department OS — Saria Industrial Complex
**نظام تشغيل قسم التسويق — مجمع ساريا الصناعي**

Arabic-first, dual-currency marketing operations — now on Supabase + Vercel,
with user management, social-account integration, and full data export.

</div>

---

## What's in this build

- **Database:** PostgreSQL (Supabase) — SQL schema + seed included.
- **Hosting:** Vercel-ready (static frontend + serverless API), or self-host with Docker.
- **User management:** Head of Marketing can add / edit / deactivate team members.
- **Social integration:** connect accounts, feed metrics (manual + CSV import), export.
- **Data download:** one-click CSV / JSON export on every module.
- Everything is **Arabic-first / RTL** with an English toggle and **SDG + USD** throughout.

> **A note on data location.** Supabase and Vercel are US-based cloud services, so
> marketing data will live there rather than on Saria's own servers — a change from the
> original on-prem, sovereign setup. If you'd rather keep everything in-house, use the
> **Docker + Postgres** path below, which runs HELM and its database entirely on your
> own infrastructure with no external cloud.

---

## Modules

| Module | Arabic | |
|---|---|---|
| Command Center | مركز القيادة | KPIs, spend, pipeline, what's due |
| Campaigns | الحملات | with CSV/JSON export |
| Content Calendar | تقويم المحتوى | month grid |
| Leads (pipeline) | العملاء المحتملون | B2B kanban + export |
| Events / BTL | الفعاليات | + export |
| Budget & KPIs | الميزانية | SDG + USD, by channel |
| Tasks | المهام | kanban |
| **Social** | **السوشيال ميديا** | **connect accounts, feed + export data** |
| **Listening** | **الرصد الاجتماعي** | **share of voice, mention volume, account monitoring + alerts** |
| **AI CMO** | **المدير الذكي** | **AI brain: briefs + grounded Q&A over your data** |
| **Analytics** | **التحليلات** | **KPI engine: funnel, pipeline, ROMI, trends** |
| **Planning** | **التخطيط** | **objectives/OKRs with live progress** |
| **Market Intel** | **رصد السوق** | **OSINT: news/competitor/brand signals + sentiment** |
| **Roles** (in Users) | **الأدوار والصلاحيات** | **custom roles, per-module read/write, admin flag** |
| **Audit + Backup** (in Settings) | **التدقيق والنسخ** | **audit trail of every write; one-click full JSON backup** |
| **Capture** (public) | **الالتقاط** | **shareable bilingual lead form → straight into the pipeline** |
| **Notifications** (bell) | **الإشعارات** | **task assignments, captured leads, daily listening alerts** |
| **Users** | **المستخدمون** | **Head-only team management** |

---

## Deploy on Vercel + Supabase (recommended)

### 1 — Create the database (Supabase)
1. Create a project at supabase.com.
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. (Optional demo data) run `supabase/seed.sql`.
4. In **Project Settings -> Database**, copy the **connection string** (use the
   **pooled** one, port `6543`, for serverless).

### 2 — Deploy the app (Vercel)
1. Push this folder to a Git repo and **Import** it in Vercel.
2. Vercel auto-detects `vercel.json` (builds the frontend, serves `/api` as a function).
3. Add two **Environment Variables**:
   - `DATABASE_URL` -> your Supabase pooled connection string
   - `JWT_SECRET` -> a long random string
4. Deploy. Your app is live; sign in with a demo account (below).

> Alternatively, apply the schema from your machine:
> `cd backend && npm install && DATABASE_URL="..." npm run seed` (schema + demo data),
> or `npm run db:apply` for schema only.

---

## Deploy with Docker + Postgres (self-hosted / sovereign)

Runs HELM **and** its own Postgres in containers — no external cloud, data stays on
your server:

```bash
docker compose up --build
```

Open **http://localhost:4000**. The database is created, schema applied, and demo data
seeded automatically on first boot; data persists in `./data/pg`. Change `JWT_SECRET`
in `docker-compose.yml` before real use.

---

## Local development

**Database:** point `DATABASE_URL` at any Postgres (a Supabase project is easiest).

```bash
# Backend
cd backend
npm install
cp ../.env.example .env        # set DATABASE_URL + JWT_SECRET
npm run seed                   # apply schema + demo data
npm run dev                    # API on http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                    # app on http://localhost:5173 (proxies /api -> :4000)
```

---

## Demo accounts

Password for all: **`Helm@2026`**

| Role | Email |
|---|---|
| Head of Marketing | `head@saria.sd` |
| Digital | `digital@saria.sd` |
| Paid Media | `paid@saria.sd` |
| Events / BTL | `events@saria.sd` |
| Content & Brand | `content@saria.sd` |

Only the **Head** sees **Users** and **Settings**.

---

## User management

Head of Marketing -> **Users**: create members (name, email, role, password), edit roles
and Arabic job titles, reset passwords, and deactivate people (soft-delete; their work
stays linked). Roles: `HEAD`, `DIGITAL`, `PAID_MEDIA`, `EVENTS`, `CONTENT_BRAND`.

---

## Social integration & data

**Social** screen: connect an account (platform + handle, optional access token), then
feed it data three ways:

1. **Manual entry** — add a daily metrics row (followers, posts, impressions, reach,
   engagement, clicks, spend).
2. **CSV import** — paste rows `date,followers,posts,impressions,reach,engagement,clicks,spendUsd`.
3. **Live sync** — pulls from the platform's API automatically (see below).

Export any account's metrics as CSV/JSON from the same screen.

### Getting data in WITHOUT a developer account (works today)

Every platform lets you export your own analytics by hand — no API needed:

- **Facebook** — Meta Business Suite → Insights → Export.
- **LinkedIn** — Company Page → Analytics → Export.
- **TikTok** — TikTok web → Business Suite / Analytics → Download.
- **X** — Analytics → Export data.

Open the file, line the columns up with HELM's order
(`date,followers,posts,impressions,reach,engagement,clicks,spendUsd` — leave any you don't
have blank), and paste into **Import CSV**. This is the recommended path unless you need
hands-off daily syncing.

### Live sync (requires your own developer app)

Adapters for **Facebook, TikTok, X, and LinkedIn** are implemented in
`backend/src/integrations/social.js`. They're ready — each just needs a developer app and
an access token, because none of these platforms allow automatic access without one:

| Platform | What you need | Notes |
|---|---|---|
| **Facebook** | Meta app + Page + Business verification + App Review | Free. Page access token; set `externalId` = Page ID. |
| **TikTok** | TikTok for Developers app, Login Kit + Display API approval | Free; review ~days–weeks. Returns your follower/video/like counts. |
| **X** | X developer account (**pay-per-use, no free tier since Feb 2026**) | Reading your *own* account is cheap (~$0.001/read). OAuth 2.0 user token. |
| **LinkedIn** | App tied to your Company Page + Community Management API approval | Strictest approval. Member token; set `externalId` = organization id. |

To switch an account to live sync:
1. Create the developer app and complete the platform's review.
2. Run OAuth to get an access token (and the page/org/user id).
3. Save them: `PATCH /api/social/accounts/:id` with `{ "accessToken": "...", "externalId": "..." }`
   (or paste the token in the **Connect account** dialog).
4. Press **Live sync**. A failed call returns a clear error; manual/CSV still work.

> **Sudan / sanctions note:** registering these developer apps — and especially loading
> prepaid **X** API credits — may be restricted from Sudan by US sanctions or platform
> region limits. Check this before investing time; the CSV path above avoids it entirely.

> Treat stored access tokens as secrets — they sit in the database; restrict who can reach it.

---

## Market intelligence (OSINT)

**Market Intel** turns public, openly-published information into market and brand
intelligence — competitor moves, brand mentions, sector news, tenders, and overall
sentiment. It reads *aggregate public signals*; it is **not** for profiling or tracking
individuals (that's a misuse line and a fast way to get keys/accounts banned).

**How it works.** You define watch **topics** (a label + a search query, e.g.
`"Saria Industrial" OR "ساريا"`, tagged Brand/Competitor/Market/Sector). Press **Refresh**
and HELM pulls matching items, scores rough sentiment, dedupes, and stores them as
**signals**. The dashboard shows volume over 14 days, a positive/neutral/negative split,
top sources, and trending terms. Any signal can be saved straight into your **Leads**
pipeline.

**Sources (free, no developer account needed):**
- **Google News RSS** — news search per query, per language/region.
- **GDELT** — global news/events index (free, no key).
- **Custom RSS/Atom feeds** — add any feed URL to a topic (industry blogs, gov portals).

You can also log a **manual observation** as a signal (analyst notes from the field).

**Caveats, honestly:**
- Sentiment is a lightweight keyword model — treat it as a rough signal, not a verdict.
- Live fetching needs outbound internet, which works on Vercel / your server.
- To refresh on a schedule, add a **Vercel Cron** hitting `POST /api/osint/refresh`,
  or run it from any scheduler against your server.
- Deep *social* listening (bulk posts/comments) hits the same API-gating wall as live
  social sync — these free sources cover news/web, not platform-internal data.

## Data export (download)

Every list module and the social metrics have **Export CSV / JSON** buttons. CSVs include
a UTF-8 BOM so Arabic renders correctly in Excel. API: `GET /api/export/:resource?format=csv|json`
for `campaigns, leads, events, budget, content, tasks, metrics, signals`.

---

## Project structure

```
helm/
├── api/index.js            # Vercel serverless entry (exports the Express app)
├── vercel.json             # build + routing for Vercel
├── supabase/
│   ├── schema.sql          # PostgreSQL schema (run in Supabase)
│   └── seed.sql            # demo data
├── backend/
│   ├── src/
│   │   ├── app.js          # Express app factory (API + optional static)
│   │   ├── index.js        # local server entry
│   │   ├── db.js           # pg pool (Supabase), cached for serverless
│   │   ├── auth.js         # JWT, bcrypt, roles
│   │   ├── crud.js         # generic CRUD (Postgres)
│   │   ├── integrations/social.js   # platform adapter framework
│   │   └── routes/         # modules, dashboard, users, social, export, settings
│   └── scripts/            # apply-db.js, docker-entry.js
├── frontend/               # React + Vite + TS + Tailwind (Arabic/RTL)
├── Dockerfile              # self-host build
└── docker-compose.yml      # self-host: HELM + Postgres
```

---

## Security checklist

- [ ] Strong, unique `JWT_SECRET`.
- [ ] Use the **pooled** Supabase connection string on Vercel.
- [ ] Change demo passwords / create real users; deactivate demo accounts.
- [ ] Treat stored social access tokens as secrets; lock down DB access.
- [ ] Enable Supabase Row Level Security if you expose the DB beyond this API.

---

<div align="center"><sub>Built for Saria Industrial Complex · صُنع محلياً</sub></div>


## Media & market OSINT (v2)
Four keyless sources per topic — Google News RSS, Bing News RSS, GDELT DOC 2.0, and
Reddit public search — fetched **in parallel with per-source isolation**, deduplicated by
URL + title, and scored with a bilingual (AR/EN), negation-aware sentiment lexicon.
A daily Vercel Cron (`/api/cron/osint`, 05:00 UTC) refreshes all active topics; set a
`CRON_SECRET` env var in Vercel to enable it securely. Custom RSS/Atom feeds per topic
still work. True platform APIs (Meta/X/TikTok) remain separate integrations.

## Security & data sovereignty
Hardened response headers, login rate-limiting, 1 MB body cap, per-module permission
enforcement on every route, an **audit trail** of every create/update/delete, and a
**sovereign backup**: admins can download the entire database as JSON at any time
(password hashes excluded). Data lives in *your* Supabase project.

## Mobile & PWA
Fully responsive: hamburger drawer + bottom tab bar on phones, bottom-sheet modals,
safe-area support. Installable as an app (manifest + service worker with offline shell);
on Android/Chrome use "Install app", on iOS Safari "Add to Home Screen".


## Inbound & alerts (the nervous system)
**Capture**: `GET /api/capture/form?lang=ar|en[&event=<eventId>]` is a public, brand-styled,
honeypot- and rate-limit-protected lead form. Submissions land as leads (source `WEB_FORM`
or `EVENT`), start the lead's activity timeline, and notify everyone with leads-write access.
Copy the link from the Leads page and share it — or point a QR code at it at your next expo.

**Notifications**: the bell in the header. Task assignments (single or whole processes),
captured leads, and the daily cron pushes fresh listening alerts (mention spikes, negative
shifts, follower drops) to admins — deduplicated per day.

**Lead timeline**: every lead records its history — created, stage moves (who/when),
capture arrivals, follow-up processes, and free-form notes — inside the lead's editor.

## Analytics windows
The scorecard's performance metrics (won, win rate, ROMI, CPL, funnel, spend) are windowed —
90 days / 12 months / all time — while pipeline always shows the *current* open state.

## Tests & CI
`cd backend && npm i --no-save @electric-sql/pglite && npm test` runs the 71-check regression
on an in-memory Postgres. GitHub Actions (`.github/workflows/ci.yml`) runs it plus the
frontend build on every push.

## CORS
The API answers same-origin only by default. To allow another origin (e.g. a separate
frontend host), set `ALLOWED_ORIGINS=https://app.example.com,https://other.example.com`.


## The Hub (Phases A–C)
HELM is now an all-in-one marketing hub. **What we sell**: a product catalog that campaigns,
leads, and content link to, with pipeline-by-product analytics. **Who we sell to**: segments
and bilingual personas; every campaign brief targets one. **Briefs & the ACTIVE gate**: no
campaign activates without a brief (objective + persona + product + message + KPI target);
closing it records learnings. **Attribution without ad platforms**: tracked short links
(`/r/code`) count clicks, feed per-campaign ROI, and `?src=code` on the capture form
attributes leads automatically. **Events measured**: registrations (auto-created from
`?event=` captures), one-tap mobile check-in, attend-rate and cost-per-lead scorecards.
**Life after WON**: one-click customer conversion, review cadences the sweep enforces, and
public CSAT forms feeding an average-satisfaction score. **Earned media managed**: journalist
CRM with WhatsApp deep links, a press pipeline whose PUBLISHED items auto-match incoming
OSINT coverage (with sentiment), influencers and collabs with per-link ROI. **What's
effective**: log posts per content item (reach/engagement/clicks) and Analytics answers with
top posts, engagement by channel and by pillar. **Processes the team owns**: DB-backed
templates editable in Settings (built-ins locked), spawned atomically. **The hygiene sweep**
runs in the daily cron: stale leads, overdue tasks, content due unapproved, campaign
overruns, and customer reviews chase their owners via notifications. **Auth lifecycle**:
change-own-password, TOTP 2FA (authenticator apps, manual secret entry), sign-out-everywhere,
and admin resets force rotation on next login. **Restore**: upload a backup JSON to
`POST /api/export/restore` (operational tables; identity and audit are never overwritten).
Executive reporting is a print-optimized bilingual page (perfect Arabic shaping) — Analytics → 🖨.
