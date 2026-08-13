import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { applyAccent } from "../lib/theme";
import PulseMark from "../components/PulseMark";

// ── /f/:slug — the public form surface ───────────────────────────────
// Renders any Pulse form: bilingual, honeypotted, accent-branded,
// closes on the ECG confirmation wave.

export interface PubField { key: string; label: string; labelAr?: string; type: string; required?: boolean; options?: string[] }
export interface PubForm { id: string; name: string; slug: string; fields: PubField[]; successMsg?: string; successMsgAr?: string }
interface Org { orgName?: string; orgNameAr?: string; logoUrl?: string; accentColor?: string }

export function ConfirmationWave({ text }: { text: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink-950/70 backdrop-blur-sm animate-fade-in">
      <div className="text-center">
        <svg viewBox="0 0 200 48" className="mx-auto h-12 w-48 text-amber-500">
          <path d="M0 24 H56 L68 24 74 8 82 40 90 24 H144 L200 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" pathLength={100}
            style={{ strokeDasharray: 100, strokeDashoffset: 100, animation: "pulse-draw 1.1s ease-out forwards" }} />
        </svg>
        <div className="mt-2 text-sm font-medium text-paper-50">{text}</div>
      </div>
      <style>{`@keyframes pulse-draw { to { stroke-dashoffset: 0; } }`}</style>
    </div>
  );
}

/** Reusable renderer — the landing page embeds the same component. */
export function PublicFormRenderer({ form, src, onDone }: { form: PubForm; src?: string; onDone?: () => void }) {
  const { lang, tr } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(form.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, src, _hp: "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setDone(true); onDone?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="rounded-xl2 border border-moss-500/30 bg-moss-500/[.06] px-4 py-6 text-center text-sm text-ink-700">
        {(lang === "ar" ? form.successMsgAr || form.successMsg : form.successMsg || form.successMsgAr) || tr("pf_thanks")}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {form.fields.map((f) => {
        const label = (lang === "ar" && f.labelAr ? f.labelAr : f.label) + (f.required ? " *" : "");
        const common = { className: "input", value: values[f.key] || "", onChange: (e: { target: { value: string } }) => setValues({ ...values, [f.key]: e.target.value }) };
        return (
          <label key={f.key} className="block">
            <span className="label">{label}</span>
            {f.type === "textarea" ? <textarea rows={3} {...common} />
              : f.type === "select" ? (
                <select {...common}>
                  <option value="">—</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : <input dir={f.type === "phone" || f.type === "email" ? "ltr" : undefined}
                    type={f.type === "email" ? "email" : "text"} inputMode={f.type === "phone" ? "tel" : undefined} {...common} />}
          </label>
        );
      })}
      <div className="hidden" aria-hidden="true"><input tabIndex={-1} autoComplete="off" value="" readOnly /></div>
      {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
      <button onClick={submit} disabled={busy} className="btn-amber w-full disabled:opacity-50">{busy ? "…" : tr("pf_send")}</button>
    </div>
  );
}

export default function FormPublic({ slug }: { slug: string }) {
  const { lang, tr, setLang } = useI18n();
  const [data, setData] = useState<(PubForm & { org: Org | null }) | null>(null);
  const [err, setErr] = useState("");
  const [wave, setWave] = useState(false);
  const src = new URLSearchParams(window.location.search).get("src") || undefined;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setData(j);
      if (j.org?.accentColor) applyAccent(j.org.accentColor);
    } catch (e) { setErr((e as Error).message); }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const orgName = data?.org ? (lang === "ar" ? data.org.orgNameAr || data.org.orgName : data.org.orgName) : "";
  if (err) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-950 px-6 text-center">
        <div>
          <PulseMark className="mx-auto mb-4 h-12 w-12 text-ink-500" />
          <h1 className="text-lg font-semibold text-paper-50">{tr("pf_notFound")}</h1>
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-dvh place-items-center bg-paper-50 px-4 py-8">
      {wave && <ConfirmationWave text={tr("pf_received")} />}
      <div className="card w-full max-w-md overflow-hidden p-0">
        <div className="flex items-center justify-between bg-ink-950 px-5 py-4 text-paper-50">
          <div className="flex items-center gap-3">
            {data?.org?.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-9 w-9 rounded-xl bg-white/10 object-contain p-1" /> : <PulseMark className="h-9 w-9 text-amber-500" />}
            <div>
              <div className="text-[11px] text-paper-50/50">{orgName}</div>
              <div className="text-sm font-semibold">{data?.name || "…"}</div>
            </div>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-white/15 px-2 py-1 text-xs text-paper-50/80 hover:bg-white/10">
            {lang === "ar" ? "EN" : "عربي"}
          </button>
        </div>
        <div className="p-5">
          {data && <PublicFormRenderer form={data} src={src} onDone={() => { setWave(true); setTimeout(() => setWave(false), 1700); }} />}
        </div>
      </div>
    </div>
  );
}
