import { Lang } from "../locales/dict";

// ═══ BAYAN RUNTIME (W4·G) ═════════════════════════════════════════════
// The mechanisms BAYAN.md promises. Everything here is native Intl —
// no dependency joins the nine for language handling.

// ── Numerals ─────────────────────────────────────────────────────────
// Charter §3: data uses Western digits; Arabic-Indic is reserved for
// editorial brand moments. Plain "ar-EG" renders ٠١٢٣, so every data
// locale carries the -u-nu-latn extension. Editorial callers opt in.
export const AR_DATA = "ar-EG-u-nu-latn";
export const AR_EDITORIAL = "ar-EG";
export const dataLocale = (lang: Lang) => (lang === "ar" ? AR_DATA : "en-US");

/** Arabic-Indic digits, for headline/brand moments only (charter §3). */
export function editorialNum(n: number): string {
  return new Intl.NumberFormat(AR_EDITORIAL, { maximumFractionDigits: 0 }).format(n || 0);
}

// ── Plurals ──────────────────────────────────────────────────────────
// Arabic has six categories. English "(s)" hacks and "1 حملات" are both
// forbidden; declare the phrase set and let Intl.PluralRules choose.
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
const AR_RULES = new Intl.PluralRules("ar");
const EN_RULES = new Intl.PluralRules("en");

/**
 * plural(3, { zero:"لا حملات", one:"حملة واحدة", two:"حملتان", few:"{n} حملات", many:"{n} حملة", other:"{n} حملة" }, "ar")
 * `{n}` is substituted with the count in the locale's data numerals.
 */
export function plural(n: number, forms: PluralForms, lang: Lang = "ar"): string {
  const rules = lang === "ar" ? AR_RULES : EN_RULES;
  const cat = rules.select(n) as Intl.LDMLPluralRule;
  const tpl = forms[cat] ?? forms.other;
  const num = new Intl.NumberFormat(dataLocale(lang), { maximumFractionDigits: 0 }).format(n || 0);
  return tpl.replace(/\{n\}/g, num);
}

// ── Bidi isolation ───────────────────────────────────────────────────
// Latin fragments inside an Arabic sentence reorder without isolation —
// the invisible bug class that makes an RTL product feel broken.
const FSI = "\u2068", PDI = "\u2069";
/** Wrap a foreign-direction fragment so it cannot reorder its host sentence. */
export function iso(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === "") return "";
  return `${FSI}${s}${PDI}`;
}

// ── Dates ────────────────────────────────────────────────────────────
// Charter §3: Gregorian by default, hijri alongside — never hijri alone,
// because clients reconcile with international suppliers.
export function hijri(iso_: string | Date | null | undefined, lang: Lang = "ar"): string {
  if (!iso_) return "";
  const d = iso_ instanceof Date ? iso_ : new Date(iso_);
  if (isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(
      lang === "ar" ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-US-u-ca-islamic-umalqura",
      { day: "numeric", month: "long", year: "numeric" }
    ).format(d);
  } catch { return ""; }
}

/** "12 Aug 2026 · 18 صفر 1448" — the dual form used on calendar surfaces. */
export function dualDate(iso_: string | Date | null | undefined, lang: Lang = "ar"): string {
  if (!iso_) return "—";
  const d = iso_ instanceof Date ? iso_ : new Date(iso_);
  if (isNaN(d.getTime())) return "—";
  const greg = new Intl.DateTimeFormat(dataLocale(lang), { day: "numeric", month: "short", year: "numeric" }).format(d);
  const h = hijri(d, lang);
  return h ? `${greg} · ${h}` : greg;
}

/** Month grid helper for the W4·D calendar: every day of a month, padded to whole weeks. */
export function monthGrid(year: number, month: number, weekStartsOn = 6): Date[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const start = new Date(first); start.setUTCDate(1 - lead);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); days.push(d); }
  while (days.length > 35 && days[35].getUTCMonth() !== month) days.length = 35;
  return days;
}
