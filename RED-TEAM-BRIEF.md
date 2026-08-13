# RED-TEAM BRIEF — the enterprise room, and how it will attack Pulse
*Prepared 2026-08-01 · audited against the actual codebase at 102 tables / 887 checks*
*Internal. Not a sales sheet — a list of where we are genuinely strong and genuinely exposed.*

---

## 0 · How to use this

**Concede fast and precisely.** The fastest way to lose a technical room is to defend something
indefensible. A CISO who catches you overselling one control stops believing the other nine. Every
section below separates *what we can actually claim* from *where the objection lands* — and the
second list is the one to read twice.

**Three rules for the room:**
1. **Never claim a certification we don't hold.** "We are not SOC 2 certified; here is what we do
   instead, and here is what it would take" beats any amount of adjacent language.
2. **Answer with a file path or a test name.** Enterprise technical staff have been lied to by
   vendors their whole careers. Specificity is the differentiator, not confidence.
3. **When they find something real, write it down in front of them.** A vendor who takes the note
   is more credible than one who has an answer for everything.

---

## 1 · The room, and what each person is actually optimising for

| Who | Their real fear | What actually persuades them |
|---|---|---|
| **CMO / Group Marketing Director** | Buying a tool nobody adopts, and owning that failure | Evidence it survives *their* messy reality, not a demo |
| **CTO** | Inheriting a system they cannot maintain or exit | Architecture they can read, and an exit that works |
| **CISO** | A breach traced to a vendor they approved | Precision, and controls they can verify themselves |
| **Head of Applications** | Integration debt and a support queue they didn't ask for | Fits existing identity, monitoring, and change process |
| **Procurement / CFO** | Vendor risk, lock-in, an invoice that grows | Total cost, exit cost, and what happens if we vanish |
| **Rival vendor's rep** | Losing the account | *(They are not persuadable. They are the source of half the objections above.)* |

---

## 2 · The CMO

### What they will say
> *"This looks like it was built for one company. We're a group — six business units, three
> countries, an agency roster. Does it actually work at our size?"*

**Honest answer.** Departments ship as a **dimension**, not cloned systems: one instance, one
upgrade, per-department scoping, and a roll-up where each head sees their own numbers and the GM
sees them side by side. Agency management, guest portals, vendor engagements and deliverables are
already built. Multi-country is **not** — see the gap list.

> *"Our team won't use it. They live in WhatsApp and Excel."*

**This is the strongest thing we have.** Pulse is Arabic-first and RTL-native — not a translated
skin — with WhatsApp Business as a first-class channel including the 24-hour service window enforced
server-side, and a full sovereign export to Excel/CSV at any time. A global vendor's Arabic is an
afterthought; ours is the primary case.

> *"Prove the numbers aren't made up."*

Every metric in the 78-metric catalog traces to rows. Listening signals are graded on the Admiralty
source scale, deduplicated so one syndicated press release cannot count twelve times, and quarantined
for analyst review when relevance is ambiguous. Sentiment **abstains** rather than guessing.
**Ask them to compare that to their incumbent's share-of-voice methodology** — most cannot produce
one.

### Where the objection lands
- **No multi-currency, no multi-country tax/locale model.** USD/SDG only today.
- **No mobile app.** Responsive web only.
- **Adoption risk is real** and no feature answers it. Propose a paid 90-day pilot with one business
  unit and named success criteria, not a platform-wide rollout.

---

## 3 · The CTO

### What they will say
> *"Who else runs this? What happens when you're hit by a bus?"*

**This is the single hardest objection and it has no technical answer.** Do not deflect it. What is
true: the codebase is deliberately small and legible, has **887 automated checks**, a documented
architecture, and — the part CTOs actually respect — **nine production dependencies.**
`bcryptjs, cors, dotenv, express, jsonwebtoken, nodemailer, pg, qrcode, zod`. A typical Node
platform of this scope carries several hundred transitive packages. **Show them `package.json`.**
That is a maintainability and supply-chain argument no competitor can match.

What to offer, in writing: **source code escrow**, a documented handover runbook, and a named
second engineer before any enterprise contract signs.

> *"Instance-per-client? So you patch us separately from everyone else?"*

Yes — deliberately. Their data is in **their own database**, not a shared table with a `tenantId`
column and a row-level-security policy that one bad migration could invert. The trade is real and
should be stated: fleet upgrades are one idempotent migration file per instance, and **upgrade drag
grows linearly with client count**. That is our problem to manage, and the Installer is the answer.

> *"Show me the exit."*

Full sovereign backup of every table as JSON, plus per-resource CSV export. Storage runs on a driver
model — Supabase object storage *or* their own Postgres — so **there is no third party they must
keep paying to read their own files.** Ask the incumbent vendor for the same and watch the room.

### Where the objection lands
- **Bus factor of one.** Genuine, material, unresolved.
- **No staging/production promotion pipeline** documented for client instances.
- **No formal DR runbook with stated RPO/RTO.** Supabase PITR exists; we have not written the
  restore drill or timed it. **Do this before any enterprise meeting.**
- **No load testing.** We do not know where this breaks.

---

## 4 · The CISO — expect the hardest questions here

### What we can defend well
- **MFA**: TOTP is implemented, with enrolment and QR provisioning.
- **Session revocation**: every JWT carries a `tokenVersion`; bumping it invalidates all live
  sessions for that user immediately.
- **RBAC**: instance-defined roles with per-module read/write permissions, enforced in one place.
- **Audit trail**: `audit_log` across write paths, plus `integration_runs`, `mail_log`, `ai_runs`,
  `search_runs`, and `error_log`.
- **Fault logs record shape, never payload.** `error_log` stores field count, field names and a
  hash — **never request bodies**, because those contain contact data. There is a test asserting the
  contents don't appear. *(Say this one slowly; it is unusual and they will notice.)*
- **Supply chain**: nine production dependencies.
- **Tenant isolation by architecture**, not by policy configuration.

### The question they will ask first
> *"You have AI features. Where does our data go?"*

**Answer precisely, because the answer is good.** AI calls are assembled from a fixed evidence list
in `ai-features.js` and `osint/ai-listening.js`: metric names and values, spend totals by platform,
publishing counts, and public listening headlines. **No lead names, no email addresses, no phone
numbers, no message bodies.** The model is called only when the instance has an API key configured,
every call is logged to `ai_runs` with token counts and cost, and a monthly spend ceiling stops
calls *before* they are made.

Then offer, unprompted: **AI can be switched off entirely per instance** and every other feature
continues working. That single sentence closes more security reviews than any control.

### Where the objection lands — fix these before an enterprise pitch

| Finding | Severity | Reality |
|---|---|---|
| **Integration secrets stored unencrypted at rest** (`settings.integrations` jsonb, `social_accounts.accessToken`) | **High** | Masked on read and never returned to a browser — but plaintext in the database. Anyone with a DB dump has the WhatsApp and ad-account tokens. **Fix with envelope encryption before the meeting.** |
| **No security headers** — no CSP, HSTS, X-Frame-Options | **High** | `cors` is configured; `helmet` is not. This is an afternoon's work and they *will* run a scanner. |
| **No SSO / SAML / OIDC / SCIM** | **High** | Enterprise IT will treat local accounts as a policy violation. No workaround. |
| **No data-subject erasure workflow** | **High (GDPR/PDPL)** | `contacts.consent` exists, but there is no "erase everything about this person" endpoint or export. Regulated buyers will ask directly. |
| **No penetration test** | Medium | Never externally tested. Budget one; it is cheap relative to a lost deal. |
| **Password policy is 8 characters** | Medium | No complexity rules, no breach-list check, no rotation. |
| **No sub-processor list or DPA** | Medium | Supabase, Vercel, Resend, Meta, Anthropic all process data. Write the register. |
| **887 checks are self-written** | Low but pointed | Excellent coverage, zero independent verification. Say so first. |

**How to handle this table in the room:** hand it to them. A vendor who arrives with their own
findings list, severity-rated, is a vendor with an engineering culture. One who waits to be caught
is a vendor with a marketing department.

---

## 5 · The Head of Applications

> *"How does it fit our identity, monitoring and change process?"*

**Monitoring is genuinely strong.** `GET /api/health` returns 200/503 based on real subsystem state —
database, nightly job age, publish tick, connector failures, error volume, storage, mail — so it
drops straight into whatever uptime monitor they already run. Every response carries
`X-Request-Id`, and faults are grouped by fingerprint so one recurring bug is one row with a count.

**Identity is the gap.** Local accounts with TOTP, no SSO. Expect this to be a hard gate.

> *"Who supports it at 2am?"*

No 24/7 support, no SLA tiers, no on-call rotation. **Do not invent one.** Offer what is real:
business-hours support in their timezone, a named contact, and the System page so their own team can
triage before escalating.

> *"How do upgrades work?"*

One cumulative idempotent SQL file plus a release. Honest addition: **no automated rollback**, and
no blue/green. A failed migration means restore from PITR.

---

## 6 · The rival vendor — what their rep will say, and what is true in it

They will not attack the product; they will attack the *company*. Expect these, near-verbatim:

**"It's one developer."** — **True, and material.** Answer with escrow, the dependency count, the
test suite, and a hiring commitment. Do not minimise it.

**"No SOC 2, no ISO 27001."** — **True.** Their certification is real and ours is absent. Counter
with what certification does *not* cover: their platform still stores this client's data in a shared
multi-tenant database in another jurisdiction. Ours does not. Different risk, not less risk.

**"They're not GDPR compliant."** — **Partly true.** Data residency and isolation are strong;
data-subject erasure workflow is missing. Fix it, then this becomes a strength.

**"No integrations ecosystem — we have 1,500 apps."** — **True and mostly irrelevant.** Ask how many
of the 1,500 the client uses. Then ask whether their WhatsApp support enforces the 24-hour window
server-side, and whether their Arabic sentiment abstains or guesses.

**"They'll be acquired or shut down."** — Escrow, export, and the driver-model storage answer this
better than reassurance does.

**"That's not real media-mix modelling."** — **Turn this one around.** Our MMM refuses to produce
ROI below ~80 usable weekly observations and reports collinear channels as *inseparable* rather than
splitting credit. **Ask the rep what their MMM does with 30 weeks of data.** If it returns confident
channel ROIs, that is the finding — and every analyst in the room knows it.

**"Their AI is a wrapper."** — Partly true, and the right answer is the discipline: every output is
a draft requiring human acceptance, ungrounded answers are discarded rather than shown, and spend is
capped. **Ask whether their AI ever refuses to answer.** Most cannot.

---

## 7 · The five objections that could actually lose the deal

Ranked by how likely they are to be fatal, not by how loudly they are raised:

1. **Bus factor of one.** No technical answer. Needs escrow + a second engineer + honest framing.
2. **No SSO.** Hard IT gate at most enterprises. **Build it.**
3. **Secrets unencrypted at rest.** One competent security review finds this. **Fix it this week.**
4. **No SOC 2.** Cannot be fixed quickly. Can be neutralised with a security whitepaper, a pen test
   report, and the findings table above.
5. **No data-subject erasure.** Regulatory, binary, and fixable in days.

**Items 2, 3 and 5 are engineering work measured in days-to-weeks. Do them before pitching an
enterprise, not after being asked.**

---

## 8 · Where Pulse should — and should not — be sold right now

**Sell hard into:** Arabic-first organisations where WhatsApp is the primary channel · mid-to-large
regional groups underserved by global vendors · clients with **data sovereignty requirements** that
make a shared multi-tenant platform genuinely unacceptable · organisations whose current reporting
is a monthly deck assembled by hand.

**Do not chase yet:** anything requiring SOC 2 or ISO 27001 at contract stage · multinationals
needing multi-currency and multi-jurisdiction compliance · any buyer whose IT mandates SSO with no
exception path · regulated sectors (banking, healthcare) until the security items above are closed.

**The honest position, and it is a strong one:** Pulse is not a cheaper Sprinklr. It is a platform
built for a market the global vendors serve badly, with an engineering discipline they cannot claim
— sentiment that abstains, models that state their data floor, AI that refuses to answer
ungrounded, and a fault log that deliberately does not copy the customer's own database.

**Lead with the discipline. Concede the certifications. Never oversell one to cover the other.**
