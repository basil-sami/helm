# PERSONA-AUDIT — Seven Chairs, One Platform

**Method.** Seven personas sat down at a live Pulse instance and tried to do their actual jobs: the first-run admin, the daily-driver marketer, the approving GM, the CMO reading the board pack, the agency account lead, the analyst team member, and a principal engineer reading the code the way an acquirer's diligence team would. Every finding below was verified against the code in this repo — file and line — not imagined. Baseline at audit time: 113 tables, 1,264/1,264 checks green.

**Verdict in one line.** The platform's spine is real and disciplined — but the two most-touched surfaces ship with their center missing: **the approver approves blind, and the composer can't carry media**. Both are wiring failures, not design failures: the schema and pipeline underneath already support what the UI never offered.

---

## P0 — Journeys that are shipped-broken (fixed this session → W4·UX)

### 1. Blind approvals — the GM persona
`GET /api/approvals` returns the approval row and requester name only (`backend/src/approvals.js` inbox query). The Approvals page renders "scheduled_posts · Amal · Aug 12 · ✓ ✕". Eng. Yasir is asked to put his name on a post whose **caption he cannot read, image he cannot see, and time he cannot check**. Worse: `ENTITY_LINK` in `Approvals.tsx` maps only invoices/deliverables/asset_versions — a scheduled-post approval **links to the dashboard**. The flagship governance loop — the single feature that justifies "approval" in the sales deck — asks for a signature on a sealed envelope.

**Fix (shipped):** the inbox hydrates a uniform `preview` per row — batched per entity type, one query each, no N+1 — carrying title, dir-aware body (AR/EN caption), platform·format·slot time, media thumbnail, or vendor + amount for invoices. The UI renders it in the pending card and again in the decide modal, and every entity deep-links to its home. An entity the previewer doesn't know returns `preview: null` — declared, never a crash.

### 2. A composer with no media — the marketer persona
`content_variants.assetId` exists in the schema. `publishtick.js` already joins `assets` when notifying. The variants API already accepts `assetId`. **The composer never offers it** (`Publish.tsx` ComposerModal: caption, hashtags, link — no picker, no upload). A social publishing tool that cannot attach an image is the interrupted-run defect pattern in miniature: every layer built, the last wire never landed.

**Fix (shipped):** the composer's new-variant branch gains a media block — pick an existing IMAGE/VIDEO asset from the DAM, or upload inline (file → storage rail → asset row → `assetId`), with thumbnail chip and remove. The queue list joins assets so every scheduled row shows its media; the assignee and the approver both see what will actually go out.

---

## P1 — Friction that costs trust (recorded; designed; not built today)

3. **Monday-morning dead end.** The composer requires *pre-approved* content; a marketer with a fresh idea must discover that content items are born in **Calendar**, get them approved, then return. No inline "draft new content" path, no signpost. *Design:* an inline quick-draft that creates a DRAFT content item and routes it through the existing approvals engine — one door, not two. Until then the composer now at least deep-links the empty state to Calendar.
4. **Unbounded CRUD lists.** `crud.js` runs `SELECT * FROM ${table}`, filters row-visibility **in Node memory**, then slices only if the caller opted in. Correct today (visibility must precede pagination), pathological at month-12 scale on leads/signals/posts. *Design:* visibility-aware SQL pushdown per table (visibility predicates expressed in SQL where possible), default server ceiling, keyset pagination for the four heavy tables. This is a W4·PERF cluster, not a hotfix — the frontend's dropdowns legitimately depend on full lists today.
5. **Silent save on Calendar.** `Calendar.tsx` awaited `api.patch` outside any try/catch — a failed save vanished without a toast. (Small; fixed this session alongside the cluster.)

## P2 — Honesty and polish (backlog, ordered)

6. **Report page zeros vs. off-modules.** `/report` fetches `/listening` unconditionally; with the module off it renders "0 mentions" instead of "module disabled." Zeros that mean *off* violate the platform's own grounded-or-silent law.
7. **Best-time-to-post.** 90 days of analytics history exist; the composer suggests nothing. A per-platform hour histogram is cheap and honest (show sample size; abstain under floor — same discipline as forecasting).
8. **Calendar drag-reschedule** for scheduled slots; today rescheduling means editing fields.
9. **Platform preview mock** in the composer (how the caption truncates per platform).

## What the walkthrough confirmed is *right*
One approvals engine reused everywhere (bulk = N singles through the same door); a state machine that only releases AWAITING_APPROVAL→READY through that engine; useFetch giving every page skeletons, error strings, and empty states; a thin API client with typed errors; Arabic as a written language with a lint that fails the build; refusal-as-feature in MMM/forecasting intact. The bones are enterprise-grade. This audit is about the two rooms guests actually sit in.

---

**Definition of Done for W4·UX (this session):** previews hydrated + rendered · composer media end-to-end · queue thumbnails · Calendar save guarded · new Bayan-clean dict keys · tests spliced and the full suite green · ADMIN-GUIDE section · masterplan amended. No metric-catalog changes (UX wiring introduces no new KPI).
