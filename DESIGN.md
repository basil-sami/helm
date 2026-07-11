# HELM — Design System & Product Strategy
### حلم — نظام التصميم واستراتيجية المنتج
*Synthesizing IBM Carbon, Stripe, and Apple HIG into one coherent direction.*

---

## 0. Honest baseline — where HELM stands today

**Strong already:** a coherent "control-room" identity (dark command rail + warm paper
workspace + amber accent), IBM Plex (Arabic/Sans/Mono) — which is *Carbon's own
typeface*, so you're already aligned with an enterprise-grade foundation — real RTL/LTR
switching, dual-currency throughout, a clean React + Tailwind component layer, and a
connected data model (campaigns → content → leads → budget → social → market intel).

**Gaps to close:** the design is consistent but not yet *systematic* (no formal token
scale, type ramp, or motion language); interactions are functional but not yet
*delightful* (spinners not skeletons, no optimistic UI, no command palette, no keyboard
layer); and the product is feature-complete but the **unique mechanic that ties it all
together isn't surfaced** in the UX yet. This document fixes all three.

This is a *direction*, not a claim of perfection. Where there are real tradeoffs
(density vs. simplicity, offline cost, scope), they're called out in §10.

---

## 1. What each system contributes — and how we fuse them

| System | Its genius | What HELM takes |
|---|---|---|
| **IBM Carbon** | Systematic, open, accessible, data-dense enterprise design. Tokens, the 2x grid, rigorous data-viz, "productive vs. expressive" motion, WCAG by default. | The **backbone**: a token system, type ramp, grid discipline, data-table craft, accessibility floor, and motion grammar. |
| **Stripe** | Craft and restraint. Hides immense complexity behind a calm surface. Micro-interactions, progressive disclosure, optimistic UI, world-class empty/loading/error states, keyboard-first power. | The **finish**: precision, "earn the ink," instant feedback, skeletons, a ⌘K command palette, and making complex flows feel effortless. |
| **Apple HIG** | Clarity, Deference, Depth. Human-centered. Direct manipulation, immediate feedback, content over chrome, consistency, user control. | The **soul**: reduce cognitive load, let the user's data be the hero, give every action a reaction, and keep one mental model across modules. |

**The fusion — "Calm Command."** HELM is a control room: dense with signal, but calm,
legible, and unhurried. Carbon makes it *rigorous*, Stripe makes it *refined*, HIG makes
it *humane*. Density without anxiety. Power without clutter.

---

## 2. HELM's design principles (the constitution)

1. **Calm command.** The operator sees a lot at once, but nothing shouts. Hierarchy,
   whitespace, and restraint do the work. (Carbon density × HIG deference.)
2. **Earn the ink.** Every element justifies its pixels. No decorative chrome, no
   gratuitous borders, no emphasis inflation. Remove until it breaks, then add one thing
   back. (Stripe.)
3. **Bilingual by construction.** RTL and LTR are not a translation layer — they are
   first-class, pixel-mirrored, and equally polished. Numbers, currency, dates, and icons
   all flip correctly. This is a *moat*, not a feature.
4. **Optimistic and honest.** Actions feel instant (update the UI before the server
   confirms, roll back on failure). System states never lie — a failed sync says *why*,
   an empty list says *what to do next*.
5. **One model, many rooms.** Campaigns, leads, content, events, budget, social, intel —
   all share the same interaction grammar (same table, same modal, same status pill, same
   keyboard moves). Learn it once, use it everywhere. (HIG consistency.)
6. **Built for the field and the network it actually has.** Fast on a phone in Khartoum,
   resilient on a weak connection, legible in sunlight. Performance and accessibility are
   features, not afterthoughts.

---

## 3. The design system — tokens

Tokens are *semantic*, not raw. Components reference roles ("surface", "text-secondary"),
never hex values. This is Carbon's core discipline and what makes theming, dark mode, and
white-labeling trivial later. Implement these in `tailwind.config.js` + CSS variables.

### Color (semantic layers over the existing palette)
| Role | Light | Purpose |
|---|---|---|
| `surface/base` | `#F7F6F2` (paper) | App background |
| `surface/raised` | `#FFFFFF` | Cards, panels |
| `surface/sunken` | `#EFEDE6` | Wells, table headers |
| `surface/command` | `#0E1117` (ink-900) | The rail, login panel |
| `text/primary` | `#1A1D23` | Headlines, key data |
| `text/secondary` | `#5A6069` | Labels, meta |
| `text/tertiary` | `#8A909A` | Hints, placeholders |
| `border/subtle` / `border/strong` | `#E6E3DA` / `#CFCBC0` | Dividers / inputs |
| `accent` | `#E8A33D` (amber) | Primary action, focus, brand |
| `status/success` `warning` `danger` `info` | moss / amber / clay / steel | Semantic feedback |

**Data-viz palette (Carbon discipline):** a fixed, colorblind-safe categorical sequence
(amber → steel → moss → clay → violet → teal …) assigned *deterministically* by series so
the same channel is always the same color across every chart. Never reuse status colors
for categories.

### Type ramp (IBM Plex — you already ship it)
A modular scale. Plex Sans for English, Plex Sans Arabic for Arabic, **Plex Mono for all
numbers** (tabular figures so columns align — critical for budget/metrics).

| Token | Size / line | Use |
|---|---|---|
| `display` | 32–40 / 1.1 | Login hero, big KPI numbers |
| `heading-1 … 3` | 24 / 20 / 16 | Page, section, card titles |
| `body` | 14 / 1.5 | Default text |
| `label` | 12 / 1.4, medium, slight tracking | Form labels, table headers, pills |
| `numeric` | Plex Mono, tabular | Money, counts, dates in tables |

### Spacing — 4/8 grid
`4, 8, 12, 16, 24, 32, 48, 64`. Everything snaps to it. Card padding `16/24`, section gaps
`24`, page gutters `24/32`. (Carbon's 2x grid.)

### Radius / Elevation / Motion
- **Radius:** `sm 6 · md 8 · lg 12 · pill 999`. One step up for overlays.
- **Elevation (light, layered shadows, not heavy):** `card` (resting), `raised` (hover),
  `overlay` (modals/popovers), `command` (the rail). Dark surfaces use border + inner glow,
  not drop shadow.
- **Motion (Carbon "productive vs. expressive"):**
  - *Productive* (most UI): `150ms`, `cubic-bezier(.2,0,.38,.9)` — entering data, hovers, toggles.
  - *Expressive* (meaningful moments): `240ms`, `cubic-bezier(.4,.14,.3,1)` — modals, page
    transitions, success.
  - Respect `prefers-reduced-motion`. Motion clarifies cause→effect; it is never decoration.

---

## 4. Component & interaction patterns

**Navigation + ⌘K command palette (signature).** Keep the command rail, but add a
Stripe/Carbon-grade **command palette** (⌘K / Ctrl-K): jump to any module, run any action
("new lead", "refresh market intel", "export budget"), or search any record — all from the
keyboard, in Arabic or English. This single feature changes HELM from "an app you click"
to "a tool an operator commands." Add a global "/" to focus search.

**Data tables (Carbon's heartland).** Promote the current tables to a real system:
sticky headers, **tabular-figure numeric columns**, sortable headers, a **density toggle**
(comfortable/compact), inline row actions on hover, **multi-select with a bulk action bar**
that slides up, column show/hide, and **server-side pagination** for when data grows.
Right-aligned numbers in LTR, mirrored in RTL.

**Forms (HIG + Stripe).** Inline validation on blur (not on submit), **optimistic save**
with a quiet "Saved ✓", autosave for long edits, clear primary/secondary button hierarchy,
and never more than one question's worth of friction at a time. Field labels above inputs,
RTL-aware.

**Feedback.** Replace generic errors with **honest, actionable** messages (the login
"wrong password" that actually means "can't reach database" is the cautionary tale — show
the real cause). Toasts for confirmations, inline for context. Every destructive action
gets a typed/confirmed step.

**Empty, loading, error — treat as first-class screens (Stripe).**
- *Empty:* not "no data" but "Add your first campaign →" with the action inline.
- *Loading:* **skeleton screens** shaped like the content, never a centered spinner.
- *Error:* what happened, why, and the one button that fixes it.

**Charts (Carbon data-viz).** Consistent axis labels, the fixed categorical palette,
direct labeling over legends where possible, accessible contrast, and a sparkline language
for inline trends (followers, spend, signal volume).

**Accessibility floor (Carbon, non-negotiable).** WCAG AA contrast, full keyboard
operability, visible focus rings (amber), correct ARIA on modals/menus/tables, focus trap +
restore on dialogs, and screen-reader labels in the active language.

---

## 5. Signature features & competitive edge

### The moat: the **closed intelligence loop**
Generic tools are silos — a CRM *or* a social tool *or* a project board. HELM's unique
mechanic is the **loop**, and it should be made visible and clickable end-to-end:

> **Sense → Capture → Plan → Execute → Measure → (back to Sense)**
> Market Intel signal → one click to **Lead** → attach to a **Campaign** → schedule
> **Content** + **Events** → draw down **Budget** → results roll up to the **Command
> Center** → which reshapes what you watch next.

No incumbent does market-sensing → pipeline → execution → measurement in *one Arabic-first
surface*. Lean the entire product narrative on this loop.

### The differentiators to sharpen
1. **RTL excellence.** True, mirrored, beautiful Arabic — almost no marketing OS does this
   well. Own it.
2. **Dual-currency native (SDG/USD).** Built for inflationary / dual-currency economies:
   every money value shows both, rate is editable and timestamped, reports convert
   correctly. Unique and deeply practical.
3. **Built-in OSINT.** Free Google News + GDELT market sensing inside the marketing tool —
   competitors make you buy a separate platform.
4. **Sovereign + offline-capable.** Self-hostable (Docker + Postgres), PWA-ready for weak
   connectivity. Data stays in-country if you want it to.
5. **Industrial-B2B fit.** Long sales cycles, tenders, distributors, business units
   (batteries/solar/plastics/ICT) — modeled natively, unlike consumer-marketing tools.
6. **Operator-grade speed.** ⌘K, keyboard flows, optimistic UI — feels like a pro tool,
   not a form-filler.

### Signature additions worth building
- **"Today" briefing (Command Center upgrade):** one screen on login — what changed
  overnight (new signals, leads, due content, budget alerts), per role.
- **Field mode:** a phone-optimized, large-touch, offline-tolerant view for the
  events/BTL team on site.
- **Currency-aware everything:** a rate banner, automatic dual display, and a "what this
  costs today" recompute when the rate changes.
- **Signal → action shortcuts:** from any intel signal, one tap to lead, task, or content
  idea.
- **Saved views & segments:** Stripe-style filtered, named, shareable table views.

---

## 6. The problems HELM solves (product thesis & positioning)

**Who:** marketing teams in Arabic-speaking, emerging / dual-currency markets — starting
with industrial B2B groups like Saria, expandable to any regional SME marketing
department.

**The pain today:** they stitch together a foreign CRM (English-first, single-currency
mindset, pricey, connectivity-hungry), a separate social scheduler, a spreadsheet for
budget, WhatsApp for tasks, and *nothing* for market intelligence — none of it speaks
Arabic-first, none handles SDG/USD, none works well on a weak connection, and none
connects market signals to pipeline to execution.

**Why HELM wins:** one Arabic-first, dual-currency, self-hostable surface that runs the
*whole* marketing function and closes the intelligence loop — at a fraction of the cost,
on the network they actually have. Incumbents (HubSpot, Monday, Salesforce MC) can't
easily follow into true RTL + dual-currency + sovereignty + built-in OSINT without
rebuilding their core. That's the defensible position.

---

## 7. Architecture & implementation

- **Tokens → code.** Encode §3 as CSS variables + `tailwind.config.js` theme extensions.
  Components reference tokens only. This unlocks dark mode, white-label, and per-tenant
  theming with near-zero rework.
- **Component discipline.** Grow `ui.tsx` into a small, documented library: `Table`,
  `DataCell`, `Toolbar`, `BulkBar`, `CommandPalette`, `Toast`, `Skeleton`, `EmptyState`,
  `Money`, `Sparkline`. One source of truth per pattern.
- **Performance.** Skeletons + optimistic UI (instant feel), route-level code-splitting,
  list virtualization for large tables, debounced search, cached lookups.
- **Offline / PWA.** Service worker for app shell + read-cache; queue writes when offline
  and replay on reconnect. Fits the low-bandwidth heritage; turns "resilient" into a
  shipped feature.
- **Accessibility.** Bake the §4 floor into the shared components so every screen inherits
  it.
- **Data layer is already sound.** The Postgres model + Express API are the right base;
  this work sits on top without schema churn. Keep tokens/components in the frontend,
  business logic on the server.

---

## 8. The "perfect logic" — core flows as explicit state machines

Encoding flows as state machines removes ambiguity and makes the UI predictable.

- **Lead pipeline:** `NEW → QUALIFIED → PROPOSAL → NEGOTIATION → WON | LOST`. Allowed
  transitions only; `WON` can spawn an Odoo hand-off; `LOST` requires a reason. (Already
  modeled — surface the transitions as the only affordances.)
- **Content approval:** `IDEA → IN_PROGRESS → REVIEW → APPROVED → PUBLISHED`, with
  role-gated steps (Content drafts, Head approves).
- **Campaign lifecycle:** `PLANNING → ACTIVE → PAUSED → COMPLETED`, with budget and content
  attached; status drives what the Command Center counts.
- **Social account:** `PENDING → CONNECTED → DISCONNECTED`; sync only from `CONNECTED`.
- **Intel signal:** `NEW → TRIAGED → (LEAD | DISMISSED | WATCH)` — make triage one tap.
- **The loop (the product):** every "create" carries context forward (signal→lead keeps the
  source; lead→campaign keeps the company; campaign→content keeps the brief), so the chain
  is traceable end-to-end and reports can attribute outcomes back to signals.

**Interaction logic rules:** one consistent CRUD pattern everywhere; optimistic write →
confirm → rollback-on-error; role determines *visible affordances*, not just permissions;
destructive actions are reversible or confirmed; the active language flows to every label,
date, number, and direction.

---

## 9. Prioritized roadmap

**Phase 1 — Foundation (highest leverage, do first)**
1. Formalize tokens, type ramp, spacing, motion in `tailwind.config.js` + CSS vars.
2. Skeletons everywhere; optimistic save + honest error states (kill the misleading ones).
3. ⌘K command palette + global search + keyboard nav.
4. Accessibility pass on shared components (focus, ARIA, contrast).

**Phase 2 — Signature**
5. Carbon-grade `Table` (sort, density, multi-select bulk bar, pagination, tabular numbers).
6. The visible **intelligence loop**: signal→lead→campaign→content shortcuts + traceability.
7. "Today" briefing on the Command Center; per-role.
8. Currency-aware components (`Money`, rate banner, recompute on rate change).

**Phase 3 — Depth & reach**
9. Field mode (mobile/offline) + PWA service worker + write queue.
10. Data-viz system (consistent charts, sparklines, the categorical palette).
11. Saved views/segments; dark/light theming via tokens; first-run onboarding.

---

## 10. Tradeoffs & honest cautions

- **Density vs. simplicity.** Carbon density is powerful but can overwhelm. Default to
  *comfortable*; let power users opt into *compact*. Don't show everything because you can.
- **Don't over-design.** "Earn the ink" cuts both ways — resist adding animation, gradients,
  and chrome in the name of "polish." Restraint *is* the Stripe lesson.
- **Offline/PWA has real cost.** It's worth it for your context, but it adds complexity
  (cache invalidation, write replay). Phase it; ship read-cache first.
- **Performance budget.** Every dependency and animation is weighed against a weak-network
  user. Keep the bundle lean (it already is).
- **Scope discipline.** This is a multi-quarter vision. Phase 1 alone will make HELM feel
  dramatically more professional; ship it before reaching for Phase 3.

---

*Calm command. Earn the ink. Bilingual by construction. Optimistic and honest.
One model, many rooms. Built for the field.*
