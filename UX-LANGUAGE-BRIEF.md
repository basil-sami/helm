# UX-LANGUAGE-BRIEF — Market Arabic · Builders · Navigation

Three tracks, one session, one standard: the person who opens Pulse should feel it was written *for* the MENA marketer in their own professional register, should build a form the way they'd sketch it on paper, and should never scan 35 flat menu items to find the board report — which, the audit found, **had no menu entry at all**.

## Track 1 — W4·AR · Arabic as market language, not translation

The bar: what a 40-year Arabic-native CMO would sign. Bayan already bans transliteration and bureaucratic register; this track adds the **market-language layer** and codifies it into BAYAN.md so it survives every future contributor:

1. **Executive marketing register.** الاستقطاب والتحويل for acquisition & conversion (never الالتقاط); الولاء for retention; العلاقات الإعلامية for press outreach. The words a Gulf/Sudanese CMO uses in a board meeting.
2. **Honesty in naming.** The AI is المستشار الذكي — an adviser, never المدير: Pulse's own law is that AI drafts and humans dispose, and the menu must not promote the machine above the human.
3. **Disambiguation rule.** التواصل is banned as a screen name — it collides between social media and outreach; each surface gets its precise name (وسائل التواصل، العلاقات الإعلامية).
4. **Rail discipline.** Navigation labels ≤ 2 words, noun-first, definite article consistent.

Applied this session to every navigation label, the seven new group names, and the builder vocabulary; the rules go into BAYAN.md as **§ لغة السوق** with before/after examples.

## Track 2 — W4·BLD · Builders with SurveyMonkey DNA

The current editors have the right bones (structured fields, no raw JSON) and the wrong ceremony: a cramped list, no preview, no starting point, manual slugs. The rebuild, shared between Forms and Surveys through one `Builder` component family:

1. **Quick-starts.** A form is born from a template, not a blank: طلب تواصل (lead capture), تسجيل فعالية (event RSVP), طلب عرض سعر (quote request); surveys from NPS / CSAT / تقييم فعالية — each fully bilingual, each matching the exact payload the backend already accepts (pinned by new tests).
2. **The palette.** Add a field by tapping its type chip; edit label AR/EN inline; toggle required; options editor appears only for select/choice; reorder with ↑↓; remove with one tap.
3. **Live preview.** A pane rendering the public form as the *respondent* will see it — RTL Arabic-first with a language toggle, required markers, select options, the success message — beside the editor on desktop, below on mobile. What you ship is what you saw.
4. **Slug without thinking.** Auto-suggested from the name (transliteration-safe), editable, shown as the full public URL with one-tap copy.

Zero backend changes: `fields`/`questions` jsonb contracts untouched — proven by round-trip tests posting each template verbatim.

## Track 3 — W4·NAV · Seven groups, nothing lost, one thing found

35 flat entries become seven labeled groups; every existing route keeps its place, the **Report page gains the nav entry it never had**, and a group whose modules are all off disappears whole:

| Group (AR / EN) | Members |
|---|---|
| يومك / Your Day | Dashboard · Morning Pulse · Tasks · Approvals · Inbox |
| التخطيط / Plan | Planning · Growth · Campaigns · Calendar · Events · Budget · Media Plans · Playbooks · Audience · Products |
| النشر والإبداع / Create & Publish | Publish · Studio · Library · Social · Links |
| الاستقطاب والتحويل / Capture & Convert | Forms · Landing Pages · Surveys · Automate · Leads · Customers · Contacts |
| القياس والفهم / Insight | Analytics · **Executive Report (new)** · Web · Listening · Market Intel · AI Adviser |
| الشركاء / Partners | Agencies · Media & KOL · Media Relations (Reach) |
| الإدارة / Admin | Users · System · Settings (admins only, as today) |

Same filtering rules (module flags, permissions), same mobile tab bar, RTL-true section headers in the Nabd rail style.

## Proof obligations
Template payloads round-trip through the real API verbatim (forms + surveys) · the nav registry still contains every pre-existing route plus `/report` (a static test walks NAV against the router) · Bayan passes on every new string · tsc clean · full suite green.
