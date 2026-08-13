import { useEffect } from "react";
import { useFetch } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { applyAccent } from "../lib/theme";
import PulseMark from "../components/PulseMark";

// ── BRAND CENTER (/brand) — the public brand book ────────────────────
// Editorial, shareable, always current. Only rows marked public.

interface BrandAsset { id: string; kind: string; label: string; labelAr?: string; value?: string; url?: string }
interface Payload { org: { orgName?: string; orgNameAr?: string; logoUrl?: string; accentColor?: string } | null; assets: BrandAsset[] }

export default function BrandCenter() {
  const { lang, tr, setLang } = useI18n();
  const { data } = useFetch<Payload>("/brand");
  useEffect(() => { if (data?.org?.accentColor) applyAccent(data.org.accentColor); }, [data]);
  const L = (a: BrandAsset) => (lang === "ar" && a.labelAr ? a.labelAr : a.label);
  const by = (k: string) => (data?.assets || []).filter((a) => a.kind === k);
  const orgName = data?.org ? (lang === "ar" ? data.org.orgNameAr || data.org.orgName : data.org.orgName) : "";

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="bg-ink-950 px-5 pb-10 pt-8 text-paper-50">
        <div className="mx-auto flex max-w-3xl items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              {data?.org?.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-10 w-10 rounded-xl bg-white/10 object-contain p-1" /> : <PulseMark className="h-10 w-10 text-amber-500" />}
              <div>
                <h1 className="text-xl font-semibold">{orgName || "…"}</h1>
                <p className="text-sm text-paper-50/60">{tr("bc_title")}</p>
              </div>
            </div>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-paper-50/80 hover:bg-white/10">
            {lang === "ar" ? "EN" : "عربي"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-5 py-8">
        {by("COLOR").length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{tr("bc_colors")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {by("COLOR").map((a) => (
                <div key={a.id} className="overflow-hidden rounded-xl2 border border-paper-200 bg-white shadow-soft">
                  <div className="h-20" style={{ background: a.value || "#ccc" }} />
                  <div className="px-3 py-2">
                    <div className="text-sm font-medium text-ink-800">{L(a)}</div>
                    <div className="kpi-num text-xs text-ink-400" dir="ltr">{a.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {by("LOGO").length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{tr("bc_logos")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {by("LOGO").map((a) => (
                <a key={a.id} href={a.url || "#"} target="_blank" rel="noreferrer"
                  className="overflow-hidden rounded-xl2 border border-paper-200 bg-white shadow-soft transition hover:border-paper-300">
                  {a.url && (
                    <div className="flex h-28 items-center justify-center bg-paper-100 p-3">
                      <img src={a.url} alt={L(a)} loading="lazy" className="max-h-full max-w-full object-contain" />
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-ink-800">{L(a)}</span>
                    <span className="text-xs text-steel-600">{tr("bc_download")} ↗</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {by("FONT").length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{tr("bc_fonts")}</h2>
            {by("FONT").map((a) => (
              <div key={a.id} className="rounded-xl2 border border-paper-200 bg-white px-4 py-3 shadow-soft">
                <div className="text-lg text-ink-800" style={{ fontFamily: a.value || undefined }}>{a.value}</div>
                <div className="text-xs text-ink-400">{L(a)}</div>
              </div>
            ))}
          </section>
        )}

        {by("TONE").length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{tr("bc_tone")}</h2>
            {by("TONE").map((a) => (
              <blockquote key={a.id} className="rounded-xl2 border-s-4 border-amber-500 bg-white px-4 py-3 text-ink-700 shadow-soft">{a.value}</blockquote>
            ))}
          </section>
        )}

        {by("DOC").length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{tr("bc_docs")}</h2>
            <div className="space-y-2">
              {by("DOC").map((a) => (
                <a key={a.id} href={a.url || "#"} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-paper-200 bg-white px-4 py-2.5 text-sm text-ink-800 hover:border-paper-300">
                  {L(a)} <span className="text-xs text-steel-600">↗</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {data && data.assets.length === 0 && <p className="py-16 text-center text-ink-400">{tr("bc_empty")}</p>}
        <footer className="border-t border-paper-200 pt-4 text-center text-[11px] text-ink-300">Pulse · نبض</footer>
      </main>
    </div>
  );
}
