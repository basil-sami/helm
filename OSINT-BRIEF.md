# OSINT-BRIEF — hardening listening into intelligence (W2·E)
*Architected by Fable 5, 2026-08-01 · NOT YET EXECUTED · phased · +7 tables, ~+60 checks, +4 KPIs*

## Why this cluster exists
Today a signal is kept if it matched a query string and wasn't an exact URL/title duplicate, and
its sentiment is a bag-of-words lexicon score presented as a fact. Those raw rows are what
`sov_pct`, mention counts and coverage reports are computed from — which means **collection noise
propagates into the metrics catalog, the Pulse Index and the monthly board pack.** This is not a
feature gap; it is a data-integrity defect with a presentation layer on top.

Three concrete failure modes in the current build:
1. **Ambiguity.** `سارية` also means *flagpole/mast* and is a common given name; `Nile` matches
   half of Sudanese commerce. Every unrelated hit inflates mentions and depresses SOV.
2. **Syndication.** One agency story republished by twelve outlets becomes twelve signals — a
   single press release can visibly move the client's "share of voice."
3. **False certainty.** A −0.2 lexicon score on an Arabic headline with no confidence attached is
   rendered as NEG in a board pack. There is no way to answer *"why does it say that?"*

The discipline that fixes this is not more sources — it is **provenance, corroboration, entity
resolution and abstention**, borrowed from established OSINT tradecraft.

## Reference methodologies (what we take from each)
| Tool / standard | What we adopt | What we do NOT adopt |
|---|---|---|
| **NATO Admiralty Code (STANAG 2022)** | Source reliability **A–F** × information credibility **1–6** on every signal — the spine of §1 | Military classification workflow |
| **Paliscope YOSE** | Evidence preservation: content hashing, snapshot capture, chain of custody, **case files** with timelines (§3) | Its person-centric investigation posture (see Guardrail) |
| **Social Analyzer** | Profile/handle discovery across platforms + name-similarity verification, **org accounts only** (§4) | Person enumeration, face matching, profile scraping behind auth |
| **OSINT Framework** | A categorized **source registry** — collectors declared as data, not code (§1) | Its link-directory sprawl |
| **Maltego** | Entity/alias graph + resolution with match-method provenance (§2) | Full graph-transform engine (overkill for v1) |
| **SpiderFoot** | Modular collector contract with per-module rate limits + ToS posture (§1) | Infrastructure/host recon — irrelevant to marketing |

**Collection ethics (binding, not advisory):** official APIs and RSS first; respect `robots.txt`
and per-source rate limits; never authenticate to a platform to scrape it; never bypass a paywall.
Recording *why* a source is permitted is part of the source registry. This protects the client from
IP bans and ToS claims, which is the practical argument that also happens to be the right one.

## ⚠ Guardrail — the line this module does not cross
Pulse is a **marketing** platform. Entity kinds are **ORG / BRAND / PRODUCT / OUTLET**, plus
**PUBLIC_FIGURE** strictly for named spokespeople acting in an official capacity (a CEO's public
statement about the market is fair game). **Private individuals are never profiled, enumerated or
dossier-built** — no handle discovery on customers or leads, no cross-platform person aggregation.
The existing `contacts.consent` model is the pattern: people enter Pulse by consent, not by
collection. Enforce in code (entity-kind check on the discovery endpoints, not just in the UI) and
state it in ADMIN-GUIDE, because this is exactly the capability a regulated client's legal team
will ask about — and "we architecturally cannot" is the answer that wins the deal.

---

## §1 · PHASE 1 — Provenance & precision (the biggest accuracy win, no new dependencies)

**`osint_sources`** — the registry, seeded industry-neutral:
```
domain (unique) · name/Ar · kind NEWS|WIRE|GOV|TRADE|BLOG|FORUM|SOCIAL|AGGREGATOR
reliability A|B|C|D|E|F (Admiralty; default D "not usually reliable" until rated)
country · lang · paywalled · robotsOk · notes · active
```
Ratings are editable by analysts and default conservatively — an unknown blog must not enter the
world weighing the same as a wire service.

**Signal columns added:** `credibility` (1–6), `relevance` (0–1), `clusterId`, `canonical` (bool),
`reviewStatus` PENDING|CONFIRMED|REJECTED|AUTO, `contentHash`, `sentimentConfidence` (0–1).

**Near-duplicate clustering** (`backend/src/osint/cluster.js`): SimHash (64-bit) over normalized
title+snippet; Hamming distance ≤ 3 → same cluster. Earliest `publishedAt` wins `canonical = true`;
the rest carry `clusterId` and are excluded from counts. **`syndicationCount` becomes a signal in
itself** — a story carried by fourteen outlets is more significant than one carried by one, and
that is now measurable instead of merely inflationary.

**Relevance gate** (`osint/relevance.js`): topics gain `mustInclude` / `mustExclude` /
`contextTerms` (jsonb). Score = weighted term proximity in title vs snippet, entity-alias hit,
source-kind prior. Below `topic.reviewThreshold` (default 0.55) → `reviewStatus = PENDING` and the
signal is **quarantined from all metrics** until an analyst rules. Above → AUTO.

**The review queue** — a new tab in Listening: confirm / reject / reassign-topic, keyboard-driven,
batched. Every ruling is stored, and those rulings are the ground truth for §4's threshold tuning.
This is the human-in-the-loop step that turns "accuracy" from a claim into a measured number.

**Metrics integrity (mandatory in this phase):** every existing computation over `osint_signals`
— SOV, mentions, coverage reports, the Pulse Index inputs — must filter
`canonical = true AND reviewStatus <> 'REJECTED'`. Audit every call site; a missed one silently
keeps the old defect alive. Add a one-off backfill: cluster + score existing rows, default their
`reviewStatus` to AUTO so history doesn't vanish, and note the boundary in the release message.

**KPIs:** `signal_precision_30d` (confirmed ÷ ruled), `corroborated_share_30d`.
**Tests (~24):** SimHash groups 3 syndicated variants into 1 canonical · unrelated headline scores
below threshold → PENDING → excluded from SOV, then CONFIRMED → included · Admiralty rating drives
credibility default · rejected signals never reach coverage reports · backfill idempotent ·
analyst 403s · precision KPI arithmetic.

## §2 · PHASE 2 — Entity resolution & Arabic-aware sentiment

**`osint_entities`** (kind per Guardrail, canonical name/Ar, country, notes, `competitorId?`,
`customerId?`, active) + **`osint_aliases`** (entityId, surface form, lang, kind
EXACT|TRANSLITERATION|ABBREVIATION|HANDLE|MISSPELLING, weight) + **`osint_signal_entities`**
(signalId, entityId, matchMethod ALIAS|HANDLE|URL|MANUAL, confidence, `sentimentToward`).

This is what makes **share of voice trustworthy**: mentions attach to *entities*, not to topic
keywords, and a signal can mention three competitors with different sentiment toward each — which
the current single-score-per-row model cannot express and silently averages away.

**Arabic normalization** (`osint/arabic.js`): alef/hamza unification, ta-marbuta, diacritic and
tatweel stripping, Arabic-Indic digit folding, plus a **Sudanese dialect** lexicon extension and
domain terms (طاقة، مولد، بطارية، انقطاع، تعرفة). Transliteration pairs seeded per entity so
"Saria / سارية / Sariya" resolve to one thing.

**Sentiment v2 — with the right to abstain.** Keep the lexicon as the fast path, add negation
scope, intensifiers/diminishers, emoji, and per-entity target attribution. Return
`{score, label, confidence}` and **emit NEU with low confidence rather than guessing**; the UI
renders low-confidence scores greyed with a tooltip. Optional LLM adjudication runs **only** on the
ambiguous band (0.35–0.65), cached by `contentHash` so cost is bounded and repeat runs are free.
An honest "unclear" is worth more to a GM than a confident wrong sign.

**Tests (~18):** alias resolution across AR/EN/transliteration · per-entity sentiment on a
multi-competitor headline · normalization idempotence · negation + intensifier cases · abstention
path returns confidence < threshold and is excluded from sentiment aggregates · SOV computed from
entity links matches a hand-checked fixture.

## §3 · PHASE 3 — Evidence integrity & case files *(pairs with W2·C storage)*

**Chain of custody:** on capture store `contentHash` (SHA-256 of extracted text), `capturedAt`,
`capturedBy`, and — once W2·C lands — an immutable snapshot (raw HTML + rendered text) in Supabase
Storage with a signed URL. Optional Wayback submission per topic. **Link rot is the norm, not the
exception**: a board-pack claim whose source 404s six months later is worthless, and a PR or legal
escalation is exactly when the original matters most.

**`osint_cases`** (title/Ar, question, status OPEN|CLOSED, ownerId, summary) + **`osint_case_items`**
(caseId, signalId|entityId, note, addedBy) — YOSE's investigation model, sized for marketing: group
evidence around a question ("did the competitor actually cut prices in Port Sudan?"), lay it on a
timeline, and export via the existing immutable `report_runs` engine so a case becomes a citable
artifact rather than a chat thread.

**Provenance UI — "show your work":** every signal exposes source rating, credibility, relevance
score, cluster size, match method, sentiment confidence, and who ruled on it. When the Pulse Index
moves on listening data, that chain is walkable end to end. This is the feature that survives the
question *"where did this number come from?"* in a board meeting.

**Tests (~12):** hash stability · tamper detection (altered text → different hash) · snapshot
signed-URL retrieval · case export immutability · provenance payload completeness.

## §4 · PHASE 4 — Discovery, corroboration & tuning

**Handle discovery (Social Analyzer methodology, ORG-only — enforced server-side):** for a
competitor/brand entity, probe a configurable platform list for candidate profiles, verify by
existence + display-name similarity + bio-term overlap, present as **suggestions requiring human
confirmation** before binding to `osint_aliases` (kind HANDLE). Rate-limited, ToS-respecting,
never authenticated. Feeds `competitors` and the Reach module.

**Corroboration engine:** an insight or a listening-driven alert requires **N ≥ 2 independent
sources** — independence judged by registrable domain *and* declared owner in `osint_sources`, so
a media group's six brands count once. Single-source items publish with an explicit
`UNCORROBORATED` chip rather than being suppressed. Anomaly alerts gain an ACH-lite field:
competing explanations recorded alongside the firing, which is also the natural hand-off to the
Wave 3 AI explainer.

**Threshold tuning from the review queue:** analyst rulings are labels; report precision/recall per
topic and recommend a `reviewThreshold` per topic. The system measures its own accuracy and says so
— nothing here claims a number it cannot show.

**KPIs:** `uncorroborated_share_30d` (LOWER), `entity_resolution_rate_30d` (HIGHER).
**Tests (~10):** independence logic collapses same-owner outlets · uncorroborated chip path ·
ORG-only enforcement returns 403 for PERSON kinds · discovery suggestions require confirmation.

## §5 · Sequencing, dependencies, boundaries
- **Order: P1 → P2 → P4, with P3 after W2·C storage lands** (snapshots need object storage).
  P1 alone removes most of the current distortion and is worth shipping on its own.
- **Independent of the connector layer** (`SOCIAL-API-BRIEF.md`) — but §2's entity model is what
  social-listening ingest should attach to, so **P2 should precede heavy social ingest** or the
  same ambiguity problem re-enters through a new door.
- **Boundaries (recorded now):** full graph visualization (W3) · image/reverse-image and geo
  analysis · paid data vendors (Meltwater/Brandwatch-class licensing) · automated translation of
  signals · person-level anything (permanent, per Guardrail) · sanctions/PEP screening for
  partner due-diligence (a plausible later module, deliberately out of a marketing scope) ·
  real-time streaming (the 05:00 cadence stands; add a manual "اجمع الآن" run).

## §6 · Definition of done (per phase)
Suite green with the new checks · KPIs registered in the metrics catalog (the standing law) ·
every metric touching `osint_signals` filtered to canonical + non-rejected · ADMIN-GUIDE section
covering source rating, the review queue, and the Guardrail in plain Arabic · masterplan marked
✅ with boundaries · packaged per the exit ritual.
