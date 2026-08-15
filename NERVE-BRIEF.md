# NERVE-BRIEF — الجهاز العصبي · One Nervous System

**The ask:** deeper control over the finance model and over planning/strategy, with everything connected like one nerve tissue. **The insight that makes it one wave:** the spine already exists — thirteen tables carry `campaignId` (the very reason the polymorphic join was rejected mid-build). Money, plans, execution, and outcomes are already *adjacent*; the nerve makes them *connected*, and connection is what control actually is.

## Three laws

**1 · One money truth (المال عصبٌ واحد).** Money today lives in scattered pools — campaign envelopes, budget entries, ad spend, agency invoices, media placements. The finance model unifies them into one triad per campaign, per department, and per channel: **المخطط** (planned — the envelope, `campaigns.budgetUsd`), **الملتزم** (committed — approved-not-yet-paid obligations), **المصروف** (actual — money gone: ad spend and paid invoices). Every figure cites its rows. Money the graph cannot link to a campaign lands in a *declared* «غير مربوط» pool — grounded-or-silent applied to finance: an unlinked dollar is named, never silently zeroed and never guessed into a campaign. The three rollups must reconcile to one grand total, cross-checked by test.

**2 · Control lives at the signature.** No new control surface — the approvals engine is already the single door, so finance control plugs in there: the invoice preview gains a budget-context line, *"approving this takes {campaign} to N% of its envelope"* — amber at ≥90%, clay at ≥100%. **Warn, never block**: the GM decides, Pulse informs — the platform's standing law, now speaking money.

**3 · Strategy closes the loop through the spine.** `GET /api/nerve/campaigns/:id` materializes the tissue: the money triad plus live counts of everything the campaign touches — content, variants, scheduled slots, leads, links, forms, submissions, events, placements, spend rows, invoices, tasks, key results — plus the objectives it serves. Planning gains the reverse direction: each objective shows its campaigns, their combined envelope/committed/actual, and measured progress from the self-filling KRs — **strategy → money → execution → outcome on a single line.** If objectives lack campaign linkage, they gain `campaignIds uuid[]` (columns only; 113 preserved; SEC·D precedent) with a picker in Planning.

## Surfaces
`GET /api/finance/overview` (campaign rows + unlinked pool + department and channel rollups + health flags ضمن الحد / اقترب من الحد / تجاوز الحد at 90/100) · `GET /api/nerve/campaigns/:id` · the extended invoices previewer. **UI:** Budget becomes the Finance Model (triad bars, health pills, the unlinked-pool card); CampaignRoom gains the Nerve panel; Planning gains the objective nerve line; the Approvals preview shows the colored percentage.

## Verified at baseline (audit before build — always)
Exact columns of `budget_entries` and `ad_spend` · invoice status enum and its PAID state · `engagements.campaignId` · existing objective/KR↔campaign linkage · placement cost columns · whether invoice approval already releases a budget entry (**reuse that rail — money never gets a second writer**). Findings recorded in the masterplan entry.

## Proof obligations
Plant: campaign envelope 10,000 · approved invoice 3,000 via engagement · ad spend 4,500 · paid invoice 1,000 → overview reads 10,000 / 3,000 / 5,500 = 85% ضمن الحد · one more approved 1,000 → 95% flips اقترب · the next invoice's approval preview carries a ≥100% budget-context line · nerve tissue counts equal planted rows exactly · unlinked spend lands only in the declared pool · campaign+unlinked totals reconcile with the department and channel rollups · Bayan green on every string · full suite green, zero regressions.
