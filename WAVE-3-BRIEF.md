# WAVE-3-BRIEF — from complete product to compounding one
*Architected by Fable 5 · v2, 2026-08-01 (adds live search, AI listening, MMM; SaaS fork removed)*
*NOT YET BUILT · eight clusters, sequenced by dependency*

## Where Wave 3 starts
Waves 0–2 built a product that does the work: 92 tables, 659 checks, a 70-metric catalog, four
platform connectors, a validated listening pipeline. **Wave 3 is not more territory.** Every
cluster makes what exists either *usable by more people*, *survivable in production*, or *smarter
per unit of human attention*.

**Instance-per-client stands.** The shared-SaaS fork is off the plan — sovereign data, per-client
branding and no noisy-neighbour risk are the right defaults for this market, and a `tenantId`
across 92 tables is a cost with no current buyer. Provisioning friction gets solved by the **Pulse
Installer** (still-open Wave 0 boundary), not by re-architecting the data model.

**Sequencing principle: keep the instance alive before making it clever.** W3·A goes first because
the day Saria's instance throws a 500 at 9am, `console.error` on a serverless host means the error
is already gone.

---

## W3·A — Observability *(build first, smallest, highest regret if skipped)*
**The gap, precisely:** `app.js:210` is `console.error(err)` and nothing else. On Vercel that lands
in an ephemeral log nobody is watching. When Yasir says "it broke this morning", there is currently
no way to answer without reproducing it.

- `error_log`: `at, level, route, method, status, message, stack (truncated), userId, requestId,
  userAgent, payloadDigest`. **Never the payload itself** — request bodies here hold contact data;
  log a hash and a shape, not contents.
- Error handler writes it and never throws doing so; `requestId` echoed to the user so they can
  quote it. Client-side `window.onerror` beacon to a hard-rate-limited public endpoint.
- **`GET /api/health`**: DB reachable, last Daily Pulse + age, last publish tick, storage driver,
  connector failures in 24h, AI + search spend against ceiling (see W3·C/D).
- **Admin System page**: errors grouped by fingerprint with counts and last-seen, plus the feeds
  currently scattered across Settings (`integration_runs`, `mail_log`, `ai_runs`, `search_runs`).
- 90-day pruning in the nightly run. Unbounded logs are how a small Postgres instance dies.

**Boundaries:** no APM vendor, no distributed tracing.
**DoD:** ~2 tables, ~25 checks, KPI `error_rate_24h`.

---

## W3·B — The visual flow builder *(committed in Wave 2 planning)*
**The one law: this is pure UI.** `workflows.trigger` and `workflows.actions` are already jsonb and
already run. The canvas **must serialise back into exactly those shapes**. If the builder ever
needs its own execution path, the design is wrong — two engines diverge, and the one running at 3am
won't be the one you drew.

**The only engine change:** `actions` gains a recursive node the runner understands —
`{ type: "IF", cond: { field, op, value }, then: [...], else: [...] }` — **backward compatible**,
every existing flat flow stays valid. `workflow_runs.log` records the branch taken, so the audit
answers *why this lead got no task*, not merely *it ran*.

- Node palette **generated from the `ACTIONS` registry**, so new actions appear automatically.
- **Dry-run against a real recent lead before saving** — shows the branch it would take and what it
  would do, without doing it. This is what earns non-technical trust.
- Save-time validation: unreachable nodes, empty IF branches, actions referencing deleted users.
  Refuse to save a broken flow rather than failing at 3am.
- Unlocks **`SEND_WA`** as a real action (W2·B shipped the rail) — gated on syncing Meta template
  approval status so the builder only offers templates that will actually send.
- Desktop-first canvas; mobile keeps the existing read-only list, stated plainly.

**Boundaries:** no loops, no long waits (a scheduler is Wave 4), no rejoining parallel branches, no
graph-library dependency — SVG plus absolute positioning suffices for a DAG this shallow.
**DoD:** ~30 checks (recursion, branch logging, dry-run fidelity, backward compat).

---

## W3·C — The AI rail *(the foundation D, E and G lean on)*
**One contract, exactly like mail and storage.** `backend/src/ai.js` exposing
`complete({ system, prompt, tools, maxTokens, cacheKey })`; config in `settings.integrations.ai`
(masked, merge-preserved); `api.anthropic.com` already reachable. Every call logged to `ai_runs`
(feature, tokens, latency, cache hit, cost) — the same "is it working / what is it costing" surface
`integration_runs` gives connectors.

**Four laws, non-negotiable — continuations of what Wave 2 already established:**
1. **AI drafts; humans dispose.** Every output lands as a DRAFT requiring confirmation, exactly as
   handle discovery and the publish approval chain already work.
2. **Grounded or silent.** Every generation receives the specific rows it may reason over and must
   cite them (metric keys, signal ids, dates). If the data doesn't support a claim, the correct
   output is *"not enough evidence"* — the abstention principle the Arabic sentiment engine already
   implements. **An AI that invents a plausible reason for a metric move is worse than no
   explanation**, because it will be believed.
3. **Bounded cost.** Monthly ceiling in settings, cache by content hash (P3's evidence hashes make
   this free), degrade to "unavailable" rather than silently spending. Never in a blocking path.
4. **Never for the guardrailed things.** No AI content about private individuals, no AI-drafted
   WhatsApp sends, no AI ruling the review queue — those rulings are the ground truth that tunes the
   system, and poisoning them poisons the measurement.

**Core applications:** anomaly explanation into the ACH-lite `insights.hypotheses` field **already
shipped in W2·E P4** (turning *"leads fell 30%"* into three ranked explanations with evidence) ·
Morning Pulse narrative over already-computed numbers · creative-brief drafts from the brand
centre's tone entries and the copy bank.

**DoD:** `ai_runs` + drafts on existing tables, ~35 checks **including an abstention test and a
cost-ceiling test**, KPIs `ai_drafts_accepted_pct`, `ai_spend_30d`.

---

## W3·D — Live search: the open web and social
*The "know what's happening right now" capability, scoped to what is actually buildable.*

### The honest constraint, stated first
**Pulse cannot replicate Grok's X access, and no amount of architecture changes that** — xAI owns
X, and that access *is* the product. As of **February 2026, X moved to pay-per-use**: no free tier,
roughly **$0.005 per post read**, and **full-archive search is Enterprise-only starting around
$42,000/month**. Any design assuming a firehose is fiction. What follows is what a mid-market
client can actually afford and lawfully run.

### The architecture: a search rail feeding the pipeline that already exists
`backend/src/search.js` — one contract, providers behind it, mirroring the connector layer:

| Provider | Use | Cost posture |
|---|---|---|
| **Anthropic web search** (`web_search_20250305`, via the AI rail) | Live open-web questions, grounded and cited | Per-query; cheapest path to "what's being said today" — **the default** |
| **X pay-per-use** | Narrow high-value queries only (own brand, 2–3 competitors) | Metered ~$0.005/read — a 200-post/day topic ≈ $30/month **only if hard-capped** |
| **Reddit / YouTube Data / RSS** | Forums, video commentary, publisher feeds | Free or cheap; partly wired already |
| **Owned accounts** (Meta/TikTok/WA) | Your own comments, DMs, mentions | Shipped in W2·B/D |

**The load-bearing decision: live search does not bypass the validation pipeline — it feeds it.**
Every result enters as an `osint_signal` and passes source registry → SimHash dedupe → relevance
gate → review queue → entity resolution → corroboration, exactly as RSS does. Anything else would
undo Wave 2 in a single cluster: real-time noise reaching the Pulse Index unfiltered is precisely
the defect W2·E was built to fix. **Speed is not a reason to lower the evidence bar.**

- **Budget guard is a first-class object,** not an afterthought — pay-per-use with no ceiling is how
  a client gets a surprise invoice. `search_budget` per instance per month with per-provider caps,
  spend visible in the System page, admin notification at 80%, hard stop at 100%. A topic that would
  exceed its cap **degrades to the free providers rather than failing**.
- **Ask-your-listening**: a question box over the corpus — *"what are people saying about generator
  prices in Port Sudan this month?"* — answered from stored signals with **inline citations to the
  rows**, reaching for live search only when the stored corpus is thin. Grounded or silent applies.
- **ToS posture unchanged from the OSINT brief:** official APIs and RSS first, `robots.txt`
  respected, never authenticate to scrape, never bypass a paywall. **Third-party X mirrors are
  explicitly out of scope** — they are cheap because they violate platform terms, and a client's
  accounts are not ours to risk.

**Boundaries:** no firehose/streaming, no full-archive history, no paid data vendors
(Meltwater/Brandwatch-class), no scraping of authenticated surfaces.
**DoD:** +2 tables (`search_runs`, `search_budget`), ~30 checks including **a budget-exhaustion
test** and **a "live results still pass the relevance gate" test**, KPIs `search_spend_30d`,
`live_signal_share_30d`.

---

## W3·E — AI-supercharged listening
*Where the AI rail meets the OSINT pipeline. The highest-leverage cluster in Wave 3.*

Wave 2 made listening **trustworthy**. This makes it **fast**, without spending the trust.

1. **Semantic relevance in the ambiguous band only.** The keyword gate is decisive at the extremes
   and weakest in the middle. Route only signals scoring 0.35–0.65 to an LLM adjudicator, cached by
   `contentHash`, with the topic's `mustInclude`/`mustExclude` as context. Cost stays bounded because
   the band is narrow. **The verdict is a recommendation into the review queue — never an
   auto-ruling** (law 4: analyst rulings are the ground truth that tunes thresholds).
2. **Entity disambiguation.** *سارية* is also a flagpole and a given name; *النيل* is half of
   Sudanese commerce. Where alias matching is confident but context is odd, ask whether the mention
   refers to the registered organisation, with evidence. Writes `osint_signal_entities.confidence`
   and flags the doubtful for review.
3. **Theme clustering — the feature a GM will actually use.** Beyond per-signal sentiment: *what are
   people complaining about this month?* Group confirmed signals into named themes with volume,
   trend, representative quotes and cited ids. This is the difference between *"sentiment is −0.2"*
   and *"three themes: delivery delays, price increases, one product defect."*
4. **Emerging-topic detection.** Themes accelerating against their own baseline, surfaced before
   they become the month's crisis. Rides the existing anomaly machinery.
5. **Query expansion from real rulings.** The review queue is a labelled dataset. Propose
   `mustInclude`/`mustExclude`/`contextTerms` additions from what analysts actually rejected — the
   same self-measuring posture as P4's threshold tuning, and it compounds: every ruling sharpens
   the gate.
6. **Competitor briefs.** Per entity, per month: mentions, SOV movement, theme breakdown, notable
   stories — **drafted from corroborated clusters only**, landing as a draft insight with
   `signalIds` populated. The corroboration engine exists precisely so an AI cannot launder a
   single-source rumour into a board pack.
7. **Arabic sentiment adjudication** in the 0.35–0.65 band — designed in the OSINT brief,
   deliberately deferred to here.

**Every output cites its signal ids. Every output is a draft. Nothing here writes to a metric.**

**Boundaries:** no embedding store in Wave 3 (semantic search over the full corpus is its own
cluster with its own budget) · no AI-generated sentiment about individuals · no autonomous topic
creation.
**DoD:** +2 tables (`osint_themes`, `osint_theme_signals`), ~40 checks, KPIs `themes_active` and
`ai_relevance_agreement_pct` — *does the model actually agree with your analysts?* Measured, not
assumed.

---

## W3·F — Forecasting & budget scenarios
`metric_snapshots` is already a clean daily series per `(metricKey, dims, date)`, and
`metric_targets` already computes pacing.

- Seasonal-naive baseline + damped linear trend, in-process, **no ML dependency**. These series are
  short, weekly-seasonal and shock-prone; a clever model would overfit and be indefensible in a
  board meeting.
- **Always an interval, never a point.** A forecast rendered as one number gets quoted as a promise.
  Show the band, the method, and the observation count.
- **Refuse below a data floor** (~21 observations, or where variance swamps trend).
- Target-arrival probability feeds the existing pacing UI rather than a new screen.
- Budget scenarios — "move X% from channel A to B" — replayed against observed cost-per-outcome,
  shown as a range with the assumption said aloud.

**Boundaries:** no causal inference here (that's W3·G), no auto-reallocation of real budget, no
forecasting listening sentiment (too noisy — the abstention rate would make it dishonest).
**DoD:** ~20 checks including the refusal case, KPI `forecast_accuracy_30d` (back-tested).

---

## W3·G — Media-mix modelling
*Requested for Wave 3. Buildable — but only if the data floor is enforced rather than wished away.*

### What the literature actually requires
MMM needs roughly **80–100+ observations** — about **18–36 months of weekly data** — plus **genuine
variance in per-channel spend**, and channels large enough to leave a signal. Pulse began collecting
`ad_spend` in Wave 1 and only started syncing platform spend in W2·D. **Saria will not clear that
floor for a while, and no modelling technique fixes it.** A model fitted on 20 weeks of near-constant
spend produces confident, wrong channel ROIs — and unlike a bad forecast, **a bad MMM moves real
budget.**

### Therefore: two honest stages
**Stage 1 — foundation and transforms (ships in Wave 3, useful immediately):**
- `mmm_datasets`: a weekly panel assembled from `ad_spend` (by channel), `metric_snapshots` (the
  outcome), plus controls — seasonality, promotions (`promotions` exists), competitor/price events
  from listening, Ramadan and Eid — with a **data-completeness score per week**.
- **Adstock** (geometric carryover, per-channel decay) and **saturation** (Hill/power diminishing
  returns) as first-class, inspectable transforms. These two ideas are what make MMM more than
  regression, and they pay off alone: *"your Meta spend saturates around X per week"* is actionable
  before any full model exists.
- Ridge regression with non-negative channel coefficients, in-process (no Python service in Wave 3).
- **Diagnostics shown by default, not buried:** R², holdout error, collinearity (VIF) warnings, and
  the completeness score. If two channels always move together, the model **says it cannot separate
  them** rather than silently splitting the credit.

**Stage 2 — gated by the floor, refusing until met:**
- The **readiness panel** is the real Wave 3 deliverable: observations collected, channels with
  usable variance, weeks missing, and a plain statement — *"MMM needs ~80 weekly observations; you
  have 34. Estimated ready: Q3 2027."* Far more useful than a model nobody should trust.
- Below the floor: contribution estimates render **directional only**, explicitly labelled, with no
  ROI figure and no optimiser.
- Above the floor: contribution decomposition plus a budget optimiser that always returns a
  **range**, states its assumptions, and never writes to a real budget.

**Why this ordering is the honest one:** MMM's failure mode is not being unavailable. It is being
*available and wrong* — quoted in a board meeting and moving a quarter of the budget on twenty weeks
of data. **The refusal is the feature.**

**Boundaries:** no Bayesian/PyMC or Robyn dependency in Wave 3 (revisit once the floor is cleared
and priors are genuinely needed) · no geo-level modelling (needs regional spend Pulse doesn't
collect) · no incrementality/geo-lift testing (a separate discipline) · MMM never auto-adjusts
budget.
**DoD:** +2 tables, ~30 checks **including the below-floor refusal and a collinearity-warning
test**, KPIs `mmm_readiness_pct`, `mmm_holdout_error`.

---

## W3·H — Multi-department cores
**The fork to avoid:** cloning tables per department. The right model is a **department dimension**
— a `departments` table plus a nullable `departmentId` where it genuinely varies (campaigns, leads,
content, tasks, budget entries, dashboards) — scoped through `can()` alongside module permissions.
Metrics gain department as a **dimension slice**, which the snapshot engine already supports from
W1·C, so a department head sees their own Pulse Index and the GM sees the roll-up. That roll-up is
the reason this is worth doing, and it is nearly free given the dims machinery already built.

**Boundaries:** not multi-tenant · no per-department branding · no cross-department approval chains.
**DoD:** ~1 table + ~8 nullable columns, ~25 checks — **scoping is a security surface: test that a
department-scoped user cannot read another department's leads via every list endpoint.**

---

## Sequencing & shape
```
W3·A Observability   → first; small; protects everything after it
W3·B Flow builder    → the committed headline; independent
W3·C AI rail         → the foundation D, E and G lean on; ai_runs sits beside error_log
W3·D Live search     → needs C (Anthropic web search rides the AI rail) + the W2·E pipeline
W3·E AI listening    → needs C and D; the highest-leverage cluster in the wave
W3·F Forecasting     → independent; can interleave anywhere
W3·G Media-mix       → after F (shares the series machinery); ships the readiness gate first
W3·H Departments     → after B; security-sensitive, budget real review time
```
**Estimated shape:** ~101 tables, ~890 checks, catalog ~80. Every territory registers its KPIs —
the standing law. Each cluster ends with the exit ritual.

## The through-line
Wave 2's lesson was that **honesty is a feature**: sentiment that abstains, corroboration counting
owners not mastheads, thresholds measured against real rulings, snapshots marked partial, a publish
tick that fails loudly rather than handing Meta a link it cannot fetch. Wave 3 adds AI, live search
and econometrics — three things that fail by producing output that is confident, fluent and wrong.
The discipline has to hold hardest exactly here.

**Every AI output is a draft. Every forecast is an interval. Every model states its data floor.
Every claim cites its rows.**
