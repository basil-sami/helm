# BAYAN.md — بيان · The Pulse Language System

**Nabd is how Pulse looks. Bayan is how Pulse speaks.**

Pulse is Arabic-first. That is a promise about *authorship*, not translation coverage: a marketing director in Khartoum should read our interface and hear a colleague who knows the craft — not a system that was written in English and passed through a dictionary. Generic Arabic in an Arabic-first product is a defect, not a polish item.

This charter is enforced. `npm run lint:ar` reads `frontend/src/locales/glossary.json` and fails the build on drift. Terminology is decided once, here, with reasons.

---

## 1. Register

**Modern professional marketing Arabic.** Modern Standard Arabic as the base, contemporary marketing vocabulary on top, and none of the bureaucratic residue that makes enterprise software read like a ministry circular.

| Write this | Not this | Why |
|---|---|---|
| أنشئ حملة | قم بإنشاء حملة | The bare imperative is the marketing voice; «قم بـ» is padding calqued from English. |
| تُرسل الحملة عند الاعتماد | يتم إرسال الحملة عند الاعتماد | «يتم» is the bureaucratic passive. Arabic has a real passive; use it. |
| راجِع القائمة | الرجاء مراجعة القائمة | Software instructs politely by being direct, not by petitioning. |
| رصد السوق | مراقبة السوق | We listen to a market; we do not surveil people. The word choice carries our guardrail. |
| وسائل التواصل | السوشيال ميديا | Transliteration is the loudest signal that a product was not written in Arabic. |

**Address the user directly** in the second person imperative. The masculine singular is used as the neutral form — a deliberate, documented convention, chosen because Arabic offers no gender-neutral imperative and doubled forms («أنشئ/أنشئي») halve legibility in dense UI. Where a screen addresses an organization rather than a person, the plural is correct («بياناتكم تبقى في نظامكم»).

**Length discipline.** Arabic renders roughly 15–25% shorter than English for the same meaning. A label that needs a subordinate clause is a label that needs rethinking.

---

## 2. Terminology

One Arabic term per concept, for the life of the product. The canonical list is `glossary.json`; changing an entry is a deliberate edit to that file with a rationale, never an ad-hoc improvement inside one screen.

The lint checks **vocabulary, not grammar.** Case inflection is correct Arabic and must never be flagged: «العملاء المحتملون» (nominative) and «مصدر العملاء المحتملين» (genitive after a مضاف) are both right. A linter that fails valid Arabic teaches contributors to disable the linter.

---

## 3. Numerals, dates, and money

- **Data uses Western digits** (0–9): metrics, tables, counts, currency, chart axes. This is a scannability decision — mixed numeral systems inside a dashboard are a legibility tax on the reader.
- **Arabic-Indic numerals (٠١٢٣) are reserved for editorial brand moments** — headline copy, the watermark motif, marketing surfaces where the numeral is design rather than data. This is why «آخر ٣٠ يومًا» in a metric *description* is correct while the metric *value* stays Western.
- **Dates are Gregorian by default, with hijri shown alongside** wherever a calendar surface exists (`islamic-umalqura` via native `Intl`). Never hijri alone — clients reconcile with international suppliers.
- **Currency** follows the instance's configured currency with `Intl.NumberFormat`; never hand-formatted.

---

## 4. Punctuation and orthography

- Arabic comma **،** and semicolon **؛**; Arabic question mark **؟**.
- Hamza and alif orthography follow the same normalization the listening pipeline uses (`osint/arabic.js`), so what we write matches what we match.
- Latin acronyms stay Latin when that is how the industry says them (NPS, CSAT, QR, ROI, SLA). Everything else is Arabic.
- Wrap Latin fragments inside Arabic sentences with the bidi isolate helper — unisolated mixed direction is the invisible bug that makes an RTL product feel broken.

---

## 5. Plurals

Arabic has six plural categories (`zero, one, two, few, many, other`). English `(s)` hacks and «1 حملات» are both forbidden. Use the plural helper:

```ts
plural("campaigns", n)  // ٠ حملات · حملة واحدة · حملتان · ٣ حملات · ١١ حملة …
```

The helper resolves the category with `Intl.PluralRules("ar")` and selects from the phrase set declared with the key. Zero dependencies.

---

## 6. Scope — everything a human reads

The charter governs labels *and*: empty states, validation and error messages, notifications, the Morning Pulse digest, mail templates, board-pack copy, onboarding and guided-setup copy, seeded templates, demo-seed content, and every public surface (link pages, landing pages, kiosk forms, the guest portal). A polished dashboard behind a clumsy error message is not an Arabic-first product.

---

## 7. Governance

- Every cluster's Definition of Done includes Bayan compliance: `npm run lint:ar` green, copy **written** rather than translated.
- New concepts are added to `glossary.json` when they are introduced, not retroactively.
- Contributor rule: if you are unsure how to say something, say it the way a Sudanese marketing manager would say it out loud in a meeting — then check it against §1.


---

## § لغة السوق — Market Language (W4·AR)

Bayan's first duty was correctness — no transliteration, no bureaucratic register. This section adds the second duty: **the register of an Arabic-native CMO in a board meeting**, applied first to navigation and the builders, binding on everything after.

1. **Executive marketing vocabulary.** الاستقطاب والتحويل for acquisition & conversion; الولاء for retention; العلاقات الإعلامية for press outreach; قياس الترشيح for NPS and قياس الرضا for CSAT. If a Gulf or Sudanese CMO would not say the word to their board, it does not go in the menu.
2. **Honesty in naming.** The AI is المستشار الذكي — an adviser, never المدير. Pulse's own law is that AI drafts and humans dispose; the language must not promote the machine above the human. (Was: «المدير الذكي». Changed.)
3. **The disambiguation rule.** التواصل is banned as a screen name — it collided between social media and press outreach. Every surface carries its precise name: وسائل التواصل for social, العلاقات الإعلامية for outreach. A menu word that needs a second look is a wrong word.
4. **Rail discipline.** Navigation labels are at most two words, noun-first, definite article used consistently. Group headers name the *job* (يومك، التخطيط، الاستقطاب والتحويل)، not the software category.
5. **Respondent-facing copy is written for the street, not the office.** Form and survey templates say «رقم الهاتف (واتساب)» and «نلقاك في الفعالية» — warm, direct, regional — never «يرجى إدخال رقم الهاتف الخاص بكم».

Before/after this pass: «التواصل» → «العلاقات الإعلامية» · «المدير الذكي» → «المستشار الذكي» · «النمو» → «النمو والولاء» (the screen is loyalty + referrals; say so).
