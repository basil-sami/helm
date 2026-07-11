import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFetch, Card, SectionTitle, SkeletonCards } from "../components/ui";
import { HBars, Funnel, AreaTrend, Donut } from "../components/charts";
import { useI18n } from "../context/I18nContext";
import { fmtMoney, fmtNum } from "../lib/format";
import { ReactNode } from "react";

interface Effectiveness {
  postsTop: { platform: string; title: string; pillar?: string | null; er: number; reach: number; engagement: number; clicks: number }[];
  erByChannel: { label: string; er: number; posts: number }[];
  erByPillar: { label: string; er: number; posts: number }[];
  byProduct: { id: string; name: string; nameAr?: string; leads: number; pipelineUsd: number; wonUsd: number }[];
}

interface Analytics {
  effectiveness?: Effectiveness;
  scorecard: {
    pipelineUsd: number; weightedUsd: number; wonUsd: number; winRate: number; avgDealUsd: number;
    totalLeads: number; qualifiedLeads: number; spentUsd: number; plannedUsd: number; cplUsd: number;
    activeCampaigns: number; romi: number | null; rate: number;
  };
  funnel: { stage: string; count: number; conversion: number }[];
  pipeline: { valueByStage: { stage: string; usd: number; count: number }[]; sourceAttribution: { source: string; count: number; usd: number }[]; avgCycleDays: number; wonCount: number; lostCount: number; openCount: number };
  channels: { channel: string; planned: number; spent: number }[];
  trends: { month: string; leads: number; spentUsd: number; wonUsd: number }[];
  contentByStatus: { status: string; count: number }[];
  sentiment: { label: string; count: number }[];
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`kpi-num mt-1 text-2xl ${tone || "text-ink-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </Card>
  );
}

export default function Analytics() {
  const { lang, tr, el } = useI18n();
  const [win, setWin] = useState<"90d" | "12m" | "all">("12m");
  const navigate = useNavigate();
  const { data, loading } = useFetch<Analytics>(`/analytics?window=${win}`);
  const m = (n: number) => fmtMoney(n, "USD", lang);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-7 w-56" />
        <SkeletonCards count={4} />
        <SkeletonCards count={4} />
      </div>
    );
  }

  const s = data.scorecard;
  const planPct = s.plannedUsd > 0 ? Math.round((s.spentUsd / s.plannedUsd) * 100) : 0;
  const SENTI_COLORS: Record<string, string> = { POS: "#5E8B5A", NEU: "#8A909A", NEG: "#C2603E" };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("an_title")}</h1>
          <p className="text-sm text-ink-500">{tr("an_subtitle")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate("/report")} className="no-print rounded-full border border-paper-300 bg-white px-3 py-1 text-xs text-ink-600 hover:bg-paper-100">🖨 {tr("rp_open")}</button>
          {(["90d", "12m", "all"] as const).map((w) => (
            <button key={w} onClick={() => setWin(w)}
              className={`rounded-full border px-3 py-1 text-xs transition ${win === w ? "border-amber-500/50 bg-amber-50 font-medium text-amber-700" : "border-paper-300 bg-white text-ink-500 hover:bg-paper-100"}`}>
              {tr(`w_${w}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Executive scorecard */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={tr("an_pipeline")} value={m(s.pipelineUsd)} sub={`${tr("an_weighted")}: ${m(s.weightedUsd)}`} tone="text-amber-700" />
        <Kpi label={tr("an_won")} value={m(s.wonUsd)} sub={`${data.pipeline.wonCount} ${tr("an_deals")}`} tone="text-moss-600" />
        <Kpi label={tr("an_winRate")} value={`${s.winRate}%`} sub={`${tr("an_avgDeal")}: ${m(s.avgDealUsd)}`} />
        <Kpi label={tr("an_romi")} value={s.romi === null ? "—" : `${s.romi}%`} sub={tr("an_romiHint")} tone={s.romi !== null && s.romi >= 0 ? "text-moss-600" : "text-clay-600"} />
        <Kpi label={tr("an_spendVsPlan")} value={m(s.spentUsd)} sub={`${planPct}% ${tr("an_ofPlan")} (${m(s.plannedUsd)})`} />
        <Kpi label={tr("an_cpl")} value={m(s.cplUsd)} sub={`${s.totalLeads} ${tr("an_leads")}`} />
        <Kpi label={tr("an_qualified")} value={fmtNum(s.qualifiedLeads, lang)} sub={`${tr("an_of")} ${s.totalLeads}`} />
        <Kpi label={tr("an_cycle")} value={`${data.pipeline.avgCycleDays}${lang === "ar" ? " يوم" : "d"}`} sub={`${data.pipeline.openCount} ${tr("an_open")}`} />
      </div>

      {/* Funnel + pipeline by stage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("an_funnel")}</SectionTitle>
          <Funnel data={data.funnel} el={el} />
        </Card>
        <Card>
          <SectionTitle>{tr("an_valueByStage")}</SectionTitle>
          <HBars accent="steel" format={m} data={data.pipeline.valueByStage.map((v) => ({ label: el(v.stage), value: v.usd, sub: `${v.count}` }))} />
        </Card>
      </div>

      {/* Channels + source attribution */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("an_channels")}</SectionTitle>
          <HBars accent="teal" format={m} data={data.channels.map((c) => ({ label: el(c.channel), value: c.spent, sub: `${tr("an_plan")} ${m(c.planned)}` }))} />
        </Card>
        <Card>
          <SectionTitle>{tr("an_sources")}</SectionTitle>
          <HBars accent="violet" format={m} data={data.pipeline.sourceAttribution.map((x) => ({ label: x.source === "OSINT" ? tr("nav_intel") : x.source, value: x.usd, sub: `${x.count}` }))} />
        </Card>
      </div>

      {/* Trends */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("an_leadsTrend")}</SectionTitle>
          <AreaTrend accent="amber" data={data.trends.map((t) => ({ month: t.month, value: t.leads }))} />
        </Card>
        <Card>
          <SectionTitle>{tr("an_spendTrend")}</SectionTitle>
          <AreaTrend accent="steel" format={m} data={data.trends.map((t) => ({ month: t.month, value: t.spentUsd }))} />
        </Card>
      </div>

      {/* Content pipeline + sentiment */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("an_content")}</SectionTitle>
          <HBars accent="amber" data={data.contentByStatus.map((c) => ({ label: el(c.status), value: c.count }))} />
        </Card>
        <Card>
          <SectionTitle>{tr("an_sentiment")}</SectionTitle>
          {data.sentiment.every((x) => x.count === 0)
            ? <p className="text-sm text-ink-500">{tr("noData")}</p>
            : <Donut segments={data.sentiment.map((x) => ({ label: el(x.label), value: x.count, color: SENTI_COLORS[x.label] }))} />}
        </Card>
      </div>

      {data.effectiveness && (data.effectiveness.byProduct.length > 0 || data.effectiveness.postsTop.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {data.effectiveness.byProduct.length > 0 && (
            <Card><SectionTitle>{tr("ef_byProduct")}</SectionTitle>
              <HBars format={(n) => fmtMoney(n, "USD", lang)}
                data={data.effectiveness.byProduct.map((p) => ({ label: lang === "ar" && p.nameAr ? p.nameAr : p.name, value: p.pipelineUsd + p.wonUsd }))} />
            </Card>
          )}
          {data.effectiveness.postsTop.length > 0 && (
            <Card><SectionTitle>{tr("ef_top")}</SectionTitle>
              {data.effectiveness.postsTop.map((p, i) => (
                <div key={i} className="flex items-center justify-between border-b border-paper-100 py-1.5 text-sm last:border-0">
                  <span className="max-w-40 truncate text-ink-700">{p.platform} · {p.title}</span>
                  <span className="kpi-num ms-2 shrink-0 text-amber-700">{p.er}%</span>
                </div>
              ))}
            </Card>
          )}
          {data.effectiveness.erByChannel.length > 0 && (
            <Card><SectionTitle>{tr("ef_byChannel")}</SectionTitle>
              <HBars format={(n) => `${n}%`}
                data={data.effectiveness.erByChannel.map((c) => ({ label: c.label, value: c.er }))} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
