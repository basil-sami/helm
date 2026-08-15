import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { applyAccent } from "../lib/theme";
import PulseMark from "../components/PulseMark";
import { PublicFormRenderer, ConfirmationWave, type PubForm } from "./FormPublic";

// ── /l/:slug — the public landing page ───────────────────────────────
// Block-based, bilingual, accent-branded, with the campaign's form
// embedded and the same submission pipeline (src = the page slug).

interface Block { kind: string; heading?: string; headingAr?: string; sub?: string; subAr?: string;
  body?: string; bodyAr?: string; label?: string; labelAr?: string;
  items?: { t: string; tAr?: string; d?: string; dAr?: string }[] }
interface Payload { slug: string; title: string; titleAr?: string; blocks: Block[];
  theme?: { primary?: string } | string;
  org: { orgName?: string; orgNameAr?: string; logoUrl?: string; accentColor?: string } | null; form: PubForm | null }

export default function LandingPublic({ slug }: { slug: string }) {
  const { lang, tr, setLang } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [wave, setWave] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/pages/${encodeURIComponent(slug)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setData(j);
      if (j.org?.accentColor) applyAccent(j.org.accentColor);
    } catch (e) { setErr((e as Error).message); }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const L = (en?: string, ar?: string) => (lang === "ar" ? ar || en : en || ar) || "";
  const orgName = data?.org ? L(data.org.orgName, data.org.orgNameAr) : "";

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

  const themeObj: { primary?: string } = (typeof data?.theme === "string" ? (() => { try { return JSON.parse(data.theme as string); } catch { return {}; } })() : (data?.theme as { primary?: string })) || {};
  const okHex = (v?: string) => /^#[0-9a-fA-F]{6}$/.test(v || "");
  const accent = okHex(themeObj.primary) ? themeObj.primary! : okHex(data?.org?.accentColor) ? data!.org!.accentColor! : "#f59e0b";

  return (
    <div className="min-h-dvh bg-paper-50">
      {wave && <ConfirmationWave text={tr("pf_received")} />}
      <nav className="flex items-center justify-between bg-ink-950 px-5 py-3 text-paper-50">
        <div className="flex items-center gap-2.5">
          {data?.org?.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-8 w-8 rounded-lg bg-white/10 object-contain p-0.5" /> : <PulseMark className="h-8 w-8 text-amber-500" />}
          <span className="text-sm font-medium">{orgName}</span>
        </div>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-white/15 px-2 py-1 text-xs text-paper-50/80 hover:bg-white/10">
          {lang === "ar" ? "EN" : "عربي"}
        </button>
      </nav>

      {(data?.blocks || []).map((b, i) => {
        if (b.kind === "HERO") return (
          <header key={i} className="bg-ink-950 px-5 pb-14 pt-10 text-center text-paper-50">
            <h1 className="mx-auto max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">{L(b.heading, b.headingAr)}</h1>
            {(b.sub || b.subAr) && <p className="mx-auto mt-3 max-w-xl text-paper-50/65">{L(b.sub, b.subAr)}</p>}
            <svg viewBox="0 0 200 24" className="mx-auto mt-8 h-6 w-56 opacity-80" style={{ color: accent }} aria-hidden="true">
              <path d="M0 12 H62 L72 12 78 3 86 21 94 12 H200" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </header>
        );
        if (b.kind === "TEXT") return (
          <section key={i} className="mx-auto max-w-2xl px-5 py-8">
            <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink-700">{L(b.body, b.bodyAr)}</p>
          </section>
        );
        if (b.kind === "FEATURES") return (
          <section key={i} className="mx-auto max-w-3xl px-5 py-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {(b.items || []).map((it, k) => (
                <div key={k} className="card p-4">
                  <div className="font-semibold text-ink-800">{L(it.t, it.tAr)}</div>
                  {(it.d || it.dAr) && <div className="mt-1 text-sm text-ink-500">{L(it.d, it.dAr)}</div>}
                </div>
              ))}
            </div>
          </section>
        );
        if (b.kind === "CTA") return (
          <section key={i} className="px-5 py-6 text-center">
            <button onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth" })} className="rounded-xl px-8 py-3 text-base font-semibold text-ink-950" style={{ backgroundColor: accent }}>
              {L(b.label, b.labelAr) || tr("pf_send")}
            </button>
          </section>
        );
        return null;
      })}

      {data?.form && (
        <section ref={formRef} className="mx-auto max-w-md px-4 pb-14 pt-6">
          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold text-ink-800">{data.form.name}</h2>
            <PublicFormRenderer form={data.form} src={data.slug} onDone={() => { setWave(true); setTimeout(() => setWave(false), 1700); }} />
          </div>
        </section>
      )}
      <footer className="border-t border-paper-200 py-4 text-center text-[11px] text-ink-300">Pulse · نبض</footer>
    </div>
  );
}
