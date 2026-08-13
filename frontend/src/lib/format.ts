import { Lang } from "../locales/dict";
import { dataLocale } from "./bayan";

// ── Local currency (Wave 0) ──────────────────────────────────────────
// The second currency is per-client (settings.localCurrency). Call sites
// keep passing the historical "SDG" token — it now means "the local slot".
let LOCAL_CODE = "SDG";
let LOCAL_AR = "ج.س";
export function setLocalCurrency(code?: string | null, ar?: string | null) {
  LOCAL_CODE = (code || "SDG").toUpperCase();
  LOCAL_AR = ar || LOCAL_CODE;
}
export function localCurrencyLabel(lang: Lang) {
  return lang === "ar" ? LOCAL_AR : LOCAL_CODE;
}

export function fmtMoney(amount: number, currency: "USD" | "SDG" | "LOCAL", lang: Lang): string {
  const locale = dataLocale(lang); // Bayan §3: data uses Western digits
  const n = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(amount || 0);
  return currency === "USD" ? `$${n}` : `${n} ${lang === "ar" ? LOCAL_AR : LOCAL_CODE}`;
}

// Compact dual-currency display, e.g. "$12,000 · 30,000,000 SDG"
export function fmtDual(usd: number, sdg: number, lang: Lang): string {
  return `${fmtMoney(usd, "USD", lang)} · ${fmtMoney(sdg, "SDG", lang)}`;
}

export function fmtNum(n: number, lang: Lang): string {
  const locale = dataLocale(lang); // Bayan §3
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n || 0);
}

export function fmtDate(iso?: string | null, lang: Lang = "ar"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const locale = lang === "ar" ? dataLocale(lang) : "en-GB"; // Bayan §3
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
