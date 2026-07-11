# HELM — The Marketing Brain
### حلم — رؤية المنصة وهندسة التشغيل
*From a system that records marketing work to a system that plans, senses, decides, and learns — with an AI CMO as the connective brain. Built Arabic-first, dual-currency, for emerging-market industrial marketing.*

---

## 0. The one-line thesis

Most tools are a **system of record** (where work is tracked) or a **system of engagement** (where work is done). HELM's destiny is a **system of intelligence and decision**: the place where the whole marketing function is *planned, sensed, executed, measured, and improved* — and where a CMO (human or AI) can ask "what's happening and what should I do?" and get a grounded answer.

The evolution: **Record → Engagement → Intelligence.** HELM is already climbing this stack; this document is the map to the top.

A blunt prerequisite stated once: **everything analytical and AI below is only as good as the data the team logs.** The single highest-leverage investment is making capture and logging effortless. Garbage in, garbage out — so Phase work is sequenced to earn the AI, not bolt it on.

---

## 1. The five-layer architecture (the "brain")

Think of HELM as five stacked layers. Work and intelligence flow **up** (data → insight → decision) and **down** (decisions → plans → execution), in a loop.

| Layer | What it is | HELM today |
|---|---|---|
| **5 · Advisory / Decision** | The AI CMO surface: briefings, consults, natural-language Q&A, the marketing wizard, decision support. "What should I do?" | — (to build) |
| **4 · Intelligence** | AI over the data: synthesis, diagnosis, forecasting, anomaly detection, recommendations. The reasoning brain. | — (to build) |
| **3 · Analytics** | The KPI engine: funnels, attribution, pipeline analytics, scorecards, reports. Turns records into meaning. | partial (Command Center) |
| **2 · Operations** | The modules that run the work: plan → execute → capture across all marketing processes. | strong (most of HELM) |
| **1 · Data foundation** | The single connected model — every record tagged to campaign / channel / business-unit / owner so it's queryable and attributable. | strong (the loop) |

The vertical loop is the product: **Sense → Plan → Execute → Measure → Learn → re-Plan**, with the brain (layers 4–5) watching every layer and the data foundation (layer 1) making it all connected and attributable.

---

## 2. The marketing operating model — every process HELM runs

A marketing department does ten things end-to-end. HELM should run all ten as one connected system (not ten tools). Current coverage:

| # | Process | HELM today | The "top 1%" version |
|---|---|---|---|
| 1 | **Strategy & Planning** | — | Objectives/OKRs cascading to campaigns; unified marketing calendar; budget planning; scenario/what-if |
| 2 | **Market Intelligence** | OSINT/Market Intel ✓ | + AI-enriched signals, competitor profiles, share-of-voice, alerts |
| 3 | **Demand Gen / Campaigns** | Campaigns ✓ | + per-campaign goals & KPIs, multi-channel plan, performance rollup, experiment notes |
| 4 | **Content & Creative** | Calendar ✓ | + production workflow with SLAs, asset library, channel previews, AI Arabic drafting |
| 5 | **Channels & Distribution** | Social, Events (partial) | + Email, Paid, Web, PR; scheduling; performance per channel |
| 6 | **Lead Mgmt & Pipeline** | Leads ✓ | + multi-channel capture, lead scoring, nurturing cadences, SLAs, attribution, sales/Odoo handoff |
| 7 | **Budget & Finance** | Budget ✓ | + plan-vs-actual, ROI/ROMI, dual-currency with rate history, scenario modeling |
| 8 | **Execution & Ops** | Tasks ✓ | + workflow templates, SLAs, dependencies, workload view |
| 9 | **Measurement & Analytics** | Command Center (partial) | + the full KPI engine, attribution, scorecards, scheduled/auto reports |
| 10 | **Governance & Team** | Roles/Users ✓ | + approval chains, audit trail, per-role scoping |

HELM already covers ~70% of the surface. The gap to "top 1%" is three new pillars (Planning, Analytics/Reporting, the AI brain) and a Capture layer — plus depth in what exists.

---

## 3. New pillar — Strategy & Planning

Today HELM executes; it doesn't yet *plan*. Add a planning layer that the rest of the system rolls up to:

- **Objectives & OKRs**, cascading: annual marketing goals → quarterly objectives → campaign targets. Every campaign, lead, and dirham traces to an objective.
- **Unified marketing calendar** — campaigns + content + events on one timeline (per business unit, per channel), so the Head sees the whole plan at a glance and conflicts surface early.
- **Budget planning** — allocate by channel / BU / quarter, tie allocations to campaigns; then Analytics shows plan-vs-actual automatically.
- **Scenario / what-if** — "shift 20% from PR to paid — what happens to projected pipeline?" Lightweight modeling on top of historical performance.
- **Plan health** — are we on pace to the objectives? A single status the AI brain can narrate.

*Data it needs:* an `objectives` model (period, target metric, owner) and a link from campaigns/budget to objectives.

---

## 4. New pillar — Analytics, KPIs & Reporting

This is the heart of "measurement, follow-up, monitoring, reports." A real KPI engine, organized into a framework — not a pile of charts.

### 4.1 The executive scorecard (what the Head sees first)
A **North Star** plus a balanced view, so no single number is gamed:

- **North Star (pick one):** marketing-sourced **pipeline value** (dual currency), or qualified-lead growth.
- **Demand:** new leads, qualified leads, pipeline value & weighted pipeline.
- **Efficiency:** cost-per-lead, **ROMI**, spend-vs-plan.
- **Brand:** share-of-voice, sentiment trend (from OSINT).
- **Velocity:** sales-cycle length, content cycle time.
- **Execution:** on-time %, SLA adherence.

### 4.2 The metric library (definitions & formulas)

**Funnel**
| Metric | Formula |
|---|---|
| Stage conversion | count(stage N+1) ÷ count(stage N) |
| Lead → qualified rate | QUALIFIED+ ÷ all leads |
| Win rate | WON ÷ (WON + LOST) |
| Funnel velocity | days from NEW to WON (avg) |

**Channel**
| Metric | Formula |
|---|---|
| CPL | channel spend ÷ channel leads |
| CPM / CTR / engagement rate | impressions, clicks, interactions (from social/paid) |
| ROAS / ROMI | (attributed revenue − cost) ÷ cost |
| Channel contribution | % of pipeline sourced by channel |

**Pipeline**
| Metric | Formula |
|---|---|
| Pipeline value | Σ open lead value |
| Weighted pipeline | Σ (value × stage probability) |
| Avg deal size | won value ÷ won count |
| Sales cycle | avg(WON date − created date) |
| Stage aging | days a lead sits in a stage (flag stalls) |
| Source attribution | pipeline grouped by source (OSINT, web, event…) |

**Budget / finance**
| Metric | Formula |
|---|---|
| Spend vs plan | actual ÷ planned, per channel/BU/quarter |
| Burn rate | spend ÷ period |
| Cost per win | spend ÷ won deals |
| ROMI | (attributed revenue − marketing cost) ÷ marketing cost |
| *(all dual-currency, with rate history)* | |

**Content / brand / ops**
| Metric | Formula |
|---|---|
| Content throughput | published ÷ period |
| Approval cycle time | avg(approved_at − created_at) |
| On-time publish rate | published-on-schedule ÷ total |
| Share of voice | your mentions ÷ category mentions |
| Sentiment trend | rolling avg of signal sentiment |
| Task throughput / on-time % | done ÷ period; on-time ÷ total |

### 4.3 Monitoring, follow-up & reports
- **Monitoring:** live dashboards + **threshold alerts** (budget > 90% of plan, pipeline drop, sentiment dip, SLA breach) feeding the Sentinel (§6).
- **Follow-up / SLAs / cadences:** new-lead-contacted-within-X SLA, stalled-lead flags, content-approval SLAs, task-due reminders, escalation — surfaced in a "needs attention" queue (the Today briefing is the seed of this).
- **Reporting:** scheduled weekly/monthly **board-ready** reports, per-role views, export to PDF/sheet, and — the differentiator — an **auto-written narrative** ("what happened and why") generated by the AI brain.

---

## 5. New pillar — Capture (feeding the funnel)

Analytics and AI starve without inflow. Make capturing leads and data effortless and multi-channel:

- **Web forms & landing pages** → leads (with campaign/source tags for attribution).
- **WhatsApp capture** — the dominant channel in Sudan and the region; inbound WhatsApp enquiries become leads/conversations. This alone is a regional superpower most platforms ignore.
- **Event capture** — on-site sign-in / badge scan at events → leads, with automatic post-event follow-up.
- **CSV import + enrichment** (have import; add enrichment).
- **OSINT signal → lead** (already built — the market-sensing inflow).
- **Unified capture queue** — one inbox where all inbound lands, deduped, assigned by rule, SLA-timed.

---

## 6. The pillar that changes the game — the AI CMO / Brain

This is "AI adviser, CMO, brain, consult, wizard" made concrete. Eight modes, all grounded in the org's *own* HELM data — not generic advice.

1. **The Brief** — a daily/weekly executive summary in Arabic or English: what changed, what's working, what's at risk, the top 3 things to do. Auto-written from the data.
2. **The Diagnostician** — explains the numbers: *"CPL rose 32% — paid spend grew while lead volume was flat; channel X is the drag."* Root-cause on any KPI move.
3. **The Adviser / Consult** — natural-language Q&A over your marketing data: *"How is the solar campaign tracking vs target?" "Where should I cut budget this quarter?"* Answers cite the actual numbers.
4. **The Planner / Wizard** — guided generation: draft a campaign plan, content calendar, or budget split from stated objectives; step-by-step wizards to set up campaigns and plans correctly.
5. **The Forecaster** — projects pipeline, spend burn, and goal attainment: *"At this pace you'll reach ~80% of the Q3 target; here's the gap and two ways to close it."*
6. **The Sentinel** — anomaly detection & alerts: budget overrun, stalled pipeline, sentiment drop, SLA breaches, unusual signal spikes — pushed before they become problems.
7. **The Content Studio** — Arabic-first, on-brand copy drafting for campaigns, posts, and content briefs, with the bilingual nuance HELM already handles well.
8. **The Strategist** — higher-order moves: positioning ideas, segment opportunities, and competitive responses synthesized from OSINT + performance data.

### How it actually works (honest architecture)
- An **LLM** sits on top of HELM's data. (HELM is already built on Claude — so a Claude-powered brain is a natural fit.)
- **Grounding (RAG + tools):** the model is given the relevant slice of *your* data — KPIs, campaign records, pipeline, signals — and can **call HELM's APIs** ("get campaign performance," "get pipeline by stage") so answers are live and accurate, not hallucinated.
- **Guardrails:** it *advises, humans decide*; every claim is **traceable to the numbers** behind it; it flags uncertainty; it never auto-executes consequential or destructive actions without confirmation; it's **role-scoped** (a channel lead's brain sees their channel; the Head's sees everything).
- **Bilingual by construction** — a CMO brain that reasons natively in Arabic *and* English is a genuine, rare edge.

### Honest constraints (don't skip these)
- **Cost & access:** an LLM API costs tokens (per use), and for a Sudan-based org, API availability, sanctions, and payment rails are real hurdles. Plan around it: batch heavy jobs, run when connected, and keep a self-host path for sovereignty.
- **Data quality is the gate:** the brain is only as smart as the team's logging discipline. Earn the AI with clean data first.
- **Support, not autopilot:** AI advice can be wrong; keep humans in the loop for consequential calls; make everything auditable.

---

## 7. Competitive advantage & the moat

**Versus the incumbents** (HubSpot, Salesforce, Monday, Adobe): they're English-first, single-currency in mindset, expensive, connectivity-hungry, **siloed** (a CRM *or* a PM tool *or* an analytics suite), have **no built-in market sensing**, no Arabic-native AI CMO, and aren't self-hostable or offline-capable.

**HELM's edges, stacked:**
1. The **connected loop** — sense → plan → act → measure → learn in *one* surface.
2. **Arabic-first + dual-currency native** — built for the region, not localized as an afterthought.
3. **Built-in OSINT** market sensing — competitors sell that separately.
4. An **AI CMO grounded in your own data**, bilingual.
5. **Sovereign / self-hostable / offline-capable** — data stays in-country; works on the network you have.
6. **Industrial-B2B fit** — tenders, distributors, long cycles, business units modeled natively.
7. **Price & fit** for emerging markets.

**The compounding moat (the flywheel):** the more the team uses HELM, the richer the org's data, the smarter its AI CMO becomes *on their specific business* — a data advantage incumbents literally cannot copy, because it's *Saria's* accumulated marketing intelligence.

---

## 8. Problems it solves, by who feels the pain

- **Head of Marketing / CMO:** no single view of the whole function, can't see ROI, planning lives in spreadsheets, no decision support → HELM gives the cockpit + AI brief + scorecard + a brain to consult.
- **Channel leads (digital / paid / events / content):** fragmented tools, manual reporting, no market context → one workspace + auto-reporting + live signals.
- **Analysts:** data scattered, reports hand-assembled → the KPI engine + scheduled/auto-narrative reports.
- **The organization (Saria):** foreign tools don't fit its language, currency, connectivity, cost, or sovereignty needs → HELM is built for exactly this context.

---

## 9. The realistic roadmap (earn each layer)

Sequenced so each phase makes the next possible — analytics needs clean data; AI needs analytics.

- **Now — Stabilize & instrument.** Finish deployment; make logging/capture effortless so the data foundation is trustworthy. (Prerequisite for everything below.)
- **Phase 3 — Analytics & Planning.** KPI engine + executive scorecard + funnel/pipeline analytics; the Planning module (objectives, unified calendar, budget planning); scheduled reports. *This alone is transformative — a great measurement + planning layer beats any AI bolted onto bad data.*
- **Phase 4 — Capture & follow-up.** Web forms, WhatsApp capture, event capture; lead scoring; SLAs/cadences; the Sentinel's threshold alerts.
- **Phase 5 — The AI brain.** Start with **the Brief + grounded Q&A**, then add the Diagnostician, Forecaster, Content Studio, and wizards as data matures. Always traceable, always human-in-the-loop.

---

## 10. Cautions & tradeoffs (the honest part)

- **Data discipline is the whole game** for analytics and AI. Invest in capture UX and automation before expecting smart output.
- **Don't boil the ocean.** This is a multi-quarter vision. A superb Analytics + Planning layer is worth shipping and living with before reaching for AI.
- **Avoid vanity metrics.** Tie KPIs to outcomes (pipeline, ROMI), not activity (posts, impressions). Activity that doesn't move an objective is noise.
- **AI is decision support, not a CMO replacement.** Keep humans accountable; make every machine claim auditable to the numbers.
- **Respect the context.** LLM cost/access and connectivity in Sudan are real; design for batching, offline tolerance, and sovereignty rather than assuming always-on cloud.

---

*Sense. Plan. Act. Measure. Learn. — one connected brain, Arabic-first, built for the marketing reality you actually operate in.*
