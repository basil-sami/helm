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

### Stage 2 — earned numbers above the floor (W3·G2)

Once the data floor is met, four more disciplines apply before a number reaches you:

**The skill gate.** Enough history proves you *have* data, not that the model *learned* anything. The reallocation suggestion appears only when the fit predicts the held-out weeks better than simply guessing the historical average. Fail that, and the panel says so plainly — "does not beat the naive baseline yet" — with both error figures shown, and no recommendation is made.

**Ranges are resampled, never asserted.** Each cost-per-outcome now carries a **range** built by refitting the model on ~120 resampled versions of your own weeks (in blocks, because weeks echo each other). The run stores its random seed, so any range can be reproduced exactly on demand.

**A channel can abstain by itself.** If a channel's effect is not material in at least 70% of resamples, its range is **withheld** with the reason shown — even when the run as a whole passed every gate. The old point estimate stays visible for continuity; the range is the number that carries authority.

**The suggestion walks the curves, capped.** Reallocation follows the fitted saturation curves — moving money to where the *next* dollar earns most, not where the average dollar did — while conserving your total weekly budget to the cent and never shifting any channel more than **±25%** from where it runs today, because the model is only trusted near where it was fit. The projected gain is a resampled band per week (and over 12 weeks), and as ever: it is a suggestion for a human to weigh — no budget is changed.


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

---

## Campaigns: the war room (Wave 4·A)

A campaign is where the work lives. Open **Campaigns → any campaign → Room** to see, on one screen: everything attached to it across the platform, the budget against what has actually been spent, the leads it produced, and the cost per lead and return.

**Attaching work.** Anything with a campaign field — content, scheduled posts, landing pages, forms, surveys, outreach, press, events, creative requests, media plans, promotions, tracked links, collaborations, insights — joins the campaign by choosing it on that item. There is no separate "add to campaign" list to keep in sync.

**The lifecycle.** `PLANNING → ACTIVE → PAUSED / COMPLETED → ARCHIVED`.
- A campaign **cannot be activated without a brief**. Open the campaign → Brief.
- Illegal moves are refused with an explanation (planning cannot jump to completed).
- Completing a campaign closes it and asks for the learnings.

**The retrospective.** On completion, Pulse assembles the facts — what shipped, what was spent, what came back, why leads were lost — and, if AI is enabled, drafts a retrospective from those rows and nothing else. If the evidence is thin, it says so rather than inventing a story. **The draft is a draft: your edit is what gets kept.**

**Per-campaign numbers.** Campaign is a reporting dimension, so campaign slices appear in Analytics wherever a metric supports them (`/metrics/leads_new_30d/slices?dim=campaign`) and flow into targets and board packs like any other slice.

## The Arabic language system — Bayan (بيان)

Pulse's Arabic is written, not translated, and the rules are enforced automatically.
- `BAYAN.md` is the charter: register, terminology, numerals, dates, punctuation, plurals.
- `frontend/src/locales/glossary.json` holds one canonical Arabic term per concept.
- `npm run lint:ar` fails the build on transliteration, bureaucratic passive, untranslated values, or a banned term.

To change a term everywhere, edit `glossary.json` and the dictionary — never one screen at a time.
**Numerals:** data uses Western digits for scannability; Arabic-Indic digits are reserved for editorial and brand moments. **Dates:** Gregorian with hijri alongside, never hijri alone.

## Keeping the documentation honest

`ARCHITECTURE.md` is the single technical map. Its table census is generated, not written:

```bash
npm run docs:census   # regenerate after any schema change
npm run docs:check    # CI: census matches schema, every table classified
```

A migration that adds a table without declaring its territory fails the build.

---

## Importing your data (Wave 4·B)

**Settings → Imports** (or `POST /api/imports`). Paste or upload a CSV and Pulse walks five steps, none of which can be skipped:

1. **Upload** — the header row is read and columns are matched to fields by name automatically. Quoted values containing commas are handled correctly.
2. **Map** — confirm which column feeds which field. Required fields must be mapped or the step is refused, naming the field.
3. **Validate** — every row is typed and checked. Bad rows are reported **by line number and reason**; they do not silently disappear.
4. **Preview** — exactly what the commit will do: how many will be created, updated and skipped, and which rows are duplicates of each other or of records you already hold.
5. **Commit** — the import runs, and the raw file is discarded.

**Duplicates.** Choose the matching field (email, phone or company) and a strategy: **skip** (leave existing records alone), **update** (overwrite from the file), or **merge** (fill blanks only, never overwrite good data with empty cells).

**Consent.** Set the lawful basis and source before committing. Every contact the import creates carries that consent record — it is captured at the moment of import, not assumed afterwards.

**Committing twice is refused.** If you click again, Pulse tells you the import is already committed rather than importing everything a second time.

## Segments that target, not just describe (Wave 4·B)

A segment can now carry a **definition** — conditions on your data — which makes it a live audience instead of a label:

> Leads · source is IMPORT · value ≥ 5,000

Press **Preview** to see the count before saving, and **Members** to see who is in it. Segments without a definition keep working exactly as before as descriptive records. A segment may only test approved fields; anything else is refused.

## Conversions and the follow-up clock (Wave 4·C)

**Conversions** are where money is recorded. Add one against a lead or customer with the amount and date; campaign attribution is inherited from the lead automatically. Several purchases mean several conversions — that is the point.

This unlocks real return figures: **Marketing ROI % (90d)**, **Realised value (30d)** (sliced per campaign), plus **Follow-up on time %** and **Active campaigns** in the metrics catalog.

**The follow-up clock.** Assign a lead and Pulse starts an SLA timer (default 48 hours, set in Settings). Mark it contacted and the clock stops. If the deadline passes, the nightly Daily Pulse notifies the owner **once** and escalates to their department head. Overdue leads are listed at **Leads → Due**.

---

## The calendar, and the season (Wave 4·D)

The calendar now carries five layers: content, events, campaign spans, the **publishing queue**, and the **season**.

**Seasonal packs** ship with two sets — the Islamic calendar (Ramadan, both Eids, Hijri New Year) and Sudan (Independence Day, back-to-school). Religious dates are stored as hijri month and day and resolved to the correct Gregorian date **for each year**, so Ramadan moves as it should instead of drifting.

Each seasonal entry also carries a **prep date** — how far ahead marketing should start. That is usually the date that matters more than the holiday itself.

Packs are data, not assumptions. In **Settings → Seasonal**, deactivate what does not apply and add your own market's dates; nothing in the software needs to change.

## Approvals that do not stall (Wave 4·D)

**Delegation.** Going away? **Approvals → Delegate** hands your approvals to a colleague for a date window. They decide in your place while it is open, and only then. Two overlapping delegations for the same approver are refused, so it is always clear who holds authority.

**Escalation.** An approval waiting longer than the limit in Settings (default 48 hours) is escalated by the nightly Daily Pulse — once — to the approver's delegates and their department head. You are not nagged nightly about the same item.

**Bulk decisions.** Select several approvals and decide them together. Each is processed exactly as if decided one at a time: same permission checks, same side-effects (an approved invoice still releases its budget entry), same audit trail. Items already decided are reported as skipped rather than silently overwritten.

## The finance model — one nerve (W5·NERVE)

**Budget** now opens with the money truth in one triad per campaign: **المخطط** (the envelope you set on the campaign), **الملتزم** (invoices on the desk awaiting signature, plus booked outdoor placements), and **المصروف** (ad spend plus every SPENT ledger entry — approved agency invoices flow in automatically through the existing release rail, so nothing is ever counted twice). Each campaign shows a two-tone bar — dark for spent, amber for committed — with a health pill: **ضمن الحد** under 90%, **اقترب من الحد** from 90%, **تجاوز الحد** at 100%. Money Pulse cannot link to a campaign is shown as its own honest line — *"link these rows to their campaigns to complete the nerve"* — never hidden and never guessed into a campaign.

**Control lives at the signature.** When an invoice reaches the approvals inbox, its preview now states plainly: *"this approval takes «campaign» to N% of its envelope"* — plain ink when comfortable, amber from 90%, clay past 100%. Pulse informs; the signature stays yours.

**Strategy closes the loop.** Every objective in **Planning** can link its campaigns; the objective card then carries a nerve line — the campaigns it drives and their combined spent + committed against planned — so strategy, money, execution, and outcome read as one sentence. The campaign nerve itself (`/api/nerve`) counts everything a campaign touches: content, slots, leads, links, forms, events, placements, spend, invoices, tasks, and the objectives it serves.

## Wave 3, in your hands (W3·FIN)

**Draw your automations.** In Automate, the workflow editor is a canvas: chain actions, add a ◆ branch — *if the lead's source is EXPO, notify the desk; otherwise tag it* — and **dry-run the whole flow against a real lead before saving**: Pulse shows which branch would fire and what each step would do, changing nothing. The flow you draw is the flow that runs; there is no second engine.

**Forecasts that refuse before they guess.** Ask for a metric's outlook and Pulse answers in a **range**, never a single number — and below 21 observations it declines outright and tells you exactly how much history it needs. A refusal is the platform protecting your decisions from confident noise.

**The adviser drafts; you dispose.** Everything المستشار الذكي produces waits on the drafts shelf until a person publishes or dismisses it — those are the only two verbs. Its posture is always inspectable: configured or not, which model, the monthly ceiling, and spend against it.

**Faults leave fingerprints, never payloads.** When something breaks — even in the browser — it lands on the error ledger as a fingerprint and a digest; the data itself is structurally absent. And **department scoping is everywhere**: a department-bound teammate sees their rows and the shared ones, while the GM sees across the group.

## Build your own metric boards (UI·DEBT4)## Build your own metric boards (UI·DEBT4)

At the top of Analytics, **your boards**: the shared «لوحة الإدارة» is already hanging, and 🧱 build mode lets you make your own. Add a widget by picking any metric from the catalog — the same catalog, the same numbers, that the board pack and the Pulse Index read; a board can never show a figure the platform cannot stand behind. Choose a plain number or a number with its 90-day trend, make it wide if it deserves the room, reorder with a tap, rename in both languages, and share when the desk should see it. Deleting a board deletes only the arrangement — the metrics stay in the catalog.

## The listening control room (UI·DEBT3)## The listening control room (UI·DEBT3)

Tap 🎛 on the Listening page and the pipeline's controls appear — with the fixed line printed at the top: **organizations, brands, products, outlets, and official spokespeople only; no control can widen this.** From there: tune the **review band** (what the model is unsure about goes to a human) — and Pulse always shows you what the change *would have done* to the last week before you apply it, with your reason kept on the trail. Grade **sources** A–F; a regrade demands a written reason, always. Two levers per source, for two different problems: **block** stops collection entirely; **mute** keeps collecting for the evidence file but hides the source from alerts and metrics. Work the **review list** in bulk — assign to a colleague, confirm or reject with one reason — and each ruling's toast tells you how often the model's suggestion matched yours (the suggestion is a 🤖 chip, never a ruling). Build **alert rules** — volume spikes, negative bursts, grade-A mentions, emerging topics, optionally only when two independent sources agree — and ask «ما الذي سينطلق؟» to dry-run them without notifying anyone. Every change lands on the **trail**, so when a chart jumps, the room can tell you why.

## Bring your spreadsheets## Bring your spreadsheets — the import wizard (UI·DEBT2)

Day one at any company starts with existing lists, so **Leads, Contacts, and Customers each carry an ⬆ import button** now. Paste your CSV or pick the file; Pulse reads the headers and guesses the column mapping — you confirm it, with required fields marked ●. Choose what counts as a duplicate (email or phone) and what to do on a match: **fill blanks only** — never overwrite what you already know — or skip the row. Then three honest steps: **check** (bad rows are named one by one — a wrong number in one line rejects that line, never your whole file), **preview** (how many will be created, how many will update existing records — before anything happens), and **run**. The result says exactly what happened: created, updated, skipped. Importing contacts also records the consent basis and list source on every row, at the moment of import — not assumed afterwards. And an import lands **all rows or none**: if anything goes wrong mid-way, nothing is half-applied.

## Four more doors## Four more doors — the morning cards, erasure, briefs, conversions (UI·DEBT1)

**Your Dashboard now opens with your morning.** Small cards answer one question — what does Pulse want from me today? — follow-ups on you, approvals waiting, each with overdue and stale badges, each a single tap to the work itself. **Data-erasure requests live on the Contacts page**: open one with the person's email, verify their identity (by emailed link, or manually — Pulse will insist you record *how* you established identity before it accepts), discover every table where they appear, then submit — the erasure passes through the same approvals door as everything else, and erasure anonymizes rather than deletes, so your historical numbers stand. **Studio gained its briefs card** — one clear brief saves three revision rounds; every brief belongs to a creative request or an engagement, and the platform refuses one that belongs to nothing. **Customers gained the 💰 button**: record a conversion's value in two taps, attribution inherited from the customer's campaign so it lands in the right room, with the header showing value against spend and ROI over the window.

## No rail without a door (UI·COVER + W5·WIRES2)## No rail without a door (UI·COVER + W5·WIRES2)

A standing gate now guarantees what this platform kept re-learning by hand: **every backend capability has a UI consumer, a named reason, or a dated debt line** — and an unexplained orphan fails the build. Its first run found **thirteen whole rails with no door**, and five of them opened this session: **the SSO sign-in button** on the login screen (the identity feature existed for months with no way to use it) plus the **SSO connections card** on System with a one-tap health test; **approval delegation** on the Approvals page — hand your signature to a colleague for a date window, revoke any time, refusals shown in the validator's own words; **seasonal moments** as chips on the Calendar; and the **engagement → campaigns picker** on the vendor desk, closing the loop the schema always carried. The board pack gained **Top campaigns by spend** — five rows with health percentages, each a door into its room. And a minted **portal link now shows its QR once**, generated from the plaintext at the only moment it exists — hand the vendor the code on paper; the stored hash can never rebuild it. Eight remaining rails are registered as dated debt the gate prints on every single run.

## The vendor desk speaks up## The vendor desk speaks up — and the last consumers (AG·FIX + W5·WIRES)

**Every action on the Agencies page now answers you.** Saving a vendor or engagement, approving or returning a deliverable, advancing its status, minting or revoking a portal link, posting a comment — each one confirms in a toast, and when the platform refuses (a permission edge, a validation rule, a transition the state machine won't allow), **the refusal's own words appear on screen** instead of a button that silently does nothing. The desk's full sequence — vendor → engagement → magic link → deliverable → advance — is now walked by the test suite on every push, so "the vendor page works" is a standing proof, not an assurance.

**Landing pages got their last two doors.** Each card carries a ⬛ QR chip — a printable code of the page's public address, the same offline rail links and outdoor placements use. And each page has a **color**: pick it in the editor, see it live in the visitor preview, and the published page honors it — falling back to your brand accent, then to Pulse amber, in that order.

## Landing pages join the builder family## Landing pages join the builder family — and the last wires (W4·BLD2 + W5·NERVE5)

**Landing pages now start from a template too**: عرض خاص, صفحة فعالية, or عرض منتج — each a complete bilingual page in the exact block language the visitor's page renders (hero with the pulse line, features, call-to-action), with the **live visitor preview** beside the editor and slugs that write themselves. **Every tracked link now carries a ⬛ QR chip** — tap it for a printable code of the short link, the same offline-attribution rail the outdoor plans use. **Morning Pulse gained its missing list**: campaigns approaching their end date, each one opening its room in a tap. On **Budget**, tapping a department filters the campaign bars to that department; tap again to clear. And inside a campaign room, **← → move between campaigns** and Esc closes.

**The market language is now law, mechanically.** The Bayan glossary bans the bureaucratic register (يرجى، الرجاء، قم بـ، الخاص بك) and the dishonest title («المدير الذكي» — the AI is a مستشار, and the build fails if anyone promotes it again). The sweep caught four hiding places the earlier rename missed; all four now say المستشار الذكي in both languages.

## The last connections (W5·NERVE4)

**Every campaign name is now a door.** In the Finance Model and on Planning's objective lines, tapping a campaign's name opens its room directly — `/campaigns?room=…` is a real address you can share, and the drawer opens itself when you arrive. **Departments joined the Finance Model** with their own triad lines, so a GM reads the money by قسم as easily as by campaign. And **allocations now speak SDG directly**: type the SDG amount on the line when you know it — a line with its own SDG keeps it, a line without gets today's rate stamped at creation, and the مخصصات mirror follows each line's own truth like every other row in the model.

## The room, completed (W5·NERVE3)

The campaign room now holds everything a decision needs in one drawer. A **brief line** tells you plainly whether the brief exists — and warns that activation requires one before you hit the wall. **CPL and ROI** appear the moment the campaign has leads and spend to compute them from. The **next step** buttons offer exactly the transitions the matrix allows from the current status — completing a campaign opens a small learnings box first, and any refusal (like the missing-brief gate) is shown in the drawer in plain words, not swallowed. A completed campaign shows its **retro** right there. And the campaign's **allocations** are editable in place: add a line with its label, amount, and channel, delete one with a tap — every change rides the same budget rail as the Budget page, and the مخصصات chip updates immediately. The Finance Model also gained a **by-channel** row, and both the department and channel rollups now speak SDG under the same reconciliation law as everything else.

## The campaign room, allocations, and the SDG mirror (W5·NERVE2)

**Tap a campaign's name** and its room opens: the money bar with its health pill, the connected tissue as counted chips — content, scheduled posts, leads, links, forms, submissions, events, placements, spend rows, invoices, tasks — and the objectives this campaign serves. One tap, the whole nerve.

**Allocations live inside the envelope.** PLANNED budget lines now appear on each campaign's row in the Finance Model as a small **مخصصات** chip — the plan's own line items against the envelope you set. If the allocations add up to more than the envelope itself, the chip turns clay and says so: **تتجاوز الغلاف** — a named flag, never a silent overflow.

**The SDG mirror, honestly.** Under the USD triad, the Finance Model now shows the same money **بالجنيه السوداني** — and in a volatile currency, each row converts at *its own* truth: a row that recorded its SDG amount keeps it; a row that recorded its entry-day rate uses it; only a row that recorded neither uses today's rate. The mirror line states what share of the money carries entry-day truth, so nobody mistakes a mirror for an accounting system.

## The menu, in seven groups (W4·NAV)

The sidebar is organized by the job you came to do: **يومك / Your Day** (dashboard, morning brief, tasks, approvals, inbox), **التخطيط / Plan**, **النشر والإبداع / Create & Publish**, **الاستقطاب والتحويل / Capture & Convert**, **القياس والفهم / Insight**, **الشركاء / Partners**, and — for admins — **الإدارة / Admin**. Nothing moved out of reach: every screen kept its address, module flags and permissions hide exactly what they hid before, and a group whose modules are all off disappears whole. One screen gained a door it never had: the **Executive Report** now sits under Insight instead of living only at a URL.

## Forms and surveys start from a template (W4·BLD)

**Forms → New** and **Surveys → New** open a builder, not a blank. Pick a quick-start — طلب تواصل, تسجيل فعالية, طلب عرض سعر for forms; NPS, CSAT, تقييم فعالية for surveys — and a complete bilingual draft appears, ready to edit. Add items from the type chips, reorder with the arrows, mark required with one tap; option lists appear only where they mean something. The **live preview** beside the editor shows the exact respondent view — Arabic-first with a language toggle — including required markers and your success message, so what you publish is what you saw. Slugs write themselves from the name; you only touch them if you care.

## Approvals show the thing (W4·UX)

Every pending approval now carries **what you are approving**, in the list and again in the decision dialog: a scheduled post shows its title, caption (Arabic or English, whichever you read), platform and format, the slot time, and the attached image or video; an invoice shows the vendor, number and amount; a deliverable shows its title, due date, revision round and the submitted file; an asset version shows the file itself. Click the entity name to jump to its home screen. If Pulse ever meets an approval type it does not know how to preview, it says so by showing nothing extra — the inbox keeps working and the decision buttons stay live.

## Media in the composer (W4·UX)

When you create a new variant in **Publish → New**, a **Media** field lets you attach an image or video: pick one already in the asset library, or upload a file on the spot — the upload lands in storage, joins the library, and rides the variant from there. The queue shows a thumbnail on every slot that carries media, the assignee's Daily Pulse notification includes it, and the approver sees it before signing. Remove it with one tap before saving if you change your mind.

## Draft inside the composer (W4·UX2)

The first option in the composer's content picker is **＋ New draft**. Give it a title (Arabic, English, or both) and a channel, and the item is created on the spot — no detour through the calendar to start. Tick **Send for approval now** and it files into the same approvals inbox as everything else, where the approver sees the title and channel before deciding: approval stamps it APPROVED and the publishing gate opens; rejection returns it to the idea pile. The scheduled slot you compose alongside it stays a **draft** until that approval lands — Pulse never queues unapproved content, from any door.

## Best hours (W4·UX2)

Under the slot picker, the composer suggests up to three posting hours for the chosen platform — computed from your **own measured posts** (engagement against reach), never from folklore. It only speaks with at least 12 measured posts on that platform, and an hour needs at least 3 posts behind it to rank, so one lucky midnight post cannot masquerade as a pattern. Below the floor it says so, with the count: *"Not enough publishing history yet (3/12)."* Hours are shown in UTC.

## The report says "off" when a module is off (W4·UX2)

The board-pack **Report** no longer prints zeros for listening or planning when those modules are simply disabled — a zero that means *off* reads as a collapse. Each card now states **Module off** instead, so the page never implies data it does not have.

## Drag to reschedule (W4·UX3)

On the **Calendar** month view, drag a content chip onto another day to move it. The time of day travels with it — only the date changes — and the move saves immediately, with an error toast if anything refuses. This is a pointer affordance for desktop; on touch, tap the chip and edit the date as before. Events and campaign markers are not draggable — their dates belong to their own screens.

## The post preview (W4·UX3)

While composing a new variant, a **Preview** card shows the post as it will read: your caption in its own direction, the hashtags, the attached media, and a character counter per language against the chosen platform's documented ceiling (280 for X, 2,200 for Instagram and TikTok, 3,000 for LinkedIn, and so on). Past the ceiling the counter turns clay and says **Over the platform limit** — the composer warns, it does not block, because some platforms truncate rather than reject.

## Lists at scale (W4·PERF)

Every list endpoint accepts `?limit=` and `?offset=`; paginated responses carry an `X-Total-Count` header that always counts the rows **you can see**, never the raw table. Pages are cut in the database wherever department visibility allows, so a year-old instance pages leads as fast as a fresh one; where a scoped user meets a bespoke query, Pulse quietly takes the slower, provably-correct path instead. Requests without a limit still return the full list — pickers and dropdowns are unchanged.

## The campaign link builder (Wave 4·D)

**Links → Build** composes a destination with UTM parameters (source, medium, campaign, content, term) using shared presets so a team's naming stays consistent, and existing query parameters on your URL are preserved.

Every tracked link can now produce a **QR code** — print it on a flyer or a stand, and scans attribute to the campaign automatically through the `/r/` redirect.

---

## Your home screen (Wave 4·E)

Pulse now opens with **what it wants from you today**, and shows only what your role can act on:

- **Coordinator** — leads due (with overdue flagged), the publishing queue for today and tomorrow, your open tasks.
- **Approver / GM** — approvals waiting and how many have gone stale, the Pulse Index and its movement, campaigns ending this week.
- **Analyst** — the listening review queue and **the age of its oldest item**, which is usually what matters more than the count.

## Getting started, guided (Wave 4·E)

**Home → Setup** shows eight steps from branding to activating your first campaign. The list is worked out from your actual data every time it loads, so it can never disagree with what you have really done — no step to tick manually, none to forget.

## The template library (Wave 4·E)

**Templates** now holds more than task lists. Alongside the process templates you already had:

- **Campaign templates** — product launch, seasonal push, re-engage dormant distributors. Each arrives complete with a brief, so you can activate straight away rather than being stopped by the brief requirement.
- **Workflow templates** — created **switched off** so you can read what they will do before they do it.

Templates are a starting point, not a shortcut: everything created from one obeys exactly the same rules as if you had built it by hand.

## The Morning Pulse ends with a to-do list (Wave 4·E)

The briefing still reports where the pulse sits and what happened overnight — and now finishes with the four queues you can actually clear: approvals waiting, leads due, listening items awaiting review, and campaigns ending this week. Each shows its age, and each links straight to the place you act on it.

---

## The Listening Control Room (Wave 4·F)

**Listening → Control** is where an analyst tunes market listening. Three rules govern everything on that screen.

**1. The controls tune the pipeline — nothing skips it.** Pausing collection stops the nightly gather; pausing a single watch skips that watch; muting a source removes it from your numbers. Each of these is enforced where it actually matters, not merely recorded as a preference.

**2. Nothing changes without showing you what it will do.** Before you move the review threshold or the relevance band, press **Replay**: Pulse re-scores the last few weeks with your proposed setting and tells you how many items it would have accepted, queued for review, and rejected — and how much your review workload would change. The replay writes nothing.

Once applied, the change is logged with who made it, when, why, and what the replay predicted, and appears as a **marker on your listening charts**. If share of voice jumps, you can tell at a glance whether the market moved or you changed a setting.

**3. Some things cannot be changed at all.** Pulse monitors organisations, brands, products, outlets and official spokespeople. It does not profile private individuals, and no setting, rule or permission in this control room can change that.

### Blocking and muting are different

- **Block** — stop collecting from this source entirely.
- **Mute** — keep collecting for the record, but stop it affecting alerts and reported numbers.

Use mute for a syndication mill you still want in the evidence trail. Changing a source's **Admiralty grade** requires an administrator and a written reason, which is kept with the change.

### The review queue

Assign items to analysts, and rule on several at once. A bulk ruling does exactly what ruling them one by one would do. Pulse also records whether each ruling **agreed with the AI's recommendation** — that is measured to tell you how well the model is doing. It never rules the queue itself.

The queue reports its **oldest waiting item**, not just a count, and the nightly Daily Pulse nudges analysts when that age passes the limit set in Settings.

### Alerts

Create rules for volume spikes, bursts of negative coverage, mentions in grade-A sources, or emerging topics — on a watch or a specific competitor. Set **quiet hours** to suppress overnight notifications without switching the rule off, and **corroborated only** to be told only when two independent sources agree. Each rule fires once per window.

### Watches and campaigns

Attach a watch to a campaign, and that campaign's share of voice appears in its war room alongside spend and leads.

---

## The governance trail cannot be quietly edited (SEC·D)

Every audited action in Pulse now extends a **hash chain**: each entry carries a fingerprint of its content linked to the entry before it, so changing, removing, or reordering any past entry breaks the chain visibly. The database itself refuses edits — attempting to update or delete an audit entry raises an error, even for the application. On **System**, the **Verify chain** button walks the whole trail and answers in one line: intact with the number of entries checked, or broken with the exact row where. Demo instances show a small "pre-chain" count — the seeded sample entries, declared honestly rather than back-dated with fake fingerprints.

## Access review, generated live (SEC·D)

The **System** page lists every account with its role, admin badge, active state, and last successful sign-in, and flags any active account that has not signed in for **90 days** as dormant. This is the quarterly user-access review an auditor asks for — produced by the instance on demand, not assembled in a spreadsheet the night before. Deactivate dormant accounts from **Users**.

## If the founder is unreachable (SEC·E)

**CONTINUITY.md** at the repository root is the day-one document for a competent successor: the reading order for everything else, an honest register of every system and who holds its credentials today, one-line explanations of every operational command, and quick cards for the incidents that matter — outage, bad deploy, data loss, identity-provider lockout (the audited break-glass account), suspected tampering. Two commands keep it real: `npm run continuity:drill` boots a fresh embedded instance and rehearses the full disaster — install, backup, destroy, **restore**, chain verification — in seconds, and runs inside the test suite on every push; `npm run continuity:check` fails CI if the runbook ever stops referencing a script or document, so it cannot quietly rot. The one thing no command provides is a second human with access — the runbook says so in its last section, and the SOC 2 evidence pack keeps printing it until the appointment is made.

## SOC 2, honestly (SEC·D)

`npm run soc2:evidence` generates a dated evidence pack: the dependency inventory, the table census, and every product control **verified against the shipped code at generation time** — a control missing from the repo fails the pack rather than being promised. The pack ends with the organizational checklist that only people and policies can complete (incident response, vendor DPAs, a second reviewer — the bus factor is named there as the top open risk). SOC 2 is an audit of the organization; Pulse's job is to make that audit cheap.

## How Pulse protects your credentials (SEC·A)

The access tokens Pulse holds for Facebook, Instagram, TikTok, Google and WhatsApp — and your two-factor secrets — are **encrypted in the database**. Someone who obtained a copy of your database, without also having your instance's encryption key, would find nothing usable.

- The key exists only in your instance's environment. It is never stored in the database or in a backup.
- Each encrypted value is tied to the exact record it belongs to, so a value copied elsewhere will not decrypt.
- Tokens are never shown in the interface or returned by the API — only whether one is present.
- **Guest portal links** are stored as one-way hashes. Your existing links keep working, but a database copy yields no usable link.

**Health check.** `GET /api/health` reports whether the key is configured and whether anything remains unprotected. If Pulse is deployed without its key, it says so instead of quietly failing to reach your connected accounts.

---

## Single sign-on (SEC·B)

**Settings → Single sign-on.** Pulse connects to your identity provider using **OpenID Connect** — the same connector entry your IT team uses for other applications in Entra ID, Okta, Google Workspace or Ping.

**Setting it up**

1. Register Pulse in your identity provider and copy the **redirect URI** shown on the Pulse SSO page.
2. Enter the issuer URL, client ID and client secret. The secret is encrypted immediately and never displayed again.
3. Press **Test connection** — this only reads your provider's public configuration and signing keys. Nobody is signed in.
4. Optionally restrict which **email domains** may sign in, and map an identity-provider group claim onto a Pulse role.
5. Turn on **Automatic provisioning** if you want accounts created on first successful sign-in; leave it off to require that accounts exist first.

**Requiring SSO.** Once you turn on **Require SSO**, password sign-in is closed for everyone — with one exception.

**The break-glass account.** Before SSO can be required, you must designate one administrator who keeps password access. This exists so that a misconfiguration or outage at your identity provider cannot lock your organisation out of its own instance. Every use of it is recorded separately in the sign-in log, and Pulse will not let you remove the last one while SSO is required.

**Sign-in log.** Every attempt — successful or refused, password or SSO — is recorded with the reason, address and browser. Find it under **Settings → Single sign-on → Sign-in log**.

**Group changes** at your identity provider take effect at the user's next sign-in. To remove someone's access immediately, deactivate their Pulse account.

---

## Erasure and data requests (SEC·C)

**Privacy → Requests.** When someone asks you to delete their data, or to send them a copy, this is where it happens — as a checked sequence, not an ad-hoc database edit.

1. **Record the request** with the person's email address or phone number.
2. **Verify who they are.** Either send a confirmation link to their own address, or record how you verified them in person. Pulse keeps track of which of the two it was, because they are not the same evidence.
3. **Discover.** Pulse lists every table holding that person and exactly which fields would change. Read it before approving.
4. **Approve and execute.** Administrators only, and irreversible.
5. **Confirmation.** Pulse re-runs discovery afterwards and only marks the request complete if it now finds nothing. You get a certificate stating what was erased, what was legally retained and why, and who did it.

**What erasure does — and deliberately does not do.** Personal details are removed; the record itself stays. A lead becomes an anonymous row that still counts in your funnel, still carries its stage and its lost reason, and still appears in past months' reports. **Erasing a person never changes your historical numbers.**

**Free text.** Pulse erases structured fields mechanically. Notes, attachments and message bodies that mention someone need a human read — the certificate says so plainly rather than implying a search that did not happen.

**Backups.** Erasures are logged in a form that contains no personal data. If you ever restore from a backup, run **Replay erasures** and every completed erasure is applied again.

**Copies of data.** Choose **Export** instead of **Erasure** at step 1; the same discovery produces a bundle of that person's records, and nothing is changed.

---

## The demonstration instance

`npm run seed:demo` installs a complete, believable Saria instance: **every table in the platform carries data**, so no screen demonstrates blank.

What that gives you:

- **Analytics** — 90 days of history across 34 metrics, with a rising trend, weekly rhythm, and a dip a fortnight ago that the anomaly card points at. Targets are set for the month with one deliberately behind pace, and two past board packs are already generated.
- **Campaigns** — five campaigns across the group's business units, each with a brief, plus one completed campaign carrying its retrospective and learnings.
- **Money** — recorded conversions, so return on marketing spend is a real number rather than a placeholder.
- **The lead loop** — owners, follow-up clocks, and two deliberately overdue leads so the escalation is visible.
- **Listening** — Admiralty-graded sources including one *muted* syndication mill and one *blocked* domain, so the difference between the two levers is visible; alert rules; and a tuning history that explains its own chart markers.
- **The honest refusals** — a media-mix run that declines to give ROI on 34 weeks of data against a floor of 80, and an AI run that abstained for want of evidence. These are the demo's strongest moments, not its weakest.
- **Security** — an SSO connection configured but switched off, a sign-in log, and a completed erasure with its certificate.

Everything is dated relative to installation, so a demo instance never looks stale.

**Sign in** with the addresses in the seed (for example `head@saria.sd`) using the shared demo password. Change it before showing the instance to anyone outside your team.
