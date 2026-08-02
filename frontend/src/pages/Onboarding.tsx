import { useEffect, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { useBranding } from "../context/BrandingContext";
import { api } from "../lib/api";
import { applyAccent, PULSE_ACCENT } from "../lib/theme";
import PulseMark from "../components/PulseMark";

// ── First-run onboarding wizard (Wave 0) ─────────────────────────────
// The admin shapes the instance before anyone works in it: identity &
// accent, currency, business units, enabled modules. Writes `settings`
// and flips `onboarded`. The ECG progress line is the signature moment —
// the platform's heartbeat advances with every step.

const PRESETS = [PULSE_ACCENT, "#C2603E", "#5E8B5A", "#3F7191", "#7A6CA8", "#3E8F8A"];
const MODULES: { key: string; nameKey: string; descKey: string }[] = [
  { key: "brain", nameKey: "mod_brain", descKey: "mod_brain_d" },
  { key: "intel", nameKey: "mod_intel", descKey: "mod_intel_d" },
  { key: "listening", nameKey: "mod_listening", descKey: "mod_listening_d" },
  { key: "social", nameKey: "mod_social", descKey: "mod_social_d" },
  { key: "media", nameKey: "mod_media", descKey: "mod_media_d" },
  { key: "events", nameKey: "mod_events", descKey: "mod_events_d" },
  { key: "planning", nameKey: "mod_planning", descKey: "mod_planning_d" },
  { key: "studio", nameKey: "mod_studio", descKey: "mod_studio_d" },
  { key: "agency", nameKey: "mod_agency", descKey: "mod_agency_d" },
  { key: "automate", nameKey: "mod_automate", descKey: "mod_automate_d" },
  { key: "research", nameKey: "mod_research", descKey: "mod_research_d" },
];

interface Draft {
  orgName: string; orgNameAr: string; logoUrl: string; accentColor: string;
  localCurrency: string; localCurrencyAr: string; usdToSdgRate: number;
  businessUnits: string[]; modules: Record<string, boolean>;
}

export default function Onboarding() {
  const { lang, tr } = useI18n();
  const { refresh } = useBranding();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [buInput, setBuInput] = useState("");
  const [d, setD] = useState<Draft | null>(null);

  useEffect(() => {
    api.get<Record<string, unknown>>("/settings").then((s) => {
      let bus = (s.businessUnits as string[] | string) ?? [];
      if (typeof bus === "string") { try { bus = JSON.parse(bus); } catch { bus = []; } }
      let mods = (s.modules as Record<string, boolean> | string) ?? {};
      if (typeof mods === "string") { try { mods = JSON.parse(mods); } catch { mods = {}; } }
      const withDefaults: Record<string, boolean> = {};
      for (const m of MODULES) withDefaults[m.key] = (mods as Record<string, boolean>)[m.key] !== false;
      setD({
        orgName: (s.orgName as string) === "Your Organization" ? "" : (s.orgName as string) || "",
        orgNameAr: (s.orgNameAr as string) === "مؤسستك" ? "" : (s.orgNameAr as string) || "",
        logoUrl: (s.logoUrl as string) || "",
        accentColor: (s.accentColor as string) || PULSE_ACCENT,
        localCurrency: (s.localCurrency as string) || "SDG",
        localCurrencyAr: (s.localCurrencyAr as string) || "ج.س",
        usdToSdgRate: Number(s.usdToSdgRate) || 2500,
        businessUnits: bus as string[],
        modules: withDefaults,
      });
    }).catch(() => setError(tr("login_serverError")));
  }, [tr]);

  if (!d) return <div className="grid min-h-screen place-items-center bg-paper text-ink-500">{tr("loading")}</div>;

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const pickAccent = (hex: string) => { setField("accentColor", hex); applyAccent(hex); };
  const addBu = () => {
    const v = buInput.trim();
    if (v && !d.businessUnits.includes(v)) setField("businessUnits", [...d.businessUnits, v]);
    setBuInput("");
  };

  const steps = ["ob_step_identity", "ob_step_money", "ob_step_structure", "ob_step_modules"];
  const last = step === steps.length - 1;

  const finish = async (skip = false) => {
    setBusy(true); setError("");
    try {
      const payload = skip ? { onboarded: true } : {
        orgName: d.orgName || undefined, orgNameAr: d.orgNameAr || undefined,
        logoUrl: d.logoUrl, accentColor: d.accentColor,
        localCurrency: d.localCurrency, localCurrencyAr: d.localCurrencyAr,
        usdToSdgRate: d.usdToSdgRate, businessUnits: d.businessUnits,
        modules: d.modules, onboarded: true,
      };
      await api.patch("/settings", payload);
      await refresh(); // App re-renders straight into the workspace
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const pct = ((step + 1) / steps.length) * 100;

  return (
    <div className="min-h-screen bg-paper bg-grid">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <PulseMark size={40} logoUrl={d.logoUrl || null} />
          <div>
            <div className="text-lg font-bold text-ink-900">{tr("ob_title")}</div>
            <div className="text-xs text-ink-500">{tr("appTagline")}</div>
          </div>
        </div>

        {/* The heartbeat progress line */}
        <div className="relative mb-2 h-8 overflow-hidden" aria-hidden="true">
          <svg className="absolute inset-0 h-full w-full text-paper-300" viewBox="0 0 400 32" preserveAspectRatio="none" fill="none">
            <path d="M0 16h400" stroke="currentColor" strokeWidth="2" />
          </svg>
          <div className="absolute inset-y-0 start-0 overflow-hidden transition-all duration-slow ease-expressive" style={{ width: `${pct}%` }}>
            <svg className="h-full text-amber-500" style={{ width: "42rem", maxWidth: "none" }} viewBox="0 0 400 32" preserveAspectRatio="none" fill="none">
              <path d="M0 16h84l6-10 8 20 6-14 4 6h60l6-9 8 18 6-13 4 5h60l6-10 8 20 6-14 4 6h114"
                stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div className="mb-5 flex items-center justify-between text-xs">
          {steps.map((k, i) => (
            <span key={k} className={i === step ? "font-semibold text-amber-600" : i < step ? "text-ink-600" : "text-ink-300"}>
              {tr(k)}
            </span>
          ))}
        </div>

        <div className="card p-5">
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">{tr("set_orgNameAr")}</span>
                  <input className="input" value={d.orgNameAr} onChange={(e) => setField("orgNameAr", e.target.value)} /></label>
                <label className="block"><span className="label">{tr("set_orgName")}</span>
                  <input className="input" dir="ltr" value={d.orgName} onChange={(e) => setField("orgName", e.target.value)} /></label>
              </div>
              <label className="block"><span className="label">{tr("ob_logo")}</span>
                <input className="input" dir="ltr" placeholder="https://…/logo.png" value={d.logoUrl} onChange={(e) => setField("logoUrl", e.target.value)} /></label>
              <div>
                <span className="label">{tr("ob_accent")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {PRESETS.map((hex) => (
                    <button key={hex} onClick={() => pickAccent(hex)} aria-label={hex}
                      className={`h-8 w-8 rounded-full border-2 transition ${d.accentColor.toUpperCase() === hex.toUpperCase() ? "border-ink-900 scale-110" : "border-transparent"}`}
                      style={{ background: hex }} />
                  ))}
                  <input type="color" value={d.accentColor} onChange={(e) => pickAccent(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-paper-300 bg-white p-0.5" aria-label={tr("ob_accent")} />
                </div>
                <p className="mt-2 text-xs text-ink-400">{tr("ob_accent_hint")}</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">{tr("ob_currency_code")}</span>
                  <input className="input font-mono uppercase" dir="ltr" maxLength={5} value={d.localCurrency}
                    onChange={(e) => setField("localCurrency", e.target.value.toUpperCase())} /></label>
                <label className="block"><span className="label">{tr("ob_currency_ar")}</span>
                  <input className="input" value={d.localCurrencyAr} onChange={(e) => setField("localCurrencyAr", e.target.value)} /></label>
              </div>
              <label className="block"><span className="label">{tr("ob_rate")}</span>
                <input className="input" type="number" dir="ltr" value={d.usdToSdgRate}
                  onChange={(e) => setField("usdToSdgRate", Number(e.target.value))} /></label>
              <div className="rounded-lg bg-paper-100 px-3 py-2 text-sm text-ink-600" dir="ltr">
                1 USD = <span className="kpi-num text-ink-800">{d.usdToSdgRate.toLocaleString()}</span> {d.localCurrency}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-ink-500">{tr("ob_bu_hint")}</p>
              <div className="flex gap-2">
                <input className="input" placeholder={tr("ob_bu_placeholder")} value={buInput}
                  onChange={(e) => setBuInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBu())} />
                <button onClick={addBu} className="btn-ghost shrink-0">+ {tr("add")}</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.businessUnits.map((u) => (
                  <span key={u} className="pill bg-amber-50 text-amber-700">
                    {u}
                    <button onClick={() => setField("businessUnits", d.businessUnits.filter((x) => x !== u))}
                      className="ms-1 text-amber-700/70 hover:text-amber-700" aria-label={tr("delete")}>✕</button>
                  </span>
                ))}
                {d.businessUnits.length === 0 && <span className="text-xs text-ink-300">—</span>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-2">
              <p className="mb-3 text-sm text-ink-500">{tr("ob_modules_hint")}</p>
              {MODULES.map((m) => (
                <button key={m.key} onClick={() => setField("modules", { ...d.modules, [m.key]: !d.modules[m.key] })}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-start transition ${d.modules[m.key] ? "border-amber-500/40 bg-amber-50/60" : "border-paper-200 bg-white opacity-70"}`}>
                  <span>
                    <span className="block text-sm font-medium text-ink-800">{tr(m.nameKey)}</span>
                    <span className="block text-xs text-ink-500">{tr(m.descKey)}</span>
                  </span>
                  <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${d.modules[m.key] ? "bg-amber-500" : "bg-paper-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${d.modules[m.key] ? "start-[1.125rem]" : "start-0.5"}`} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && <div className="mt-4 rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{error}</div>}

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy} className="btn-ghost">
              {tr("ob_back")}
            </button>
            <div className="flex items-center gap-3">
              <button onClick={() => finish(true)} disabled={busy} className="text-xs text-ink-400 hover:text-ink-600 hover:underline">
                {tr("ob_skip")}
              </button>
              {last ? (
                <button onClick={() => finish(false)} disabled={busy} className="btn-amber">
                  {busy ? tr("loading") : tr("ob_finish")}
                </button>
              ) : (
                <button onClick={() => setStep(step + 1)} className="btn-primary">{tr("ob_next")}</button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[11px] tracking-wide text-ink-300">{tr("poweredBy")}</div>
      </div>
    </div>
  );
}
