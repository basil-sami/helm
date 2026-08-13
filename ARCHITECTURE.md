# ARCHITECTURE.md — Pulse (نبض)

The single map of the platform. `PULSE-MASTERPLAN.md` says what Pulse *will* be; this says what it *is*.
If you are new to this codebase, read this file top to bottom — it is written to be sufficient on its own.

**Living-doc rule:** every cluster's Definition of Done includes its section here. The table census below is generated from `supabase/schema.sql` and verified in CI (`npm run docs:check`) — documentation that cannot rot.

---

## 1. System shape

**One instance per client.** Each client gets their own deployment and their own database. Multi-tenancy was considered and rejected in Wave 3: row-level-security on shared tables makes every future query a potential cross-client leak, while separate instances make isolation a property of the infrastructure rather than of developer discipline. The Pulse Installer solves provisioning; it does not solve — and does not need to solve — tenancy.

**Deployment targets, kept at parity:**
- **Vercel + Supabase** — frontend static build, API as serverless functions (`/api`), Postgres in `eu-west-1`, Daily Pulse on Vercel Cron.
- **Docker Compose** — the same Express app, long-running, for on-premise clients.

> **Parity lesson (recorded because it has bitten us):** routing gaps appear on Vercel that never appear in Docker — the `/r/:code` redirect rewrite was missing once. Any new non-`/api` public path must be added to `vercel.json` *and* tested in both.

**Stack:** Node 22 · Express · Postgres · React + Vite + TypeScript · PGlite for tests.
**Nine production dependencies:** `bcryptjs, cors, dotenv, express, jsonwebtoken, nodemailer, pg, qrcode, zod`. This number is a feature. New capability rides native Node (`crypto`, `fetch`, `Intl`) or an existing rail; a proposal that adds a dependency needs an argument for why the platform is worth more with it than the supply-chain story is worth without it.

---

## 2. Request path

```
client → app.js
           ├ CORS, JSON body, rate limiter (security.js)
           ├ requireAuth → JWT verify → req.user {id, role, permissions, departmentId, isAdmin}
           ├ hasPerm(module, "read"|"write")  ← permission keys, not role strings
           ├ route handler  (routes/*.js, most built by crudRouter)
           ├ logAudit(...)  → audit_log
           └ error → observability.js → error_log (fingerprint + payload digest, never payload)
```

**Authorization is permission-based, never role-string-based.** `isAdmin` derives from permissions. A custom role with the right permissions behaves exactly like a built-in one.

**Department scoping is enforced once,** inside `crudRouter` (W3·H). A user with a department sees their department's rows plus unassigned rows; admins and undepartmented users see everything. An instance that never adopts departments behaves exactly as it did before the feature existed. **Departments are a dimension, not cloned tables** — the same decision now carries campaigns.

---

## 3. The rails

A rail is a single-contract module that owns all access to one external capability. Adding a second path to the same capability is the architectural sin this pattern exists to prevent.

| Rail | File | Contract | Laws |
|---|---|---|---|
| **Mail** | `mail.js` | `sendMail({to, subject, html})` | SMTP optional; absence degrades, never crashes. Every send logged to `mail_log`. |
| **Storage** | `storage.js` | driver interface, DB or Supabase | 50 MB cap; signed URLs; deletion is usage-aware. |
| **AI** | `ai.js` | `aiRun({task, prompt, grounding})`, logged to `ai_runs` | **Four laws** — AI drafts, humans dispose · grounded or silent (`groundedComplete` discards ungrounded answers) · bounded cost · never for guardrailed things (no private individuals, no AI-drafted WhatsApp sends, no AI ruling the review queue). |
| **Search** | `search.js` | provider-abstracted live search, logged to `search_runs`, budgeted by `search_budget` | **Never bypasses validation** — live results enter as `osint_signals` and traverse the full pipeline. Per-provider caps, 80% warn, hard stop, degrade to free providers. |
| **Crypto** *(SEC·A, planned)* | `crypto.js` | `encryptSecret/decryptSecret` with AAD row-binding | Secrets never plaintext at rest or in logs; fail-closed when the key is absent. |

---

## 4. The engines

### 4.1 Measurement (W1·C)
`metrics-engine.js` holds `CATALOG` (metadata, defined exactly once) and `COMPUTE` (formulas, keyed by metric). Nightly, `snapshotAll()` materializes every active metric into `metric_snapshots`, with optional **dimension slices** declared per metric (`{ dimensions: ["source"] }`) and returned by the compute function. `metric_targets` drive pacing; `evaluateAlerts()` fires anomalies against trailing baselines with dedupe. Composites — including the **Pulse Index (مؤشر النبض, 0–100)** — are declarative weighted normalizations of other catalog metrics.

> **Hard rule:** every territory registers its KPIs in the catalog as part of its Definition of Done. The only sanctioned exceptions are ops-facing signals (security, queue health, budget burn), which belong on the System page and in Morning Pulse, not in the business catalog. Exceptions must be recorded with a reason.

### 4.1a The campaign spine (W4·A)
A campaign is the organizing unit: modules are libraries, campaigns are the workspace. **Membership is expressed by the `campaignId` foreign key each territory table already carries**, enumerated once in `CAMPAIGN_LINKS` (`src/campaign.js`). The wave-opening audit found thirteen tables already carrying that FK; a polymorphic `campaign_items` join table was designed and then rejected, because it would have created a second and contradictable truth about what belongs to a campaign. Five tables that lacked the FK gained it.

`warRoom(id)` assembles one screen from truths that already exist — attached work per territory, budget against actual spend with pacing, attributed leads with `lostReason` breakdown, and derived CPL and ROI. Campaign is registered as a **slice dimension** on the snapshot engine, so per-campaign series ride existing snapshots, targets and board packs rather than a parallel rollup. A registry test asserts every declared table, title and status column exists — the failure it exists to catch is a territory silently vanishing from the war room.

Close-out drafts a retrospective through the AI rail under its own laws: grounded in the campaign's own rows or it declines, and the human's edit is what gets kept.

### 4.2 Automation
`automate-engine.js` evaluates `workflows` (`trigger → condition → action`), logging every run to `workflow_runs`. Conditions support a recursive `{type:"IF", cond, then, else}` node. **There is exactly one predicate evaluator in this codebase** — the flow builder (W3·B) is pure UI over the same jsonb, and segment definitions evaluate through the same code. A second evaluator would be a second set of bugs.

### 4.2a Data foundation (W4·B)
`import_jobs` is a state machine — `UPLOADED → MAPPED → VALIDATED → PREVIEWED → COMMITTED` (+ FAILED/CANCELLED) — with dedupe against both the file and the database, three merge strategies, and **consent captured at commit** into the existing `contacts.consent` ledger. **Self-loops must be declared:** re-mapping is legal, re-committing is not, which is what stops a double-click from importing a file twice. The legacy `POST /leads/import` endpoint is untouched and still works; this is the wizard it grew into.

`parseCsv` is a real quote-aware parser. The legacy importer split on commas, which mangles any quoted company name containing one.

**Segments** gained a `definition` evaluated by `evalCond` — *the workflow engine's evaluator*, not a second one (decision D9). A segment may only test fields its source declares (`SEGMENT_SOURCES`); unknown fields are refused rather than interpolated, which is the injection gate. Rows are fetched and filtered in code — no SQL is generated from user input. A null definition keeps the HELM-era descriptive behaviour.

### 4.2b Value and the lead loop (W4·C)
`conversions` is where money enters: one row per realised amount, campaign attribution inherited from the lead, values normalised to USD so metrics never mix units. It is deliberately a value-capture point, **not a CRM** — and it is the y-variable MMM (W3·G) has been waiting for.

The funnel had discipline at the end (`lostReason` enforced on LOST) and nothing at the beginning. Now: assignment starts a `followUpDueAt` clock, recording contact stops it, and a Daily Pulse step breaches overdue leads once — `slaBreached` is the latch, so a lead that stays overdue does not renotify nightly — notifying the owner and escalating to the department head.

### 4.2c Calendar and the seasonal layer (W4·D)
A content calendar page already existed (content, events, campaign spans). What was missing were the two layers a marketer actually plans against: the **publishing queue** and the **season**. `calendarFeed(from, to)` returns all five layers in one call.

Seasonal packs are **seeded data, not hardcoded assumptions** — a client in another market deactivates the Sudan/Islamic packs and installs their own with no code change. An event is dated as fixed Gregorian, explicit, or **hijri month/day resolved per Gregorian year at read time**, so Ramadan and the two Eids move correctly. Resolution uses native `Intl` Umm al-Qura, scanning day by day rather than approximating arithmetic that drifts. Every occurrence also carries `prepFrom` — the lead time marketing plans against, which is the date that actually matters.

### 4.3 Approvals
One approvals engine with per-module plug-ins. Every state change walks a **transition matrix**; there is no bypass path, including for bulk operations, which are N single transitions.

W4·D extracted `decideOne()` from the decide route so **bulk approval is literally N calls to it** — every permission check, side-effect and audit entry included. A bulk path that wrote statuses directly would have been a second door. **Delegation** lets a delegate decide in an approver's place while the window is open — the approver's authority borrowed, not widened, and the delegate still needs the module permission. Overlapping delegations are refused so authority is never ambiguous. A Daily Pulse step escalates approvals waiting past the instance SLA **once** (`escalatedAt` latch, matching the lead-SLA pattern).

### 4.3a Experience surfaces (W4·E)
**Role homes** (`/api/home`) answer one question per role — *what does Pulse want from me today?* — assembling only cards the user's permissions allow, each carrying the age that makes a queue urgent rather than merely present (stale approvals, overdue leads, oldest unreviewed signal). The publish queue requires publish rights, not merely read access to content: it is a queue to act on.

**The setup checklist** is computed from live data, never stored. A checklist that can disagree with reality is worse than none — the same reasoning behind the self-filling OKRs.

**The template library** is `process_templates`, promoted rather than duplicated: `kind` says what is templated and `definition` carries non-task shapes, while existing PROCESS rows and their `tasks` column are untouched. Campaign templates carry their brief, so a new user can reach ACTIVE instead of meeting the activation gate as a wall; workflow templates instantiate **inactive**, for review before they run. Instantiation goes through the same validation as the manual path — a template is a starting point, not a bypass.

**Morning Pulse** now ends with an action queue (approvals, leads due, review depth, campaigns ending) rather than only reporting. A briefing that only reports is a newsletter.

### 4.4 The Daily Pulse
`dailypulse.js` is the platform's single nightly heartbeat: snapshots → alerts → publish notifications → lead rescoring and sweeps → outreach/media sweeps → hygiene → OSINT ingest and corroboration → Morning Pulse digest and email → connector sync → publish tick → error pruning. Each step is individually try/caught: **one failing step never cancels the night.** New scheduled work is a step here, never a second cron.

### 4.5 Listening (W2·E + W3·D/E)
```
collect (feeds · live search · manual)
  → normalize (Arabic-aware) → SimHash dedupe/cluster (syndication counted once)
  → relevance gate → [0.35–0.65 band] → analyst review queue
  → entity resolution (ORG/BRAND/PRODUCT/OUTLET + official spokespeople ONLY)
  → sentiment (abstains below confidence) → corroboration (2+ independent sources)
  → metrics (SOV) → Pulse Index → board pack
```
Sources carry **Admiralty grades** (reliability A–F × credibility 1–6). AI participates as *recommendation only* inside the ambiguous band; it never rules the queue. **PERMANENT GUARDRAIL — no private-individual profiling, enforced server-side.** Permitted entity kinds are ORG, BRAND, PRODUCT, OUTLET and PUBLIC_FIGURE (official spokespeople only). The `osint_entities` check constraint and the control room's `CONTROLLABLE_ENTITY_KINDS` mirror each other exactly, and a test asserts they do — neither may drift stricter or looser than the other.

**The control room (W4·F)** hands the operator the levers, under three laws:

1. **Controls tune the pipeline; nothing bypasses it.** The instance pause and paused watches are enforced *at ingest*; muted sources are excluded *at the metric* (`entitySov`). A lever that only changed a settings row would be decorative, so each one is enforced where it bites.
2. **Changes are versioned and replay-previewed.** `replayGate()` re-scores the trailing window with the pipeline's own `scoreRelevance` — a preview scored differently would predict a system that does not exist — and writes nothing. Every applied change lands in `listening_changes` with its replay, rendering as a **chart marker**, so a jump in share of voice is explained by a gate change rather than mistaken for the market moving.
3. **The guardrail is immovable by any control.** No setting, rule or lever can admit a private individual.

**Block and mute are different levers for different problems:** blocked stops ingestion; muted keeps ingesting for the evidence trail but suppresses the source from alerts and metrics. Regrading requires admin and a written reason. Bulk rulings write exactly the fields a single ruling writes, and agreement with the model is *measured*, never used to auto-rule.

### 4.6 Forecasting & MMM (W3·F/G)
Forecasts are seasonal-naive + damped trend and **always return an interval, never a point**; below the data floor they refuse. MMM ships adstock and saturation as inspectable transforms with non-negative ridge coefficients, reports collinearity as *inseparable* rather than silently splitting credit, and **renders directional-only below ~80 weekly observations**. The refusal is the feature: MMM's failure mode is being available and wrong.

---

### 4.6 Secrets at rest (SEC·A)
AES-256-GCM on native `node:crypto` — no dependency joins the nine. Stored as `enc:v{n}:{iv}:{ct}:{tag}`, with **AAD bound to `table:row:column`**, so a ciphertext copied into another row, column or table fails authentication. Keys live only in the runtime environment (`PULSE_SECRET_KEY_V1`), never in the database or the repo; instance-per-client means one key per client, so a stolen dump plus that client's key still touches nobody else. Rotation is by key version: add `V2`, run `npm run secrets:rotate`, retire `V1` when no `enc:v1:` rows remain.

**Encrypt what we use** — `social_accounts.accessToken` and `users.totpSecret` must be read back, so they are encrypted and decrypted at the point of use. **Hash what we verify** — passwords stay bcrypt, and `portal_tokens.token` is SHA-256 hashed; because lookup hashes what the guest presents, existing magic links keep working while a database dump yields none.

Decryption happens at five boundaries, all funnelled through `withToken()`: account sync, the publish tick, connector sync, the WhatsApp reply path, and account verification. Nothing writes a decrypted value back.

**SECRET_SCAN** sweeps `information_schema` for credential-shaped column names; every hit must be encrypted, hashed, or in `EXEMPT_COLUMNS` with a written reason. A migration cannot add a plaintext secret column and have the build pass, and a registry entry pointing at a vanished column is reported too. `/api/health` reports key version and unprotected-value count, and marks the instance unhealthy if it holds secrets without a key.

*(Fixed in passing: a liveness stub had been registered at `/api/health` ahead of the full report, so W3·A's health report never actually served over HTTP. The probe now lives at `/api/health/live`.)*

### 4.7 Single sign-on (SEC·B)
**OIDC first; SAML deliberately deferred and refused at the schema level.** Entra ID, Okta, Google Workspace and Ping all publish OIDC for the same app-catalogue entries as SAML — "we standardise on SAML" almost always means "our IdP, which also speaks OIDC". OIDC is JSON and JWT, which this codebase already verifies with `jsonwebtoken` and native `crypto.createPublicKey({format:"jwk"})`, so **zero dependencies were added**; a SAML stack would import XML canonicalisation and the XML-DSig signature-wrapping vulnerability class into a nine-package supply chain. This is the argument to make to a reviewer, not an apology.

Flow: discovery (cached 24h) → authorize with **state, nonce and PKCE S256** → an HMAC-signed, httpOnly, `SameSite=Lax` handshake cookie carrying `{state, nonce, verifier, connId}` (no state table, serverless-clean) → code exchange proving the PKCE verifier, with the client secret decrypted by the **SEC·A rail** at the moment of use → ID token verified for signature (JWKS by `kid`, refetched once on an unknown key so IdP rotation is absorbed without an outage), `iss`, `aud`, `exp` with 60s skew, and `nonce` → email extracted, optional `email_verified` enforcement, **domain allow-list** → user resolved, JIT-created from the claim→role map when enabled → **the same session token the password flow issues**. One session mechanism, not two.

**`ssoRequired` and break-glass.** With SSO required, password sign-in returns 403 for everyone except exactly one designated break-glass administrator, whose every use writes an `auth_events` row with `method='break_glass'` and a loud audit entry. The mode cannot be enabled until such an account exists, and the last one cannot be removed while it is on — because an IdP misconfiguration must never lock an organisation out of its own instance.

`auth_events` records every attempt, successful or not, with reason, IP and user agent. Security reviewers ask for this within the first ten minutes.

*Deferred and named:* native SAML (contract-triggered only) and SCIM auto-deprovisioning. Until SCIM, deprovisioning is `ssoRequired` + disable at the IdP + the per-request `users.active` check.

### 4.8 Erasure and export (SEC·C)
The subjects are the market-side humans Pulse holds — leads, contacts, form and survey respondents, outreach recipients, media contacts, vendor contact persons. Staff offboarding is a different mechanism (`users.active` + SSO deprovisioning) and is deliberately out of scope.

**PII_MAP** declares every column holding subject data and how erasure treats it: `anonymize`, `redact_jsonb`, or `retain_legal`. **PII_SCAN** sweeps `information_schema` at build time; every column matching the personal-data pattern must be in PII_MAP, `STAFF_COLUMNS` or `NOT_PII` with a reason. Three buckets exist because a column name cannot answer the question — `campaigns.name` and `contacts.name` spell the same and only one is a person. **A migration cannot add an unerasable personal column and pass the build.**

**Erasure anonymises; it does not delete.** Personal columns are blanked while the row survives, so funnel counts, `lostReason` history, nightly snapshots and the Pulse Index are untouched — **erasure must never rewrite the board pack**. The email becomes a per-request sentinel (`erased:{id}`) so an erased row can never collide with a live address, and NOT NULL display columns become `[erased]` rather than failing a constraint. Failures are reported, never swallowed: an erasure the operator believes happened but did not is the worst outcome available.

**Confirm by rediscovery.** After execution, discovery re-runs against the same engine that found the data, and the request confirms **only if it comes back empty** (or holds nothing but legally retained rows). Erasure is verified, not trusted. The certificate records what was done, by whom, residual rows with their legal basis, and an explicit note that free text needs a human pass — Pulse does not claim to have searched notes and attachments.

**`erasure_log` holds hashed row references** (`sha256(table:id)`), never the rows, so the log of an erasure contains no personal data — and a restore from backup can **replay** every executed erasure from it. That is what makes the backup answer honest rather than "it ages out eventually".

**Export rides the same registry in read mode.** Two rights, one map.

## 5. State machines

The matrices *are* the business rules. Each is enforced server-side; illegal transitions are 400s, not silent no-ops.

| Object | States |
|---|---|
| `content_items` | IDEA → REVIEW → APPROVED → PUBLISHED (+ ARCHIVED) |
| `scheduled_posts` | DRAFT → QUEUED → AWAITING_APPROVAL → READY → NOTIFIED → PUBLISHED / SKIPPED |
| `campaigns` | DRAFT → ACTIVE → COMPLETED → ARCHIVED · `DRAFT→ACTIVE` requires a brief |
| `import_jobs` | UPLOADED → MAPPED → VALIDATED → PREVIEWED → COMMITTED (+ FAILED / CANCELLED) |
| `leads` | stage flow; `LOST` requires a `lostReason` from the enforced taxonomy |
| `erasure_requests` | RECEIVED → VERIFIED → DISCOVERED → PENDING_APPROVAL → EXECUTED → CONFIRMED (+ REJECTED with a recorded reason) |

---

## 6. Table census

<!-- CENSUS:START -->
**113 tables** across 14 territories. Generated by `npm run docs:census` — do not edit by hand.

| Territory | Tables | Purpose |
|---|---|---|
| **Foundation** (13) | `audit_log` · `auth_events` · `departments` · `erasure_log` · `erasure_requests` · `error_log` · `files` · `mail_log` · `notifications` · `roles` · `settings` · `sso_connections` · `users` | Identity, permissions, settings, audit and notification plumbing. |
| **Campaigns & Planning** (8) | `budget_entries` · `campaign_briefs` · `campaigns` · `key_results` · `objectives` · `playbooks` · `process_templates` · `tasks` | The operating spine: campaigns, briefs, budget, objectives, tasks. |
| **Demand** (6) | `conversions` · `customers` · `import_jobs` · `lead_activities` · `lead_score_rules` · `leads` | Leads, scoring, activity, customers and captured value. |
| **Audience** (4) | `contacts` · `personas` · `products` · `segments` | Who the marketing is aimed at. |
| **Publish** (10) | `bio_links` · `bio_pages` · `content_items` · `content_variants` · `posts` · `scheduled_posts` · `seasonal_events` · `seasonal_packs` · `social_accounts` · `social_metrics` | Content production, variants, scheduling and the public bio surface. |
| **Automate** (6) | `form_submissions` · `forms` · `landing_pages` · `wa_templates` · `workflow_runs` · `workflows` | Trigger→condition→action workflows, forms, landing pages, messaging templates. |
| **Research** (4) | `feedback` · `insights` · `survey_responses` · `surveys` | Surveys, feedback and the insight ledger. |
| **Reach** (9) | `coverage_reports` · `event_registrations` · `events` · `influencer_collabs` · `influencers` · `media_contacts` · `outreach_campaigns` · `outreach_touches` · `press_items` | Outreach sequences, media relations, influence and events. |
| **Studio & Agency** (14) | `approval_delegations` · `approvals` · `asset_versions` · `assets` · `brand_assets` · `copy_bank` · `creative_briefs` · `creative_requests` · `deliverable_comments` · `deliverables` · `engagements` · `invoices` · `portal_tokens` · `vendors` | Creative production and the client↔agency seam. |
| **Analytics** (7) | `dashboards` · `digest_log` · `metric_alerts` · `metric_snapshots` · `metric_targets` · `metrics` · `report_runs` | The measurement brain: catalog, snapshots, targets, alerts, boards, reports. |
| **Connective Tissue** (12) | `ad_spend` · `competitors` · `inbox_items` · `media_placements` · `media_plans` · `partner_campaigns` · `partners` · `promotions` · `referrals` · `sites` · `tracked_links` · `web_events` | Media plans, attribution, promotions, partners and first-party web analytics. |
| **Listening** (13) | `listening_alert_rules` · `listening_changes` · `osint_aliases` · `osint_case_items` · `osint_cases` · `osint_entities` · `osint_handle_candidates` · `osint_signal_entities` · `osint_signals` · `osint_sources` · `osint_theme_signals` · `osint_themes` · `osint_topics` | OSINT collection, validation, entities, evidence and the analyst's control room. |
| **Intelligence** (6) | `ai_cache` · `ai_runs` · `mmm_runs` · `mmm_weeks` · `search_budget` · `search_runs` | AI, live search and the quantitative models. |
| **Integrations** (1) | `integration_runs` | Third-party connectors and their run history. |
<!-- CENSUS:END -->

---

## 7. Decision log

Load-bearing calls, with the reasoning a future engineer would otherwise have to reconstruct.

| # | Decision | Why | Origin |
|---|---|---|---|
| D1 | Instance-per-client; shared-SaaS fork removed | Isolation as infrastructure, not policy | WAVE-3-BRIEF |
| D2 | Nine dependencies, defended | Supply-chain surface is a sellable property | RED-TEAM-BRIEF |
| D3 | AI's four laws enforced in code | An AI that can be wrong quietly is worse than none | W3·C |
| D4 | Live search feeds the validation pipeline, never bypasses it | Collection noise is a data-integrity defect, since signals reach the board pack | W3·D |
| D5 | ORG-only entity resolution | Private-individual profiling is out of bounds, permanently | W2·E |
| D6 | Forecasts are intervals; MMM refuses below its floor | Credibility compounds; false precision doesn't | W3·F/G |
| D7 | Departments are a dimension, not cloned tables | Cloning multiplies every future query | W3·H |
| D8 | Flow builder is pure UI over the same jsonb | A second execution path is a second truth | W3·B |
| D9 | One predicate evaluator (workflows · flow builder · segments) | Same reason as D8, one layer down | W4·B |
| D10 | Promotion over duplication (campaigns, segments, imports) | HELM-era objects exist; unify, never re-create | WAVE-4-BRIEF |
| D11 | Campaign is a metrics dimension, not a parallel rollup | Reuses snapshots, targets, pacing, board packs unchanged | W4·A |
| D12 | Arabic is written, not translated — and linted | Arabic-first is the founding promise; generic Arabic is a defect | W4·G |
| D13 | Documentation generated and CI-checked | Enforcement over vigilance, applied to prose | W4·H |
| D14 | Secrets encrypted with a per-instance key, AAD-bound per cell | A stolen dump alone must be useless, and a ciphertext must not be portable between rows | SEC·A |
| D17 | Campaign membership rides existing FKs via a registry — no join table | Two sources of membership truth can contradict | W4·A |
| D18 | Encrypt what we use, hash what we verify | Never encrypt what a hash suffices for; hashing magic links keeps existing links working | SEC·A |
| D15 | OIDC before SAML, SAML refused at the schema level | Same IdPs, no XML-DSig attack class, zero new deps | SEC·B |
| D19 | One break-glass account, mandatory before `ssoRequired` | An IdP outage must not lock an organisation out of its own instance | SEC·B |
| D16 | Erasure anonymises, never deletes | Erasure must not rewrite the board pack | SEC·C |
| D20 | Erasure confirms only by re-running discovery | Verified, not trusted | SEC·C |
| D21 | Erasure log stores hashed row refs | The log of an erasure must itself hold no personal data, and must enable replay after a restore | SEC·C |

---

## 8. Conventions

- **`crudRouter(opts)`** — `table, module, fields, listSql, getSql, orderBy, touchUpdatedAt, validate, validateCreate(data, req), validateUpdate(data, prev, req), afterWrite(req, action, id, data, prev)`. Department scoping and permission guards are inside it; do not re-implement either.
- **Identifiers are quoted camelCase** in SQL so the JSON contract stays stable.
- **`supabase/setup.sql` is rebuilt** (header + schema.sql + seed.sql) after any schema change — the test harness loads it directly, and skipping this breaks tests in ways that look unrelated.
- **Dictionary edits anchor on `= {`,** never the first `{` — a prior corruption inserted keys into a type annotation.
- **Test harness** (`backend/tests/verify-all.mjs`, PGlite): `j(method, path, body, token)`, `raw()`, `ok(name, cond)`, direct `db.query`; `H` = head admin, `A` = analyst (the 403 probe); new blocks splice before the `// Rate limiting LAST` marker; the rate-limit test stays last.
- **Audit before build** — every cluster opens with a grep + census of its prior art. Code has existed on disk while docs claimed otherwise three times (W1·F, W2·E P1, W3·D).
- **Bayan compliance** — user-facing Arabic follows `BAYAN.md`; `npm run lint:ar` must pass.

## 9. Commands

```bash
npm test                  # full suite (PGlite, no external services)
npm run db:apply          # apply schema
npm run seed / seed:demo  # generic seed / demo instance
npm run docs:census       # regenerate the census in ARCHITECTURE.md
npm run docs:check        # CI: census matches schema, every table classified
npm run lint:ar           # CI: Arabic glossary + dictionary compliance
```
