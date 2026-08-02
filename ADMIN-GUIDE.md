# Pulse Admin Guide — per-instance operations

The manual for whoever owns a running Pulse instance. Provisioning a *new* instance is
in `INSTALLER.md`; the product plan is `PULSE-MASTERPLAN.md`.

## Identity & branding (Settings → Identity)
Org names (AR/EN), logo URL, and the **accent color** live in Settings. One hex re-themes
the whole interface — buttons, focus rings, nav, even the login screen (branding there is
intentionally public). No logo? The Pulse ECG mark stands in.

## Currency
Money is stored dual-column (USD + local). The **local currency code and Arabic label**
are per-instance settings; the exchange rate is captured onto every lead and budget entry
at write time (`rateAtEntry`), so history survives rate changes.

## Business units
A free list used to organize campaigns, leads and budgets. Edit anytime in Settings.

## Module flags (Settings → Modules)
Territories a client didn't buy are switched off here: **AI Brain, Market Intel,
Listening, Social, Media & Influencers, Events, Planning/OKRs.** A disabled module
vanishes from navigation *and* its API returns 404 — enforcement is server-side. The
Daily Pulse cron skips disabled territories. Everything else (campaigns, content, leads,
customers, budget, tasks, analytics, report) is core and always on.

## Studio & Agencies (Wave 1)
- **Studio** — the creative intake queue (every request gets an SLA the Daily Pulse watches), the
  approved copy bank, the Brand Center (public rows appear at `/brand` — share it with any partner),
  and versioned assets: sending a version to review files an approval automatically.
- **Agencies** — register vendors once; their scorecard (on-time %, average revision rounds,
  approval rate, approved spend) fills itself from real deliverables and invoices.
- **The guest portal** — open a vendor, mint a magic link (1–365 days), send it. The vendor sees
  only their deliverables, submits work links, and replies to the thread — no account, no password.
  Revoke the link any time; every portal action lands in the audit trail as `portal:<vendor>`.
- **Approvals inbox** — invoices, asset versions, and deliverable submissions all wait in one
  place. Approving an invoice posts the spend to the budget at the invoice's captured rate;
  rejecting a deliverable sends it back as a revision round the scorecard remembers.

## Forms, Pages & Research (Wave 1)

- **Forms** (`[automate]` flag) — build capture forms in the UI; each is public at `/f/<slug>`.
  Submissions validate against your field definitions, then run the capture pipeline:
  a contact is found or created (consent recorded per channel, source `form:<slug>`),
  a lead is created when a phone is present (source FORM, campaign taken from the form or
  from a `?src=` tracked-link code), and the submission is stored with its `src`.
- **Landing pages** — block-based bilingual pages (HERO / TEXT / FEATURES / CTA) public at
  `/l/<slug>` once **PUBLISHED**; embed a form and every visit counts a view. Zero developer.
- **Surveys** (`[research]` flag) — NPS / CSAT / free surveys public at `/s/<slug>`.
  Scores compute server-side (NPS promoters−detractors, CSAT %≥4). `LINKED` audience
  surveys require the respondent's phone or email and bind the response to a contact.
- **Contacts** — the audience layer. Consent is an append-only ledger per channel
  (WhatsApp / Email / SMS / Call): grants and revocations are timestamped, sourced,
  audited, and never deleted — show it to a regulator.
- **Insights** — findings with source + impact, ordered HIGH-first; attach them to
  personas/products/briefs so research rewrites strategy instead of dying in a chart.
- All public surfaces are rate-limited, honeypotted, and `noindex`.

## Reach: outreach sequences, health & coverage (Wave 1)

The Reach page (التواصل) is where relationships are built on schedule, not on memory.

**Sequences.** A campaign is an audience (journalists, influencers, customers, or your
contact book) plus ordered steps — day 0 WhatsApp, day 3 call, day 7 email. Enroll targets
and Pulse mints one dated touch per step; anyone already in the sequence is skipped
automatically. On a WhatsApp step, **Send** renders the template with the target's name,
opens wa.me with the message ready, marks the touch sent, and updates the relationship's
last-contact date in the same motion. Log what happens with one tap: replied, declined,
or placed.

**Relationship health.** Every media contact sits in a bucket by recency — warm (<30
days), cooling (30–90), cold (>90). The Daily Pulse nudges you when planned touches come
due and when a tier-1 relationship has gone silent for 60+ days.

**Coverage reports.** Pick a period, hit compile, and Pulse assembles the branded
deliverable: press placed, listening signals, **share of voice against your competitors**,
and the outreach funnel (sent → replied → placed). Reports are immutable snapshots —
what you send the GM stays what you sent the GM.

**Competitors.** Register rivals once and bind each to a listening topic; their mentions
count automatically and feed the share-of-voice math everywhere.

## Automate: workflows, scoring & WhatsApp (Wave 1)

The Automate page (الأتمتة) turns repeated marketing motions into rules the system runs
for you — and shows its work.

**Workflows.** Each workflow is trigger → condition → actions, built from a curated
library: assign an owner, add a tag, create a task, start a whole process template, draft
a WhatsApp message, or notify people. Triggers fire when a lead is created, changes stage,
or a form is submitted; the filter narrows it (e.g., only `source = Exhibition`). Every
execution appears in the run log with a ✓/✗ per action — one failing action never blocks
the rest. Use **Test-fire** to rehearse a workflow safely; it writes a real, labeled run.

**Lead scoring.** Rules award points (source is Exhibition +35, value ≥ 100k +40, …) and
Pulse keeps every lead's score current — on each edit, whenever rules change, and nightly.
**70+ is hot**: the kanban card shows 🔥, and if a hot lead goes quiet for 3 days the
Daily Pulse pings its owner (once per day, not spam).

**WhatsApp templates.** Keep the messages that work in one library, in both languages,
with `{{contactName}}`-style merge fields. Pick a template + a lead, hit render, and Pulse
fills the fields, logs the send on the lead's timeline, and hands you a wa.me link that
opens WhatsApp with the message ready. Workflows can draft these automatically.

## Publish: the composer & bio pages (Wave 1)

The Publish page turns approved content into scheduled, measured posts. Compose a slot by
picking an **approved** content item, adapting it into a per-platform **variant** (captions
in both languages, hashtags, format) — approved lines from the copy bank insert straight
into the caption — then set the time, owner, and a tracked link.

**The queue's state machine.** A slot walks DRAFT → QUEUED → (AWAITING_APPROVAL →) READY →
NOTIFIED → PUBLISHED, or is SKIPPED. Only approved content can queue. "Request approval"
sends the slot through the same approvals inbox as invoices and deliverables; approval
releases it to READY, rejection returns it to DRAFT.

**Assisted publishing.** When a READY slot's time arrives, the nightly Daily Pulse notifies
its owner (PUBLISH_DUE) with the copy and link ready to go. The Share button opens the
device share sheet with caption + short link. After posting on the platform, hit
**"Mark published"** — Pulse creates the measurement row in Posts automatically (reach and
engagement can be filled then or updated later), and the on-time metric starts tracking.

**Bio pages.** Publish → Bio pages hosts your link-in-bio at `/b/:slug` with your accent
color. Every button routes through `/r/:code`, so each tap lands in the tracked-links
attribution and the `bio_taps_total` metric — visible per page in Analytics → Explore.

## Analytics & the Pulse Index (Wave 1)

The Analytics page is fronted by **مؤشر النبض — the Pulse Index**: a 0–100 composite of five
area pulses (Demand, Engagement, Brand, Customer, Ops). Every number drills down: each area
is a weighted, target-aware normalization of 4 catalog metrics, and every metric's formula,
unit, and direction live in the catalog (`GET /api/metrics`). Admins can rename metrics,
deactivate them, or tune composite weights via the catalog editor (`PATCH /api/metrics/:key`).

**The Daily Pulse (nightly cron).** Point your scheduler (e.g. Vercel Cron) at
`GET /api/cron/daily-pulse` with the `CRON_SECRET` bearer — the legacy `/api/cron/osint`
path runs the same orchestrator. Each run: materializes every active metric into
`metric_snapshots` (history, sparklines, movers), evaluates anomaly alerts, pushes hygiene
sweeps, then runs Intel ingestion (only that last part respects the Intel module flag).
Admins can trigger it manually from Analytics → "Run Daily Pulse now" or
`POST /api/metrics/run-daily`.

**Targets & alerts.** Targets give any KPI a period and a number; the board shows actual vs
expected-by-today vs pace%. Alerts watch a metric (ABOVE / BELOW / DELTA_PCT vs a trailing
window) and notify their audience — admins by default — at most once per 20 hours.

**Reports.** Analytics → Reports generates the immutable monthly board pack from snapshots
(22 metrics with month-over-month deltas), stored forever in `report_runs`.

**Win/loss.** Marking a lead LOST now requires a reason (price, timing, competitor, no
budget, no response, not a fit, other) — the kanban asks on drop, and the
`leads_lost_30d` metric slices by it.

## People, roles & security
- **Users** (admin-only): create accounts, deactivate leavers, force password rotation
  (the user can do nothing else until they change it).
- **Roles**: five built-ins (locked) + custom roles with per-module read/write.
- **2FA**: each user enables TOTP from the Security button; logins then require a code.
- **Sessions**: "Sign out everywhere" bumps the token version and revokes all sessions.
- Every write lands in the **audit trail** (Settings → audit).

## The Morning Pulse & connective tissue (Wave 1·G)

**صباح النبض** (`/morning`) is the daily ritual: the Pulse dial with its overnight delta, the
four lanes of today (tasks due, publishing, outreach touches, hot leads), yesterday's wins, and
alert chips. It's compiled at 05:00 by the Daily Pulse into `digest_log`; opened earlier, it
compiles live and notes it. Email delivery arrives with SMTP in Wave 2.

**Offline attribution** (`/media-plans`): create a plan, add each billboard/print placement with
its landing URL — Pulse mints a tracked short code and a locally-generated QR (no external
service). Print the QR on the artwork; every scan is a click on `/r/<code>`, attributed to the
placement and rolled up to the plan.

**Growth** (`/growth`): promotions are codes with a redemption counter (cashier taps "redeem");
referrals mint a personal short link per customer — clicks are counted, a lead can be attached,
and the nightly sweep flips the reward to EARNED the moment that lead is WON (planning users get
pinged). Partners hold co-op budgets and link to campaigns with a share percentage. Ad spend is
manual-first: each entry auto-writes a SPENT line into the campaign budget, so ROMI stays honest
without waiting for platform APIs.

**pulse.js** (`/web`): register a site, paste one line before `</body>`:
`<script defer src="https://<instance>/pulse.js" data-key="ps_…"></script>`.
Pageviews, referrers, UTMs and `?src=` tags flow into your own instance — first-party, no third
party. Custom events: `window.pulse("quote_request")`. Unknown or disabled keys are dropped
silently; collection is rate-limited and never breaks the client page.

**Self-filling OKRs**: under each objective in `/planning`, add key results bound to the metrics
catalog — they refresh themselves every night. Manual key results stay manual.

**Inbox v1** (`/inbox`): paste the DMs and comments that matter; one tap converts an interaction
into a lead carrying its social source. API ingest lands in Wave 2.

## Departments (Wave 3·H)

**A department is a slice, not a separate Pulse.** One instance, one set of tables, one upgrade —
departments cut across them. Cloning the system per department would double the maintenance forever
and split the very roll-up that makes it worth doing.

**Adopting them changes nothing until you want it to.** Create departments in
**Settings → الأقسام**, then assign people. **A user with no department sees everything their
permissions already allowed**, and **records with no department stay visible to everyone** — so
turning this on never hides work that was already there.

**What scoping actually enforces.** Once a user belongs to a department they see their own
department's records plus unassigned ones, and nothing else — on every list, and **not by guessing
an id either**: another department's record answers *not found*, because whether it exists is itself
information they aren't entitled to. They cannot edit or delete across the line, cannot move a
record into another department, and anything they create lands in their own automatically.

**Admins are never scoped.** Someone has to be able to see the whole instance, and admin status
comes from permissions, not from a role name.

**The roll-up is the point.** In Analytics, a department head sees their own row — leads, wins, open
tasks, spend. The GM sees every department side by side, plus what is still unassigned to anyone.
That comparison is the argument for departments; without it this would just be extra bookkeeping.

**Deleting a department never deletes its work.** The records survive and simply become unassigned,
visible to everyone again.

## Media-mix modelling (Wave 3·G)

**What this answers:** how much of your result each paid channel actually produced — beyond
last-click attribution, accounting for the fact that advertising keeps working after it runs and
that the tenth thousand dollars does less than the first.

**Read the readiness panel before anything else.** A trustworthy media-mix model needs roughly
**80 usable weekly observations** — about two years — plus channels whose spend genuinely varies.
Pulse tells you exactly where you stand: *"needs about 80 usable weekly observations; there are
34"*, with an estimated ready date. **This is the most useful thing on the screen right now**, and
it is deliberately more prominent than the model itself.

**A week counts only if it has both spend and an outcome.** Weeks with spend but nothing to relate
it to are marked unusable rather than quietly filling out the sample.

**Below the floor the model still runs — as *directional only*.** No cost-per-outcome figure, no
reallocation suggestion, and a caveat carrying the real numbers rather than a vague warning. That
restraint is the point: **a media-mix model's failure mode is not being unavailable, it is being
available and wrong** — quoted in a board meeting and moving a quarter of the budget on twenty weeks
of data.

**What is useful immediately, long before the floor:** the **saturation point** per channel. *"Meta
saturates around $X a week"* is actionable on its own — it tells you where extra spend stops
earning.

**Channels that always move together are reported as inseparable**, not split. If Meta and Google
spend rise and fall in step, no method can tell you which produced the result, and Pulse says so
instead of dividing the credit and letting you act on a number it invented.

**Diagnostics are shown by default:** R², holdout error on data the model never saw, the weeks used,
the adstock decay assumed. And no channel is ever credited with *destroying* demand — negative media
coefficients are almost always an artefact of collinearity, so the fit is constrained against them.

**Nothing here changes a budget.** Above the floor a reallocation may be suggested, always as a
range and always with its assumptions attached.

## Forecasting & budget scenarios (Wave 3·F)

**Everything here is a range.** A projection rendered as one number gets quoted back to you a month
later as a promise, so Pulse never shows one. Analytics displays the band, the target line, and how
many days remain — and **the width of the band is the message**: the wider it is, the less is known.

**It refuses more often than you might expect, and that is the design.**
- Fewer than 21 days of history → no forecast, and it says how much it needs.
- A series where the noise is as large as the trend → no forecast, and it says why. A smooth line
  drawn through pure noise is the most confidently misleading thing this product could ship.
- The trend is **damped**, so growth flattens rather than compounding forever. An undamped line
  extrapolated a month out is exactly how a plan becomes fiction.

**Will the target land?** Each live target gets a projected range and a rough probability, computed
from what the metric has actually been doing. A number between 40% and 70% means genuine
uncertainty — treat it that way rather than rounding it to a yes.

**Budget scenarios** answer *"what if we moved 25% from Meta to TikTok?"* using the cost per lead
each channel has really delivered — and the answer is a range with **its assumptions printed beside
it**, not buried. Read them: leads are attributed by share of spend rather than tracked source, and
a channel that looks cheap at its current size may simply not stay cheap at a larger one. The
scenario never touches a real budget.

**And Pulse checks its own homework.** `forecast_accuracy_30d` is **back-tested** — it forecasts
from a week ago and compares against what actually happened, including whether reality fell inside
the band it drew. If the forecasting is poor, that number will show it.

## AI-assisted listening (Wave 3·E)

Wave 2 made listening trustworthy. This makes it fast — **without spending the trust**. Every
feature here proposes; none of them decide.

**What people are actually saying.** Intel → **ما الذي يُقال فعلًا** groups your confirmed coverage
into recurring themes with volume, tone and the quotes behind each. This is the difference between
*"sentiment is −0.2"* — which tells a GM nothing — and *"delivery delays, price increases, one
product defect"*, which tells them what to do on Monday. A theme the model cannot point at evidence
for is discarded, and themes rising against their own previous period are marked **صاعد**.

**Help with the genuinely ambiguous.** The keyword gate is decisive at the extremes and weakest in
the middle, so only signals scoring between 0.35 and 0.65 are sent to the model — which keeps the
cost small by design. It is told that Arabic names are often ordinary words (*سارية* is a flagpole,
*النيل* is a river and half of Sudanese commerce) and may answer **UNSURE** rather than guess.

**The verdict sits beside your queue, never inside it.** An AI opinion never changes a signal's
review status. Analysts' rulings are the ground truth that tunes the thresholds, so letting a model
mark its own homework would quietly destroy the measurement. Instead Pulse reports **how often the
model agreed with your analysts** — measured over signals a human actually ruled on, and shown under
the themes panel. If that number is poor, you will see it.

**The gate learns from you.** Every confirm and reject is a label, so Pulse proposes terms that
would have separated them — with the evidence each term came from. Proposals are stored for review;
they are never applied to your topic automatically.

**Competitor briefs are refused when the coverage is thin.** A brief is drafted only from
**corroborated** stories — two independent sources, owner-aware. The corroboration engine exists
precisely so a model cannot launder a single-source rumour into a board pack, and you will get an
explicit refusal rather than a confident paragraph.

## Live search (Wave 3·D)

### What this is, and what it honestly isn't
Pulse can search the open web and some social platforms on demand. It **cannot** replicate Grok's
access to X, and no amount of engineering changes that — xAI owns X, and that access is the product.
Since February 2026 the X API is pay-per-use with no free tier (roughly half a cent per post read),
and full-archive search is enterprise-priced in the tens of thousands per month. What Pulse offers
is what a mid-market client can afford and lawfully run.

**Providers.** The **web** provider is the default and rides the AI assistant, so answers come back
grounded and cited. **X** is metered — use it for a handful of high-value queries, not a firehose.
**Reddit** and **YouTube** are free. Your own accounts' comments and messages already arrive through
the connectors.

### The rule that matters most
**Live results do not skip the validation pipeline — they feed it.** Anything found enters as a
signal and passes source registration, near-duplicate clustering, the relevance gate, the review
queue, entity resolution and corroboration, exactly as an RSS item does. A search that pulls fifteen
results may keep six and hold four for review — and that is the system working. Real-time noise
reaching your Pulse Index unfiltered is precisely the defect the listening work was built to fix.
**Speed is not a reason to lower the evidence bar.**

### Budgets are not optional
Pay-per-use with no ceiling is how a client receives a surprise invoice. Each paid provider has a
**monthly cap** (Intel → البحث المباشر). When a provider reaches its cap it stops, and the search
**falls back to a free provider** rather than failing. Spend, cap and percentage are visible per
provider, and every query is logged with its provider, result count, how many were kept, what it
cost and who ran it.

### Ask your listening
The question box answers from **what has already been collected**, in your own language, citing the
signals it used. If the corpus doesn't support an answer, it says so and tells you how many signals
it had — rather than inventing one. The same rule as everywhere else in Pulse: grounded, or silent.

### What we won't do
Official APIs and public pages only. `robots.txt` respected. Never authenticate to a platform in
order to scrape it, never bypass a paywall, and **no third-party X mirrors** — they are cheap
precisely because they violate platform terms, and your accounts are not ours to risk.

## The AI assistant (Wave 3·C)

Pulse can use a model — under four rules that are enforced in code, not left to whoever writes the
next prompt.

**1 · It drafts; you dispose.** Every AI output lands as a **مسودّة**. An explanation of a metric
move appears in Analytics as a draft with the evidence it used; it is **not** in your insight list
and does not reach a board pack until you press *اعتمدها*. Dismissing it is one press too.

**2 · Grounded, or silent.** The model is handed the specific rows it may reason over — the metric's
own recent shape, other metrics that moved in the same window, spend changes, listening signals,
publishing gaps — and must cite them. **An answer that cites nothing, or cites evidence it was never
given, is discarded rather than shown.** If the data doesn't support an answer, "not enough
evidence" is the answer. A model that invents a plausible reason for a drop is worse than no
explanation, because it will be believed.

**3 · Bounded cost.** Set a monthly ceiling in **Settings → المساعد الذكي**. The cap is checked
*before* each call, so nothing is ever spent past it — features simply become unavailable and say
so. Identical questions over identical evidence are answered from cache for free. The card shows
spend against the ceiling and warns at 80%.

**4 · Never for certain things, by construction.** The assistant cannot be pointed at profiling a
private individual, at sending WhatsApp messages, or at ruling the listening review queue. Those
requests are refused before a request is even built — analyst rulings in particular are the ground
truth that tunes the system, so a model may recommend but never rule.

**What it does today.** Explains why a metric alert fired, as up to three ranked competing
explanations with citations (open Analytics → the alerts panel) · drafts a creative brief from a
request plus your brand's own tone entries and approved copy · writes the Morning Pulse in two or
three sentences over numbers already computed.

**Your key never leaves the server** — it is stored masked and never returned to a browser, the same
as every other integration secret.

## The flow builder (Wave 3·B)

Workflows used to be a list of steps that always ran in order. Now they are a path you draw — and
crucially, **the same engine runs it**. The canvas writes exactly the structure the runner has
always read, so a flow you draw and a flow written before the builder existed are the same kind of
thing. Nothing you already built changed or needs migrating.

**Branching.** Add a **تفرّع** node and it forks into two rails: *إذا تحقق* and *إن لم يتحقق*.
Test any lead field — value, stage, source, business unit — with the same comparisons the scoring
rules use, so "at least" means the same thing in both places. Branches can sit inside branches, up
to five deep.

**Try it before you trust it.** Press **جرّبه على عميل حقيقي** and Pulse replays the whole flow
against a real recent lead, showing which branch it would take and what each step would do —
*"would add tag big-deal"*, *"would create task Call them"* — **without doing any of it**. No tag
is added, no task appears, nothing is assigned. This is the button to press before turning a flow
on, and it is the reason a non-technical colleague can build one safely.

**Broken flows are refused at save time**, in front of the person who can fix them, rather than
failing silently at 3am: a branch with nothing on either side, a test missing its field or its
value, an unknown comparison, a step referencing an action that doesn't exist. The error says which.

**The audit answers *why*, not just *what*.** Every run records the branch it took and the test that
decided it — *"valueUsd gte 5000 → then"*. When someone asks why a particular lead never got its
follow-up task, the run log tells you.

**Two behaviours worth knowing.** A test against a field the event doesn't carry is **false**, not
an error — the flow takes the *no* path and carries on. And one failing step never stops the rest:
the failure is recorded and the flow continues, exactly as before.

**The palette builds itself.** The available steps come from the engine's own registry, so any new
action added to Pulse appears in the builder automatically.

## System health & faults (Wave 3·A)

Until now, when something broke, the error reached the server console and stopped there — which on
a serverless host means it was gone before anyone asked about it. **حالة النظام** (admin only) is
where that question gets answered.

**Health at a glance.** Database, Daily Pulse (and how many days since it last ran), auto-publish,
connector failures in the last day, fault count, storage driver, mail. Green or red per subsystem,
with the number beside it. `GET /api/health` returns the same picture without a login and answers
**503 when the instance is genuinely unhealthy** — point an uptime monitor at it.

**Faults, grouped by cause.** One recurring bug appears as a single row with a count and a
last-seen time, not a thousand identical lines. Open a group to see the individual occurrences with
their stack traces. Server faults (🖥) and browser faults (🌐) are kept apart — the browser ones
arrive from a beacon in the app, because half of "it's broken" is a render error the server never
saw at all.

**Every response now carries a request id** (`X-Request-Id`, and in the error body). When a user
says "it failed", ask them for that id — it goes straight to the occurrence.

**What is deliberately not logged.** The fault log records a request's **shape and a hash** — how
many fields, which field names, a digest — and **never its contents**. Request bodies in this
product carry customer names, phone numbers and messages; a log that quietly becomes a second copy
of your CRM is a liability, not observability.

**Retention.** Faults older than 90 days are pruned nightly. Logs that grow forever are how a small
database dies.

## Files & storage (Wave 2·C)

**Two drivers, one contract.** Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (plus optional
`SUPABASE_BUCKET`, default `pulse`) and uploads go to Supabase Storage. Set neither and the bytes
live in your own Postgres. **Nothing is blocked on a third party** — a self-hosted or offline
instance uploads, serves and versions files exactly the same way, and the URLs handed to the rest
of the product are identical either way. Settings → التخزين shows which driver is live and how
much space is in use.

**The media library** (`/library`) is where everything lives. Drag files onto the drop zone —
several at once — then search by name, filter by family (images, video, docs, audio, archives) and
click any file to see it full size, copy its link, rename it, or switch it between public and
private. Images show as thumbnails, so the library reads as a library rather than a list of names.

**Uploading elsewhere.** The ↥ button also appears wherever a URL is wanted: the org logo,
brand-centre assets, and asset versions in Studio. Files go up as a raw body — no multipart, no
plugin — capped at **50 MB each** (override with `MAX_UPLOAD_MB`). Every file is SHA-256 hashed on
arrival, which is what makes evidence integrity possible later.

**Deletion asks first.** Every file knows where it is used — assets, versions, brand-centre
entries, bio links, the org logo — and refuses to delete while something still points at it. The
dialog lists exactly what, and you can override deliberately. A library you cannot safely delete
from is just a junk drawer.

**Public and private.** Brand assets and anything a platform must fetch are public and get a
stable URL. Everything else gets a **signed link that expires after an hour**; sharing that link
after it lapses gives a 403, not the file. Tampering with the signature fails the same way.

**Versions.** In Studio, each upload against an asset becomes the next version (v1 → v2 → v3),
each keeping its own file, so approving v3 never overwrites what v2 was.

**⚠ Auto-publishing with media.** Platforms fetch media themselves, so they need an address that
resolves from outside. **Set `PUBLIC_URL` to your instance's public address.** Without it, a post
carrying an uploaded image fails with exactly that message rather than sending Meta a link it
cannot open — Instagram in particular will not accept a text-only post at all.

**Backups.** The sovereign backup exports the file *catalogue* — names, hashes, sizes, entities —
not the bytes, which would make a JSON export unusable. Object storage keeps its own copies; on the
DB driver a normal Postgres dump carries the files with it.

## Validated listening (Wave 2·E · Phase 1)

Listening used to keep anything that matched a keyword and wasn't an exact duplicate. Those rows
feed share-of-voice, which feeds the metrics catalog, the Pulse Index and the board pack — so noise
in collection became noise in the numbers. Phase 1 puts three gates between a headline and a KPI.

**1 · Source reliability (Admiralty Code).** Every domain that appears is registered automatically
at **D — "not usually reliable"**. Nothing is trusted for being famous. In Intel → **سجل المصادر**,
grade a source A–F in one tap; the grade maps to a credibility score (A→1 … F→6) and immediately
re-grades every signal already collected from it. You only need to rate the handful of sources that
actually matter to you. Sources can also be pre-registered before they are first seen.

**2 · Syndication counts once.** Near-duplicate detection (SimHash + Jaccard) groups the same story
across outlets into one cluster. The earliest copy is canonical and is the only one counted; the
rest carry a **×N** badge showing how many outlets ran it. **This is the fix that matters most for
share of voice** — one press release republished twelve times used to look like twelve mentions.

**3 · The relevance gate and the review queue.** Each topic can declare `mustInclude`,
`mustExclude` and `contextTerms`. A hit that trips an exclusion or misses a required term scores
low and is **quarantined as PENDING — counted in nothing** — until a human rules on it in the
review queue at the top of Intel. Confirm or drop; the decision is recorded.
This is what stops *سارية* (which also means *flagpole*, and is a common given name) from inflating
your numbers.

**Precision is measured, not claimed.** Because analysts rule on quarantined items, Pulse reports
real precision per topic (confirmed ÷ ruled) in the source registry card, alongside the KPIs
`signal_precision_30d` and `corroborated_share_30d` (a story is corroborated when its cluster spans
two or more independent domains).

**Existing history.** Run **backfill** once (`POST /api/osint/backfill`) to hash, cluster and grade
signals collected before this release. It is idempotent, and old rows are marked AUTO so nothing
disappears from history.

**What still shows everything.** The signal list hides rejected items and syndicated copies so that
what you read matches what is counted; append `?include=all` to audit exactly what was filtered and
why.

## Entities, honest sentiment & evidence (Wave 2·E · Phases 2–3)

**Mentions belong to organisations, not keywords.** In Intel → **الكيانات وحصة الصوت**, register
your own entity (mark it ⭐) and your competitors, then give each one every spelling it really
appears under: Arabic, English, transliterated, abbreviated, even a common misspelling. Matching is
Arabic-aware — diacritics, the four alef forms, ta-marbuta, tatweel and Arabic-Indic digits all
fold together, and the prefixes Arabic glues on (و، ال، بال، لل) are stripped before comparing.
Without that, *"سارية"* and *"ساريه"* are different strings and half your mentions vanish.

**Share of voice is then computed from entities**, over canonical, non-rejected signals only — so
neither syndication nor quarantined noise can inflate anyone's share.

**Sentiment reads per entity, and may abstain.** One article can praise you and criticise a rival
in the same breath; Pulse splits on the contrast markers Arabic actually uses (*في المقابل، لكن،
بينما*) and reads only the clause each entity stands in. If that clause says nothing about them,
it returns **unclear** rather than borrowing the verdict formed about somebody else. Every reading
carries a confidence, and anything below 0.4 shows as unresolved instead of a false POS/NEG. The
dialect vocabulary Sudanese customers actually use — *قطوعات، غلاء، زفت، تمام* — is included.

**Evidence: links die, claims shouldn't.** Open any signal's **⚖** button for the full chain —
which source and how it's rated, whether this copy is canonical and how many outlets carried it,
who reviewed it, how each entity was matched, and what the sentiment confidence was. Press
**احفظ نسخة موثّقة** to preserve the page: Pulse fetches it, extracts the text, records who
captured it and when, hashes it with SHA-256 and stores it as a **private** file. If the source is
unreachable the snapshot is kept anyway and honestly marked *partial*.

**Case files** gather evidence around a question — *"did the competitor really cut prices in Port
Sudan?"* — rather than a keyword. Add signals and entities, read them as a timeline, and close the
case with a conclusion. That is what turns a chat thread into something citable.

**Guardrail.** Entities may only be organisations, brands, products, outlets, or **spokespeople
acting officially**. The API rejects anything else outright. Pulse is a marketing platform; it does
not build profiles of private individuals, and it cannot be made to.

## Discovery, corroboration & self-tuning (Wave 2·E · Phase 4)

**Finding an organisation's accounts.** Open an entity's aliases and press
**ابحث عن حسابات هذه المؤسسة**. Pulse guesses the handles a company plausibly uses from its own
name, checks the public profile pages one at a time with a pause between, and scores each hit on
name similarity and page content. **It proposes; you dispose** — nothing binds to the entity until
you press ✓, and a confirmed handle then starts resolving `@mentions` automatically.

It never logs in to any platform to look, and it will not run against a person: pointing discovery
at a spokesperson entity returns an explicit refusal. Finding an organisation's public accounts is
research; enumerating an individual's is surveillance, and this platform does not do it.

**Corroboration — two independent legs, or say so.** A story is corroborated when **two sources
that are genuinely independent** carry it. Independence is judged by *owner*, not masthead: a media
group's six brands republishing one wire report count as **one** source, which is why the source
registry has an owner-group field. Anything standing on a single source is chipped
**مصدر واحد** in the signal list rather than being hidden — you are told what you have, and left to
judge it. The nightly run keeps this current.

**The system tunes itself, and shows its working.** Every confirm and reject in the review queue is
a label. Pulse replays your rulings against every candidate threshold, finds the one that would
have served you best, and recommends it with the precision gain in plain numbers — but only once
there are enough rulings to mean anything, and it says so when there aren't. Press **طبّق** to
accept. Nothing here claims an accuracy figure the system did not measure against your own
decisions.

## Auto-publishing & platform sync (Wave 2·D)

**Connecting a page.** Social → add an account (FACEBOOK, INSTAGRAM, TIKTOK or GOOGLE), paste the
token and the platform's own id (page id, IG business id, ad account id), then press
**تحقق من الاتصال**. That call is the acceptance test — it uses your real credentials and returns
the verified name, or the platform's exact error.

**Auto-publish.** Toggle **⚡ نشر تلقائي** on an account. From then on, any scheduled post that
reaches READY at its time is published straight to the platform, and the queue shows a link to the
live post. Accounts with the toggle off keep today's behaviour exactly: Pulse notifies a human, who
posts manually. **The approval chain is unchanged** — nothing publishes that wasn't approved first.

**When a post fails** it stays READY with the platform's reason shown inline, and the assignee is
notified. Nothing is silently lost. The commonest cause is Instagram: it will not accept a
text-only post, so a variant without an image fails by design rather than pretending.

**The heartbeat.** The 05:00 Daily Pulse cannot honour a 2 PM slot, so auto-publishing runs on its
own 15-minute cron (`/api/cron/publish-tick`). **Sub-daily crons need a paid Vercel plan.** On the
hobby tier the tick also runs inside the nightly Daily Pulse, so posts still go out — just not to
the minute. Both paths are idempotent: a post already published is never published twice.

**Metrics and paid spend** are pulled nightly for every connected account that supports them.
Synced spend rows carry a **SYNC** badge in Growth. Pulse matches the platform's campaign name to a
Pulse campaign automatically; when it can't, the row is kept and flagged amber for you to map by
hand rather than dropped. **The budget ledger is written only on the first sync of a given
platform-campaign-day** — re-syncing corrects the figures without charging the campaign twice.

**Google Ads** stays dormant until an approved developer token is in Settings → التكاملات; verify
will tell you so plainly instead of failing obscurely. **TikTok** publishes and reports metrics, but
its comment and DM APIs need restricted-tier approval, so its inbox capability is switched off —
the interface only offers what the platform actually grants.

## WhatsApp Business & the connector layer (Wave 2·B)

**Settings → التكاملات.** Paste the verify token and app secret from your Meta app, save, then
copy the **webhook URL** shown there into Meta → WhatsApp → Configuration. Meta calls it once to
verify (Pulse echoes the challenge only if the token matches) and then delivers every inbound
message to it.

**Connect the number.** Social → add an account with platform **WA**, handle = the business
number, access token = the permanent token, external id = the **phone number id** from Meta.
Then press **تحقق من الاتصال**. Verification is the acceptance test: it calls Meta with your real
credentials and reports the verified business name back, or the exact error if not.

**Inbound.** Messages arrive in **الوارد** tagged `API`, deduplicated by Meta's message id — if
Meta redelivers (it does, often), nothing duplicates. Every webhook is signature-checked against
the raw request body; unsigned or wrongly-signed calls are rejected with 401 and recorded.

**The 24-hour rule — this is Meta policy, not a Pulse preference.** You may reply in free text only
within 24 hours of the customer's last message. Outside it, you must use a **template approved by
Meta**. Pulse enforces this server-side: the reply box shows the window state, offers free text
while it's open, and switches to the approved-template picker once it closes. Attempting free text
outside the window is refused by the API even if the interface is bypassed. Set each template's
approved name in Automate → WhatsApp templates (`waTemplateName`) — templates without one are
hidden from the picker because they would be rejected by Meta anyway.

**Tokens expire.** The Daily Pulse warns module owners seven days ahead when an account has a
recorded expiry.

**Everything is logged.** Settings → التكاملات shows the recent activity feed: verification,
webhooks, sends, with the platform's own error text when something fails.

## Outbound mail (Wave 2·A)

**Settings → البريد الصادر.** Pick a rail, save, then press **إرسال رسالة تجريبية** — it mails the
logged-in admin and reports exactly what happened.

**Rail 1 — Email API (Resend), recommended.** Paste an API key and a verified from-address.
Serverless hosts (Vercel included) throttle or block SMTP ports outright, so HTTP delivery is
markedly more reliable in production. Under Advanced you can point the endpoint at any
Resend-compatible API or an internal proxy; blank uses `https://api.resend.com/emails`.
Requests time out after 15 seconds so a wedged provider can never hold the nightly run hostage.

**Rail 2 — Your own SMTP.** Host, port, username, password, from. Use **587 with TLS**; tick
"اتصال مُشفّر" only if your provider demands implicit TLS on 465. Choose this when mail must stay
inside your own infrastructure.

**Log mode.** With neither rail configured, every message is recorded in `mail_log` and nothing
is sent. Deliberate: a fresh instance must never fail its first nightly run, and you can see what
*would* have gone out.

**Secrets never come back.** The SMTP password and the API key are stored server-side; the API
returns only `hasPass` / `hasKey`. Leaving either field blank on save keeps the stored value — so
you can edit the from-name without retyping a secret.

**Who receives the Morning Pulse.** Nobody, until they opt in: Users → the ✉ toggle on each row.
The 05:00 Daily Pulse mails today's briefing to every opted-in active user, at most once per
person per day however many times the run is retried. Failures are written to `mail_log` with the
provider's error text and never interrupt the rest of the night's work.

**Environment override.** `RESEND_API_KEY` (or `SMTP_URL`) plus optional `SMTP_FROM` /
`SMTP_FROM_NAME` override the stored settings entirely — useful for staging instances that must
not mail real people.

## The Daily Pulse (05:00 cron)
Vercel Cron calls `/api/cron/osint` with `CRON_SECRET`: refreshes market intel, pushes
listening alerts, and runs the hygiene sweep (stale leads, overdue tasks, customer review
cadences). Manual refresh is always available in-app.

## Backup & restore (Settings → Sovereign backup)
- **Backup** downloads a single JSON of all operational tables (passwords excluded).
- **Restore** replays a backup in FK-safe order — for migrations or disaster recovery.
- Belt-and-braces: Supabase's own PITR/backups on the database project.

## Upgrading
Pull the release; run `supabase/migrations/APPLY-LATEST.sql` once in the SQL Editor.
Idempotent — running twice is safe. Existing instances never re-trigger the wizard.

## The demo dataset
`supabase/seed-demo.sql` = the Saria flagship demo (password `Pulse@2026`). It **wipes
app data** first — demo instances only, never a live client.

## Environment variables
| Var | Purpose |
|---|---|
| `DATABASE_URL` | pooled Supabase URI (6543) — required |
| `JWT_SECRET` | signs sessions — required, long & random |
| `CRON_SECRET` | guards the scheduled Daily Pulse |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | optional — the AI Brain |
| `ALLOWED_ORIGINS` | optional CORS allow-list (default same-origin) |
| `PGSSL=disable` | local non-SSL Postgres only |
