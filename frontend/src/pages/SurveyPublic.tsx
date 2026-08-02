import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { applyAccent } from "../lib/theme";
import PulseMark from "../components/PulseMark";
import { ConfirmationWave } from "./FormPublic";

// ── /s/:slug — the public survey surface ─────────────────────────────
// SCALE questions render as tap-targets (0–10 NPS, 1–5 CSAT); LINKED
// audiences identify themselves; the wave closes the loop.

interface Q { key: string; text: string; textAr?: string; type: string; required?: boolean; options?: string[]; max?: number }
interface Payload { name: string; nameAr?: string; slug: string; kind: string; audience: string; questions: Q[];
  org: { orgName?: string; orgNameAr?: string; logoUrl?: string; accentColor?: string } | null }

export default function SurveyPublic({ slug }: { slug: string }) {
  const { lang, tr, setLang } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [identity, setIdentity] = useState({ name: "", phone: "", email: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wave, setWave] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/surveys/${encodeURIComponent(slug)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setData(j);
      if (j.org?.accentColor) applyAccent(j.org.accentColor);
    } catch (e) { setErr((e as Error).message); }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!data) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/public/surveys/${encodeURIComponent(data.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, identity, _hp: "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setWave(true); setTimeout(() => { setWave(false); setDone(true); }, 1700);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const orgName = data?.org ? (lang === "ar" ? data.org.orgNameAr || data.org.orgName : data.org.orgName) : "";
  const title = data ? (lang === "ar" && data.nameAr ? data.nameAr : data.name) : "…";

  if (err && !data) {
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
      {wave && <ConfirmationWave text={tr("sv_thanks")} />}
      <div className="card w-full max-w-lg overflow-hidden p-0">
        <div className="flex items-center justify-between bg-ink-950 px-5 py-4 text-paper-50">
          <div className="flex items-center gap-3">
            {data?.org?.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-9 w-9 rounded-xl bg-white/10 object-contain p-1" /> : <PulseMark className="h-9 w-9 text-amber-500" />}
            <div>
              <div className="text-[11px] text-paper-50/50">{orgName}</div>
              <div className="text-sm font-semibold">{title}</div>
            </div>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-white/15 px-2 py-1 text-xs text-paper-50/80 hover:bg-white/10">
            {lang === "ar" ? "EN" : "عربي"}
          </button>
        </div>
        <div className="space-y-5 p-5">
          {done ? (
            <div className="rounded-xl2 border border-moss-500/30 bg-moss-500/[.06] px-4 py-8 text-center text-ink-700">{tr("sv_thanks")}</div>
          ) : (
            <>
              {(data?.questions || []).map((q) => {
                const label = (lang === "ar" && q.textAr ? q.textAr : q.text) + (q.required ? " *" : "");
                if (q.type === "SCALE") {
                  const max = q.max || 10;
                  return (
                    <div key={q.key}>
                      <div className="label">{label}</div>
                      <div className="flex flex-wrap gap-1.5" dir="ltr">
                        {Array.from({ length: max + 1 }, (_, n) => (
                          <button key={n} onClick={() => setAnswers({ ...answers, [q.key]: n })}
                            className={`kpi-num h-9 min-w-9 rounded-lg border text-sm transition-colors ${answers[q.key] === n ? "border-amber-500 bg-amber-500 font-semibold text-ink-950" : "border-paper-300 bg-white text-ink-600 hover:border-amber-500/60"}`}>
                            {n}
                          </button>
                        ))}
                      </div>
                      {max === 10 && (
                        <div className="mt-1 flex justify-between text-[10px] text-ink-400" dir="ltr">
                          <span>{lang === "ar" ? "غير محتمل" : "Not likely"}</span><span>{lang === "ar" ? "محتمل جدًا" : "Very likely"}</span>
                        </div>
                      )}
                    </div>
                  );
                }
                if (q.type === "CHOICE") return (
                  <div key={q.key}>
                    <div className="label">{label}</div>
                    <div className="space-y-1.5">
                      {(q.options || []).map((o) => (
                        <button key={o} onClick={() => setAnswers({ ...answers, [q.key]: o })}
                          className={`block w-full rounded-lg border px-3 py-2 text-start text-sm ${answers[q.key] === o ? "border-amber-500 bg-amber-500/10 text-ink-800" : "border-paper-300 bg-white text-ink-600 hover:border-amber-500/60"}`}>
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                );
                return (
                  <label key={q.key} className="block">
                    <span className="label">{label}</span>
                    <textarea rows={3} className="input" value={String(answers[q.key] || "")} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                  </label>
                );
              })}
              {data?.audience === "LINKED" && (
                <div className="rounded-xl border border-paper-200 bg-paper-100/60 p-3">
                  <div className="mb-2 text-xs font-medium text-ink-600">{tr("sv_identify")}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input" placeholder={tr("name")} value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} />
                    <input className="input" dir="ltr" inputMode="tel" placeholder={tr("phone")} value={identity.phone} onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="hidden" aria-hidden="true"><input tabIndex={-1} autoComplete="off" value="" readOnly /></div>
              {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
              <button onClick={submit} disabled={busy} className="btn-amber w-full disabled:opacity-50">{busy ? "…" : tr("pf_send")}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
