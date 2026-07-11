import { api } from "../lib/api";
import { useFetch, Card, SectionTitle, SkeletonCards } from "../components/ui";
import { HBars, AreaTrend, Spark } from "../components/charts";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { fmtNum } from "../lib/format";
import { ReactNode } from "react";

interface Listening {
  summary: { mentions8w: number; sovPct: number | null; negSharePct: number; brandSentiment: number };
  shareOfVoice: { id: string; label: string; category: string; mentions: number; pos: number; neg: number; avgSentiment: number }[];
  volumeByWeek: { week: string; mentions: number; neg: number }[];
  topSources: { source: string; count: number }[];
  accounts: { id: string; platform: string; handle: string; displayName?: string; followers: number; followersDelta: number; engagementRate: number; series: { date: string; followers: number }[] }[];
  alerts: { type: string; severity: string; platform?: string; handle?: string; value: number; baseline?: number }[];
}

const SEV_TONE: Record<string, string> = {
  high: "bg-clay-500/15 text-clay-600",
  warn: "bg-amber-500/15 text-amber-700",
  info: "bg-steel-500/12 text-steel-600",
};
const PLATFORM_GLYPH: Record<string, string> = {
  FACEBOOK: "f", INSTAGRAM: "◎", X: "𝕏", LINKEDIN: "in", YOUTUBE: "▶", TIKTOK: "♪",
};

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`kpi-num mt-1 text-2xl ${tone || "text-ink-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </Card>
  );
}

export default function Listening() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Listening>("/listening");

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-7 w-64" />
        <SkeletonCards count={4} />
        <SkeletonCards count={2} />
      </div>
    );
  }

  const s = data.summary;
  const alertLabel = (a: Listening["alerts"][0]) => {
    const who = a.handle ? ` — ${a.platform} @${a.handle}` : "";
    switch (a.type) {
      case "MENTION_SPIKE": return `${tr("li_alert_spike")}: ${a.value} ${tr("li_vsBaseline")} ~${a.baseline}${who}`;
      case "NEGATIVE_SHIFT": return `${tr("li_alert_neg")}: ${a.value}%${who}`;
      case "FOLLOWER_DROP": return `${tr("li_alert_drop")}: ${a.value}${who}`;
      default: return `${tr("li_alert_lowEng")}: ${a.value}%${who}`;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">{tr("li_title")}</h1>
        <p className="text-sm text-ink-500">{tr("li_subtitle")}</p>
      </div>

      {/* Pulse scorecard */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={tr("li_mentions8w")} value={fmtNum(s.mentions8w, lang)} />
        <Kpi label={tr("li_sov")} value={s.sovPct === null ? "—" : `${s.sovPct}%`} sub={s.sovPct === null ? tr("li_noTopics") : undefined} tone="text-amber-700" />
        <Kpi label={tr("li_negShare")} value={`${s.negSharePct}%`} tone={s.negSharePct > 30 ? "text-clay-600" : "text-ink-900"} />
        <Kpi label={tr("li_brandSent")} value={s.brandSentiment > 0 ? `+${s.brandSentiment}` : s.brandSentiment} tone={s.brandSentiment >= 0 ? "text-moss-600" : "text-clay-600"} />
      </div>

      {/* Alerts */}
      <Card>
        <SectionTitle>{tr("li_alerts")}</SectionTitle>
        {data.alerts.length === 0 ? (
          <p className="text-sm text-moss-600">✓ {tr("li_noAlerts")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.alerts.map((a, i) => (
              <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${SEV_TONE[a.severity] || SEV_TONE.info}`}>
                {alertLabel(a)}
                {can("tasks") && (
                  <button title={tr("al_task")} className="rounded-full bg-white/60 px-1.5 font-bold hover:bg-white"
                    onClick={() => api.post("/tasks", { title: alertLabel(a), status: "TODO", priority: "HIGH" })
                      .then(() => toast.push(tr("al_taskMade"), "success")).catch(() => toast.push(tr("saveError"), "error"))}>＋</button>
                )}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* SOV + volume */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("li_sovTitle")}</SectionTitle>
          {data.shareOfVoice.length === 0 ? (
            <p className="text-sm text-ink-500">{tr("li_noTopics")}</p>
          ) : (
            <HBars
              format={(n) => `${n}`}
              data={data.shareOfVoice.map((x) => ({
                label: x.label,
                value: x.mentions,
                sub: `+${x.pos} / −${x.neg}`,
              }))}
              colorFor={(i) => (data.shareOfVoice[i].category === "BRAND" ? "#E8A33D" : "#3F7191")}
            />
          )}
        </Card>
        <Card>
          <SectionTitle>{tr("li_volume")}</SectionTitle>
          <AreaTrend accent="violet" data={data.volumeByWeek.map((w) => ({ month: w.week.slice(0, 7), value: w.mentions }))} />
          <div className="mt-1 text-end text-xs text-clay-600">
            {tr("li_negLine")}: {data.volumeByWeek.reduce((a, w) => a + w.neg, 0)}
          </div>
        </Card>
      </div>

      {/* Sources + accounts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{tr("li_sources")}</SectionTitle>
          <HBars accent="teal" data={data.topSources.map((x) => ({ label: x.source, value: x.count }))} />
        </Card>
        <Card>
          <SectionTitle>{tr("li_accounts")}</SectionTitle>
          {data.accounts.length === 0 ? (
            <p className="text-sm text-ink-500">{tr("li_noAccounts")}</p>
          ) : (
            <div className="space-y-3">
              {data.accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-paper-200 bg-white p-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 font-mono text-sm text-amber-500">
                    {PLATFORM_GLYPH[a.platform] || "●"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-800">@{a.handle}</div>
                    <div className="text-xs text-ink-500">
                      {fmtNum(a.followers, lang)} {tr("li_followers")}
                      <span className={`ms-1 ${a.followersDelta > 0 ? "text-moss-600" : a.followersDelta < 0 ? "text-clay-600" : "text-ink-400"}`}>
                        {a.followersDelta > 0 ? `▲${a.followersDelta}` : a.followersDelta < 0 ? `▼${Math.abs(a.followersDelta)}` : "—"}
                      </span>
                      <span className="ms-2">{tr("li_engRate")}: <span className="kpi-num">{a.engagementRate}%</span></span>
                    </div>
                  </div>
                  <Spark data={a.series.map((p) => p.followers)} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
