import { useFetch, Card, SectionTitle, StatusPill, Empty, SkeletonCards } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { fmtMoney, fmtNum, fmtDate, daysUntil } from "../lib/format";

interface Dash {
  kpis: { activeCampaigns: number; totalCampaigns: number; openTasks: number; upcomingEventCount: number };
  budget: {
    spentUsd: number; spentSdg: number; plannedUsd: number; plannedSdg: number;
    byChannel: { channel: string; usd: number; sdg: number }[];
  };
  pipeline: {
    byStage: { stage: string; count: number; usd: number; sdg: number }[];
    wonUsd: number; wonSdg: number; openUsd: number; openSdg: number;
  };
  upcomingEvents: { id: string; name: string; nameAr?: string; city?: string; startDate?: string; status: string; ownerName?: string }[];
  contentDue: { id: string; title: string; titleAr?: string; status: string; scheduledAt?: string; campaignName?: string }[];
  setting: { usdToSdgRate: number };
}

const STAGE_ORDER = ["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-y-0 start-0 w-1 ${accent || "bg-amber-500"}`} />
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-2 kpi-num text-3xl text-ink-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const { lang, tr, el } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useFetch<Dash>("/dashboard");

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2"><div className="skeleton h-7 w-64" /><div className="skeleton h-4 w-48" /></div>
        <SkeletonCards count={4} />
        <SkeletonCards count={3} />
      </div>
    );
  }

  const spentPct = data.budget.plannedUsd > 0
    ? Math.min(100, Math.round((data.budget.spentUsd / data.budget.plannedUsd) * 100))
    : 0;
  const maxChannel = Math.max(1, ...data.budget.byChannel.map((c) => c.usd));
  const maxStage = Math.max(1, ...data.pipeline.byStage.map((s) => s.count));
  const stages = STAGE_ORDER
    .map((st) => data.pipeline.byStage.find((s) => s.stage === st) || { stage: st, count: 0, usd: 0, sdg: 0 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">
          {tr("dash_welcome")}، {user?.name}
        </h1>
        <p className="text-sm text-ink-500">
          {lang === "ar"
            ? `سعر الصرف الحالي: 1 دولار = ${fmtNum(data.setting.usdToSdgRate, lang)} ج.س`
            : `Current rate: 1 USD = ${fmtNum(data.setting.usdToSdgRate, lang)} SDG`}
        </p>
      </div>

      {/* Today's briefing — actionable, per the intelligence loop */}
      {(() => {
        const items = [
          { n: data.contentDue.length, label: tr("brief_dueContent"), to: "/calendar", tone: "amber" },
          { n: data.kpis.openTasks, label: tr("brief_openTasks"), to: "/tasks", tone: "steel" },
          { n: data.kpis.upcomingEventCount, label: tr("brief_upcomingEvents"), to: "/events", tone: "moss" },
        ].filter((i) => i.n > 0);
        const dot: Record<string, string> = { amber: "bg-amber-500", steel: "bg-steel-500", moss: "bg-moss-500" };
        return (
          <Card className="border-s-4 border-s-amber-500">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-h3 font-semibold text-ink-900">{tr("brief_title")}</span>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-ink-500">{tr("brief_allClear")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {items.map((i) => (
                  <button key={i.label} onClick={() => navigate(i.to)}
                    className="inline-flex items-center gap-2 rounded-lg border border-paper-200 bg-paper-100 px-3 py-2 text-sm text-ink-700 transition hover:border-amber-500/40 hover:bg-amber-50/40">
                    <span className={`grid h-6 min-w-6 place-items-center rounded-md px-1.5 text-xs font-bold text-white ${dot[i.tone]}`}>{fmtNum(i.n, lang)}</span>
                    <span>{i.label}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })()}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={tr("dash_activeCampaigns")} value={fmtNum(data.kpis.activeCampaigns, lang)}
          sub={`${fmtNum(data.kpis.totalCampaigns, lang)} ${lang === "ar" ? "إجمالاً" : "total"}`} accent="bg-moss-500" />
        <Kpi label={tr("dash_pipelineOpen")} value={fmtMoney(data.pipeline.openUsd, "USD", lang)}
          sub={fmtMoney(data.pipeline.openSdg, "SDG", lang)} accent="bg-steel-500" />
        <Kpi label={tr("dash_openTasks")} value={fmtNum(data.kpis.openTasks, lang)} accent="bg-amber-500" />
        <Kpi label={tr("dash_upcomingEvents")} value={fmtNum(data.kpis.upcomingEventCount, lang)} accent="bg-clay-500" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Spend vs plan */}
        <Card className="lg:col-span-1">
          <SectionTitle>{tr("dash_spend")}</SectionTitle>
          <div className="flex items-end justify-between">
            <div>
              <div className="kpi-num text-2xl text-ink-900">{fmtMoney(data.budget.spentUsd, "USD", lang)}</div>
              <div className="text-xs text-ink-500">{tr("dash_spentLabel")}</div>
            </div>
            <div className="text-end">
              <div className="kpi-num text-lg text-ink-600">{fmtMoney(data.budget.plannedUsd, "USD", lang)}</div>
              <div className="text-xs text-ink-500">{tr("dash_plannedLabel")}</div>
            </div>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-paper-200">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${spentPct}%` }} />
          </div>
          <div className="mt-1 text-xs text-ink-500">{spentPct}% {lang === "ar" ? "من المخطط" : "of plan"}</div>

          <div className="mt-4 border-t border-paper-200 pt-3 text-xs text-ink-500">
            {tr("dash_spentLabel")}: <span className="font-mono tnum text-ink-700">{fmtMoney(data.budget.spentSdg, "SDG", lang)}</span>
          </div>
        </Card>

        {/* Spend by channel */}
        <Card className="lg:col-span-2">
          <SectionTitle>{tr("dash_byChannel")}</SectionTitle>
          {data.budget.byChannel.length === 0 ? (
            <Empty text={tr("noData")} />
          ) : (
            <div className="space-y-2.5">
              {data.budget.byChannel.map((c) => (
                <div key={c.channel} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-ink-600">{el(c.channel)}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-paper-200">
                    <div className="flex h-full items-center justify-end rounded bg-ink-800 px-2 transition-all"
                      style={{ width: `${Math.max(8, (c.usd / maxChannel) * 100)}%` }}>
                      <span className="kpi-num text-[11px] text-paper">{fmtMoney(c.usd, "USD", lang)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Pipeline */}
      <Card>
        <SectionTitle action={<span className="text-xs text-ink-500">{tr("dash_won")}: <span className="font-mono tnum text-moss-600">{fmtMoney(data.pipeline.wonUsd, "USD", lang)}</span></span>}>
          {tr("dash_pipeline")}
        </SectionTitle>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-paper-200 bg-paper-100 p-3 text-center">
              <div className="kpi-num text-2xl text-ink-900">{fmtNum(s.count, lang)}</div>
              <div className="mt-1 mb-2"><StatusPill value={s.stage} /></div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-paper-300">
                <div className="h-full bg-amber-500" style={{ width: `${(s.count / maxStage) * 100}%` }} />
              </div>
              <div className="mt-2 text-[11px] text-ink-500">{fmtMoney(s.usd, "USD", lang)}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Lists */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("dash_eventsNext")}</SectionTitle>
          {data.upcomingEvents.length === 0 ? <Empty text={tr("noData")} /> : (
            <ul className="divide-y divide-paper-200">
              {data.upcomingEvents.map((e) => {
                const d = daysUntil(e.startDate);
                return (
                  <li key={e.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-800">{lang === "ar" && e.nameAr ? e.nameAr : e.name}</div>
                      <div className="text-xs text-ink-500">{e.city} · {fmtDate(e.startDate, lang)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {d !== null && d >= 0 && (
                        <span className="kpi-num rounded-md bg-paper-200 px-2 py-0.5 text-xs text-ink-600">
                          {lang === "ar" ? `بعد ${d} يوم` : `${d}d`}
                        </span>
                      )}
                      <StatusPill value={e.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>{tr("dash_contentDue")}</SectionTitle>
          {data.contentDue.length === 0 ? <Empty text={tr("noData")} /> : (
            <ul className="divide-y divide-paper-200">
              {data.contentDue.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-800">{lang === "ar" && c.titleAr ? c.titleAr : c.title}</div>
                    <div className="text-xs text-ink-500">{c.campaignName || "—"} · {fmtDate(c.scheduledAt, lang)}</div>
                  </div>
                  <StatusPill value={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
