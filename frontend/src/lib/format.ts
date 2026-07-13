import { Lang } from "../locales/dict";

export function fmtMoney(amount: number, currency: "USD" | "SDG", lang: Lang): string {
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const n = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(amount || 0);
  return currency === "USD" ? `$${n}` : `${n} ${lang === "ar" ? "ج.س" : "SDG"}`;
}

// Compact dual-currency display, e.g. "$12,000 · 30,000,000 SDG"
export function fmtDual(usd: number, sdg: number, lang: Lang): string {
  return `${fmtMoney(usd, "USD", lang)} · ${fmtMoney(sdg, "SDG", lang)}`;
}

export function fmtNum(n: number, lang: Lang): string {
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n || 0);
}

export function fmtDate(iso?: string | null, lang: Lang = "ar"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const locale = lang === "ar" ? "ar-EG" : "en-GB";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
