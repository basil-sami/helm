import { useFetch, Card, SectionTitle } from "../components/ui";
import { HBars, Funnel } from "../components/charts";
import { useI18n } from "../context/I18nContext";
import { fmtMoney, fmtNum, fmtDate } from "../lib/format";

interface Ana { scorecard: Record<string, number | null>; funnel: { stage: string; count: number; conversion: number }[]; effectiveness?: { byProduct: { name: string; nameAr?: string; pipelineUsd: number; wonUsd: number }[]; postsTop: { title: string; platform: string; er: number }[] } }
interface Li { summary: { mentions8w: number; sovPct: number | null; negSharePct: number; brandSentiment: number } }
interface Obj { label: string; labelAr?: string; progress: number; pace: string }

export default function Report() {
  const { lang, tr, el } = useI18n();
  const { data: a } = useFetch<Ana>("/analytics?window=12m");
  const { data: li } = useFetch<Li>("/listening");
  const { data: objs } = useFetch<Obj[]>("/planning/objectives");
  if (!a) return <div className="py-16 text-center text-ink-500">{tr("loading")}</div>;
  const s = a.scorecard as Record<string, number | null>;

  const K = ({ l, v }: { l: string; v: string }) => (
    <div className="rounded-lg border border-paper-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{l}</div>
      <div className="kpi-num mt-0.5 text-xl text-ink-900">{v}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5 print:max-w-none">
      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-ink-900">{tr("rp_title")}</h1>
        <button onClick={() => window.print()} className="btn-amber">🖨 {tr("rp_print")}</button>
      </div>
      <div className="hidden print:flex items-center gap-3 border-b border-paper-300 pb-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-500 text-xl font-bold text-ink-950">ح</div>
        <div>
          <div className="text-lg font-bold">{tr("rp_title")} — حلم HELM</div>
          <div className="text-xs text-ink-500">{tr("rp_generated")}: {fmtDate(new Date().toISOString(), lang)} · 12m</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <K l={tr("an_pipeline")} v={fmtMoney(s.pipelineUsd || 0, "USD", lang)} />
        <K l={tr("an_won")} v={fmtMoney(s.wonUsd || 0, "USD", lang)} />
        <K l="ROMI" v={s.romiPct != null ? `${s.romiPct}%` : "—"} />
        <K l={tr("an_winRate")} v={`${s.winRatePct ?? 0}%`} />
      </div>

      <Card><SectionTitle>{tr("an_funnel")}</SectionTitle>
        <Funnel data={a.funnel} el={el} /></Card>

      {a.effectiveness && a.effectiveness.byProduct.length > 0 && (
        <Card><SectionTitle>{tr("ef_byProduct")}</SectionTitle>
          <HBars format={(n) => fmtMoney(n, "USD", lang)}
            data={a.effectiveness.byProduct.map((p) => ({ label: lang === "ar" && p.nameAr ? p.nameAr : p.name, value: p.pipelineUsd + p.wonUsd, sub: `${tr("an_won")}: ${fmtMoney(p.wonUsd, "USD", lang)}` }))} /></Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><SectionTitle>{tr("li_title")}</SectionTitle>
          <div className="space-y-1.5 text-sm text-ink-700">
            <div>{tr("li_mentions8w")}: <b className="kpi-num">{fmtNum(li?.summary.mentions8w || 0, lang)}</b></div>
            <div>{tr("li_sov")}: <b className="kpi-num text-amber-700">{li?.summary.sovPct != null ? `${li.summary.sovPct}%` : "—"}</b></div>
            <div>{tr("li_negShare")}: <b className="kpi-num">{li?.summary.negSharePct ?? 0}%</b></div>
          </div></Card>
        <Card><SectionTitle>{tr("nav_planning")}</SectionTitle>
          <div className="space-y-1.5">
            {(objs || []).slice(0, 5).map((o, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="truncate text-ink-700">{lang === "ar" && o.labelAr ? o.labelAr : o.label}</span>
                <span className="kpi-num ms-2 shrink-0 text-ink-800">{Math.round(o.progress)}%</span>
              </div>
            ))}
          </div></Card>
      </div>

      {a.effectiveness && a.effectiveness.postsTop.length > 0 && (
        <Card><SectionTitle>{tr("ef_top")}</SectionTitle>
          {a.effectiveness.postsTop.slice(0, 5).map((p, i) => (
            <div key={i} className="flex items-center justify-between border-b border-paper-100 py-1.5 text-sm last:border-0">
              <span className="truncate text-ink-700">{p.platform} · {p.title}</span>
              <span className="kpi-num ms-2 shrink-0 text-amber-700">{p.er}%</span>
            </div>
          ))}</Card>
      )}
    </div>
  );
}
