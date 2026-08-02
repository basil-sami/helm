<div align="center">

# نبض · Pulse

**The Marketing Operating Platform — منصة تشغيل التسويق**

Every marketing process, model, and rhythm of a modern marketing department,
in one bilingual (Arabic-first, RTL), data-sovereign system you deploy per client.

</div>

---

## What Pulse is

Pulse is a **product sold instance-per-client**: every customer runs their own Pulse —
their own database, their own deployment, their own domain, their own branding, their
own data. Data sovereignty is the sales pitch, not a compromise.

One graph instead of four silos: a survey insight updates a persona → which shapes the
next brief → which the composer enforces → which the tracked link measures → which the
customer record remembers. See `PULSE-MASTERPLAN.md` for the full product plan.

**Today (Wave 0 + Wave 1 complete, Wave 3 complete — 102 tables, 887 checks, 78-metric catalog):** campaigns · content calendar
with a transition matrix · leads pipeline (kanban, SLA sweep, CSV import, win/loss
reasons) · customers & CSAT · events with registrations/check-in/scorecards ·
dual-currency budgets with rate capture · tasks & process templates · social monitoring ·
media/PR & influencers · market intel (OSINT) + listening with share-of-voice · strategy
OKRs with pace · tracked links (`/r/:code`) · public forms (`/f/:slug`), landing pages
(`/l/:slug`) & surveys (`/s/:slug`) with NPS/CSAT math · contacts with an append-only
consent ledger · approvals engine · creative studio (requests → briefs → versions → brand
center → copy bank) · agency management with a magic-link guest portal · **Analytics
Core: a 44-metric catalog, the nightly Daily Pulse, targets & pacing, anomaly alerts,
immutable monthly board packs, and مؤشر النبض — the Pulse Index (0–100)** · AI Brain
(grounded CMO) · exec report · roles/RBAC, TOTP 2FA, session revocation, audit trail ·
**Publish: per-platform
variants, an approval-gated scheduling queue, assisted publishing through the Daily Pulse,
and attributed bio pages at `/b/:slug`** · **Automate: an audited workflows engine with a
curated action library, points-based lead scoring with hot-lead chasing, and a WhatsApp
template library with merge fields + deep links** · **Reach: sequenced outreach with
assisted WA sends, relationship-health tracking, one-click coverage reports with
share-of-voice, and first-class competitors** · sovereign backup/restore · PWA. · media plans + QR offline attribution · promotions & referrals · partners · paid-spend → ROMI · playbooks · pulse.js first-party web analytics · self-filling OKRs · the Morning Pulse (صباح النبض) · social inbox v1 · outbound mail rail (Resend API or your own SMTP) with the Morning Pulse delivered to opted-in inboxes · WhatsApp Business API (signed webhooks, auto-ingest, compliance-gated replies) · Meta/TikTok/Google connectors with auto-publish, platform metrics and paid-spend sync · validated listening (Admiralty source grading, syndication clustering, analyst review queue, entity-resolved share of voice, Arabic sentiment that abstains, hashed evidence snapshots, case files, owner-aware corroboration and self-tuning thresholds) · a full media library / DAM with usage-aware deletion and signed URLs, driver-agnostic (Supabase or your own database)

## The Wave 0 productization layer

- **Built-in installer.** A fresh instance has zero users. First visit shows the Pulse
  installer: name the organization, create the first admin — the door locks permanently.
- **Onboarding wizard.** Identity & logo, accent color, currency & rate, business units,
  and module toggles — one guided pass, written to `settings`, skippable, re-editable.
- **Per-client theming (Nabd).** One accent hex re-themes the entire interface through
  derived CSS tokens. The client logo takes the mark's place; the ECG heartbeat stays.
- **Module flags.** `settings.modules` hides territories a client didn't buy — enforced
  server-side (routes 404) and client-side (nav disappears). Cron jobs respect flags.
- **Generic vs demo seed.** `supabase/seed.sql` is industry-neutral (no users, no client
  strings). `supabase/seed-demo.sql` is the Saria flagship demo (password `Pulse@2026`).

## Deploy a new client (≈15 minutes, target < 1 hour end-to-end)

Full runbook: **`INSTALLER.md`** · per-instance operations: **`ADMIN-GUIDE.md`**

1. **Supabase** → New project → SQL Editor → paste `supabase/setup.sql` → Run.
   (Schema + generic starter seed, one file.)
2. **Vercel** → Add New → Project → import the Git repo. `vercel.json` configures the
   build. Environment variables:
   - `DATABASE_URL` — the **pooled** Supabase URI (port 6543)
   - `JWT_SECRET` — long random string (`openssl rand -base64 32`)
   - `CRON_SECRET` — enables the scheduled Daily Pulse refresh
   - `ANTHROPIC_API_KEY` — optional, activates the AI Brain
3. **Open the URL** → the Pulse installer appears → create the first admin → the
   onboarding wizard brands the instance → you're live.

**Demo instance:** additionally run `supabase/seed-demo.sql` (or locally
`npm run seed:demo` in `backend/`). Demo login `head@saria.sd` / `Pulse@2026`.

### Self-hosted (sovereign)

```bash
# edit JWT_SECRET in docker-compose.yml first
docker compose up --build -d        # Pulse + its own Postgres on :4000
```

### Local development

```bash
cd backend && npm install && npm run db:apply && npm run dev   # API :4000
cd frontend && npm install && npm run dev                      # Vite, proxies /api
```

## Upgrading an instance

Pull the release, then run `supabase/migrations/APPLY-LATEST.sql` once in the SQL
Editor. It is cumulative and idempotent — one file per instance, fleet-wide.

## Tests

```bash
cd backend && npm i --no-save @electric-sql/pglite && npm test   # 137 checks, no external DB
```

The suite boots an in-memory Postgres, walks the **fresh-instance journey**
(installer → wizard → module flags) on the generic seed, then loads the Saria demo and
runs the full regression: auth/2FA/session lifecycle, RBAC, business rules (content
transition matrix, campaign ACTIVE gate, rate capture), attribution, analytics,
backup/restore, abuse limits.

## Repository layout

```
api/            Vercel serverless entry (wraps backend/src/app.js)
backend/        Express API · CRUD factory · business rules · tests
frontend/       React + Vite + TS · Nabd design tokens · bilingual RTL
supabase/       schema.sql · seed.sql (generic) · seed-demo.sql (Saria)
                setup.sql (one-file installer) · migrations/APPLY-LATEST.sql
PULSE-MASTERPLAN.md   The canonical product plan (waves, territories, laws)
ADMIN-GUIDE.md        Per-instance operations manual
INSTALLER.md          New-client provisioning runbook
```

---

<div align="center">
<sub>نبض — your finger on the market's pulse · إحساسك بالسوق</sub>
</div>
