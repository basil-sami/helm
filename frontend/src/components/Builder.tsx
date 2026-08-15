import { useState } from "react";
import { Select } from "./ui";
import { useI18n } from "../context/I18nContext";

// ═══ W4·BLD — one builder, two territories ═══════════════════════════
// Forms and surveys share the same creation experience: start from a
// template, add items from a type palette, reorder, and watch the live
// respondent preview — RTL Arabic-first — update as you type. Item keys
// are machine-managed; humans never name a database key again. Payload
// shapes are untouched (fields/questions jsonb), pinned by suite tests.

export interface BuilderItem {
  key: string; type: string; required?: boolean; options?: string[];
  label?: string; labelAr?: string;      // forms
  text?: string; textAr?: string;        // surveys
  max?: number;                          // survey SCALE
}
type Mode = "form" | "survey";

export const slugify = (name: string, fallback: string) => {
  const s = (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || `${fallback}-${Date.now().toString(36).slice(-4)}`;
};

const nextKey = (mode: Mode, items: BuilderItem[]) => {
  const p = mode === "form" ? "f" : "q";
  let n = items.length + 1;
  while (items.some((i) => i.key === `${p}${n}`)) n++;
  return `${p}${n}`;
};

const FORM_TYPES = ["text", "phone", "email", "select", "textarea"];
const SURVEY_TYPES = ["SCALE", "CHOICE", "TEXT"];

export const FORM_TEMPLATES: { key: string; items: Omit<BuilderItem, "key">[]; successAr: string; success: string }[] = [
  { key: "bl_tpl_lead", success: "Thanks — we will call you shortly.", successAr: "شكرًا لك — سنتصل بك قريبًا.",
    items: [
      { type: "text", required: true, label: "Your name", labelAr: "الاسم الكامل" },
      { type: "phone", required: true, label: "Phone (WhatsApp)", labelAr: "رقم الهاتف (واتساب)" },
      { type: "text", label: "Company", labelAr: "جهة العمل" },
    ]},
  { key: "bl_tpl_rsvp", success: "You are registered — see you there.", successAr: "تم تسجيلك — نلقاك في الفعالية.",
    items: [
      { type: "text", required: true, label: "Your name", labelAr: "الاسم الكامل" },
      { type: "phone", required: true, label: "Phone (WhatsApp)", labelAr: "رقم الهاتف (واتساب)" },
      { type: "email", required: true, label: "Email", labelAr: "البريد الإلكتروني" },
      { type: "text", label: "Company", labelAr: "جهة العمل" },
    ]},
  { key: "bl_tpl_quote", success: "Request received — a quote is on its way.", successAr: "وصلنا طلبك — عرض السعر في طريقه إليك.",
    items: [
      { type: "text", required: true, label: "Your name", labelAr: "الاسم الكامل" },
      { type: "phone", required: true, label: "Phone (WhatsApp)", labelAr: "رقم الهاتف (واتساب)" },
      { type: "textarea", required: true, label: "What do you need a quote for?", labelAr: "ما الذي تحتاج عرض سعر له؟" },
    ]},
];

export const SURVEY_TEMPLATES: { key: string; kind: string; items: Omit<BuilderItem, "key">[] }[] = [
  { key: "bl_tpl_nps", kind: "NPS", items: [
      { type: "SCALE", required: true, max: 10, text: "How likely are you to recommend us to a friend or colleague?", textAr: "ما احتمال أن ترشحنا لصديق أو زميل؟" },
      { type: "TEXT", text: "What is the reason for your score?", textAr: "ما سبب تقييمك؟" },
    ]},
  { key: "bl_tpl_csat", kind: "CSAT", items: [
      { type: "SCALE", required: true, max: 5, text: "How satisfied are you with your experience?", textAr: "ما مدى رضاك عن تجربتك؟" },
      { type: "TEXT", text: "What should we improve?", textAr: "ما الذي علينا تحسينه؟" },
    ]},
  { key: "bl_tpl_event", kind: "SURVEY", items: [
      { type: "SCALE", required: true, max: 5, text: "Rate the event overall", textAr: "قيّم الفعالية عمومًا" },
      { type: "CHOICE", text: "What stood out most?", textAr: "ما أفضل ما فيها؟",
        options: ["المحتوى", "التنظيم", "فرص التعارف", "المكان"] },
      { type: "TEXT", text: "One suggestion for us", textAr: "اقتراح واحد لنا" },
    ]},
];

export function TemplateBar<T extends { key: string }>({ tpls, onApply }: { tpls: readonly T[]; onApply: (tpl: T) => void }) {
  const { tr } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-ink-500">✨ {tr("bl_templates")}:</span>
      {tpls.map((t) => (
        <button key={t.key} type="button" onClick={() => onApply(t)}
          className="rounded-full border border-amber-500/30 bg-amber-500/[.06] px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-500/15">
          {tr(t.key)}
        </button>
      ))}
    </div>
  );
}

export function ItemEditor({ mode, items, onChange }: { mode: Mode; items: BuilderItem[]; onChange: (items: BuilderItem[]) => void }) {
  const { tr } = useI18n();
  const types = mode === "form" ? FORM_TYPES : SURVEY_TYPES;
  const set = (i: number, patch: Partial<BuilderItem>) => {
    const arr = [...items]; arr[i] = { ...arr[i], ...patch }; onChange(arr);
  };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= items.length) return;
    const arr = [...items]; [arr[i], arr[j]] = [arr[j], arr[i]]; onChange(arr);
  };
  const add = (type: string) =>
    onChange([...items, { key: nextKey(mode, items), type, ...(type === "SCALE" ? { max: 5 } : {}) }]);
  const arKey = mode === "form" ? "labelAr" : "textAr";
  const enKey = mode === "form" ? "label" : "text";
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.key} className="rounded-xl border border-paper-200 bg-white p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="flex flex-col text-[10px] leading-none text-ink-400">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="hover:text-ink-700 disabled:opacity-25">▲</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="hover:text-ink-700 disabled:opacity-25">▼</button>
            </span>
            <div className="w-32 shrink-0">
              <Select value={it.type} onChange={(v) => set(i, { type: v, ...(v === "SCALE" && !it.max ? { max: 5 } : {}) })}
                options={types.map((t) => ({ value: t, label: tr(`bl_t_${t}`) }))} />
            </div>
            <label className="flex items-center gap-1 text-[11px] text-ink-600">
              <input type="checkbox" checked={!!it.required} onChange={(e) => set(i, { required: e.target.checked })} />
              {tr("fm_required")}
            </label>
            {it.type === "SCALE" && (
              <label className="flex items-center gap-1 text-[11px] text-ink-600" dir="ltr">
                0–<input className="input h-7 w-14 px-1.5 py-0 text-xs" type="number" min={2} max={10}
                  value={it.max ?? 5} onChange={(e) => set(i, { max: Math.max(2, Math.min(10, Number(e.target.value) || 5)) })} />
              </label>
            )}
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="ms-auto text-clay-600 hover:text-clay-700">✕</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="input" dir="rtl" placeholder={tr("bl_labelAr")} value={(it[arKey] as string) || ""}
              onChange={(e) => set(i, { [arKey]: e.target.value } as Partial<BuilderItem>)} />
            <input className="input" dir="ltr" placeholder={tr("bl_labelEn")} value={(it[enKey] as string) || ""}
              onChange={(e) => set(i, { [enKey]: e.target.value } as Partial<BuilderItem>)} />
          </div>
          {(it.type === "select" || it.type === "CHOICE") && (
            <input className="mt-2 input" dir="auto" placeholder={tr("fm_optionsPh")} value={(it.options || []).join(", ")}
              onChange={(e) => set(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] font-medium text-ink-500">+ {tr(mode === "form" ? "bl_addField" : "bl_addQ")}:</span>
        {types.map((t) => (
          <button key={t} type="button" onClick={() => add(t)}
            className="rounded-full border border-paper-300 bg-paper-100 px-2.5 py-1 text-[11px] text-ink-700 hover:border-amber-500/40 hover:bg-amber-500/[.06]">
            {tr(`bl_t_${t}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreviewPane({ mode, items, title, titleAr, successMsg, successMsgAr }:
  { mode: Mode; items: BuilderItem[]; title?: string; titleAr?: string; successMsg?: string; successMsgAr?: string }) {
  const { tr } = useI18n();
  const [pl, setPl] = useState<"ar" | "en">("ar");
  const L = (it: BuilderItem) => (pl === "ar"
    ? (mode === "form" ? it.labelAr || it.label : it.textAr || it.text)
    : (mode === "form" ? it.label || it.labelAr : it.text || it.textAr)) || "…";
  const head = pl === "ar" ? (titleAr || title) : (title || titleAr);
  const success = pl === "ar" ? (successMsgAr || successMsg) : (successMsg || successMsgAr);
  return (
    <div className="rounded-2xl border border-paper-200 bg-paper-100/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("bl_respondentView")}</span>
        <span className="flex overflow-hidden rounded-lg border border-paper-300 text-[10px]">
          {(["ar", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setPl(l)}
              className={`px-2 py-0.5 ${pl === l ? "bg-ink-900 text-paper-50" : "bg-white text-ink-500"}`}>
              {l === "ar" ? "ع" : "EN"}
            </button>
          ))}
        </span>
      </div>
      <div dir={pl === "ar" ? "rtl" : "ltr"} className="rounded-xl bg-white p-3 shadow-sm">
        {head && <div className="mb-2.5 font-display text-sm font-bold text-ink-900">{head}</div>}
        <div className="space-y-2.5">
          {items.map((it) => (
            <div key={it.key}>
              <div className="mb-1 text-xs font-medium text-ink-700">
                {L(it)} {it.required && <span className="text-amber-600">*</span>}
              </div>
              {it.type === "textarea" || it.type === "TEXT" ? (
                <div className="h-12 rounded-lg border border-paper-300 bg-paper-50" />
              ) : it.type === "select" || it.type === "CHOICE" ? (
                <div className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1.5 text-xs text-ink-400">
                  {(it.options || []).slice(0, 3).join(" · ") || "—"} ▾
                </div>
              ) : it.type === "SCALE" ? (
                <div className="flex flex-wrap gap-1" dir="ltr">
                  {Array.from({ length: (it.max ?? 5) + 1 }, (_, n) => (
                    <span key={n} className="kpi-num grid h-6 w-6 place-items-center rounded-md border border-paper-300 bg-paper-50 text-[10px] text-ink-500">{n}</span>
                  ))}
                </div>
              ) : (
                <div className="h-8 rounded-lg border border-paper-300 bg-paper-50" />
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-ink-900 py-2 text-center text-xs font-semibold text-paper-50">
          {pl === "ar" ? "إرسال" : "Submit"}
        </div>
        {success && <div className="mt-2 rounded-lg bg-moss-500/10 px-2 py-1.5 text-[11px] text-moss-700">✓ {success}</div>}
      </div>
    </div>
  );
}


// ═══ W4·BLD2 — landing pages join the family ═════════════════════════
export interface LandingBlock {
  kind: "HERO" | "TEXT" | "FEATURES" | "CTA";
  heading?: string; headingAr?: string; sub?: string; subAr?: string;
  body?: string; bodyAr?: string; label?: string; labelAr?: string;
  items?: { t?: string; tAr?: string; d?: string; dAr?: string }[];
}

export const LP_TEMPLATES: { key: string; title: string; titleAr: string; blocks: LandingBlock[] }[] = [
  { key: "lp_tpl_leadgen", title: "Special offer", titleAr: "عرض خاص",
    blocks: [
      { kind: "HERO", heading: "A solution that brings customers to you", headingAr: "حل يوصلك بعملائك",
        sub: "A limited-time offer — leave your number and we call you.", subAr: "عرض لفترة محدودة — اترك رقمك ونتصل بك." },
      { kind: "FEATURES", items: [
        { t: "Fast installation", tAr: "تركيب سريع" },
        { t: "Two-year warranty", tAr: "ضمان سنتان" },
        { t: "WhatsApp support", tAr: "دعم عبر واتساب" } ] },
      { kind: "CTA", label: "Request a call now", labelAr: "اطلب اتصالًا الآن" },
    ]},
  { key: "lp_tpl_event", title: "Meet us at the expo", titleAr: "نلقاك في المعرض",
    blocks: [
      { kind: "HERO", heading: "Meet us at the expo", headingAr: "نلقاك في المعرض",
        sub: "Live demos, exclusive offers, and our whole team.", subAr: "تجارب حية وعروض حصرية وفريقنا كاملًا." },
      { kind: "FEATURES", items: [
        { t: "Live demos", tAr: "تجارب حية" },
        { t: "Expo-only offers", tAr: "عروض حصرية للمعرض" },
        { t: "Talk to the engineers", tAr: "قابل مهندسينا" } ] },
      { kind: "CTA", label: "Register your visit", labelAr: "سجّل حضورك" },
    ]},
  { key: "lp_tpl_promo", title: "Product promo", titleAr: "عرض منتج",
    blocks: [
      { kind: "HERO", heading: "The product your work has been waiting for", headingAr: "المنتج الذي ينتظره عملك" },
      { kind: "TEXT", body: "Two short lines on what it does and why it pays for itself.",
        bodyAr: "سطران قصيران عن ماذا يفعل ولماذا يستحق ثمنه." },
      { kind: "CTA", label: "Request a quote", labelAr: "اطلب عرض السعر" },
    ]},
];

/** Mirrors LandingPublic's block vocabulary in miniature — what you ship is what you saw. */
export function LandingPreview({ blocks, title, titleAr, hasForm, theme }:
  { blocks: LandingBlock[]; title?: string; titleAr?: string; hasForm?: boolean; theme?: { primary?: string } }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(theme?.primary || "") ? theme!.primary! : "#f59e0b";
  const { tr } = useI18n();
  const [pl, setPl] = useState<"ar" | "en">("ar");
  const L = (en?: string, ar?: string) => (pl === "ar" ? ar || en : en || ar) || "";
  return (
    <div className="rounded-2xl border border-paper-200 bg-paper-100/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("bl_visitorView")}</span>
        <span className="flex overflow-hidden rounded-lg border border-paper-300 text-[10px]">
          {(["ar", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setPl(l)}
              className={`px-2 py-0.5 ${pl === l ? "bg-ink-900 text-paper-50" : "bg-white text-ink-500"}`}>
              {l === "ar" ? "ع" : "EN"}
            </button>
          ))}
        </span>
      </div>
      <div dir={pl === "ar" ? "rtl" : "ltr"} className="overflow-hidden rounded-xl bg-white shadow-sm">
        {blocks.map((b, i) => {
          if (b.kind === "HERO") return (
            <div key={i} className="bg-ink-950 px-3 pb-5 pt-4 text-center text-paper-50">
              <div className="text-sm font-bold leading-snug">{L(b.heading, b.headingAr) || L(title, titleAr) || "…"}</div>
              {(b.sub || b.subAr) && <div className="mt-1 text-[10px] text-paper-50/60">{L(b.sub, b.subAr)}</div>}
              <svg viewBox="0 0 200 24" className="mx-auto mt-3 h-3 w-24 opacity-80" style={{ color: accent }} aria-hidden="true">
                <path d="M0 12 H62 L72 12 78 3 86 21 94 12 H200" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          );
          if (b.kind === "TEXT") return (
            <div key={i} className="px-3 py-2.5 text-[11px] leading-relaxed text-ink-700 whitespace-pre-wrap">{L(b.body, b.bodyAr) || "…"}</div>
          );
          if (b.kind === "FEATURES") return (
            <div key={i} className="grid grid-cols-3 gap-1.5 px-3 py-2">
              {(b.items || []).slice(0, 3).map((it, k) => (
                <div key={k} className="rounded-lg border border-paper-200 p-1.5">
                  <div className="text-[10px] font-semibold text-ink-800">{L(it.t, it.tAr) || "…"}</div>
                  {(it.d || it.dAr) && <div className="mt-0.5 text-[9px] text-ink-500">{L(it.d, it.dAr)}</div>}
                </div>
              ))}
            </div>
          );
          if (b.kind === "CTA") return (
            <div key={i} className="px-3 py-2.5 text-center">
              <span className="inline-block rounded-lg px-4 py-1.5 text-[11px] font-semibold text-ink-950" style={{ backgroundColor: accent }}>
                {L(b.label, b.labelAr) || (pl === "ar" ? "إرسال" : "Submit")}
              </span>
            </div>
          );
          return null;
        })}
        {hasForm && (
          <div className="border-t border-dashed border-paper-300 px-3 py-2 text-center text-[10px] text-ink-400">
            ⬇ {tr("bl_formHere")}
          </div>
        )}
      </div>
    </div>
  );
}
