import { useEffect, useState } from "react";
import { Card, SkeletonCards } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

// ═══ THE MORNING PULSE — صباح النبض ══════════════════════════════════
// One calm screen: where the pulse sits, what today asks of you.

interface Briefing {
  date: string; logged: boolean;
  pulse: { value: number | null; delta: number };
  tasksDue: { id: string; title: string; priority: string; assignee?: string | null }[];
  publishDue: { id: string; scheduledAt: string; status: string; title: string }[];
  outreachDue: { id: string; targetName: string; channel: string; campaign: string }[];
  hotLeads: { id: string; company: string; score: number; stage: string }[];
  wonYesterday: { id: string; company: string; valueUsd: number }[];
  alerts: { metricKey: string; condition: string; threshold: number }[];
  counts: { inboxOpen: number; coldMedia: number };
}

function Dial({ value, delta }: { value: number | null; delta: number }) {
  const v = value ?? 0;
  const angle = (v / 100) * 270 - 135;
  const tone = v >= 70 ? "text-moss-600" : v >= 45 ? "text-amber-600" : "text-clay-600";
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-[135deg]">
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="7"
          className="text-paper-200" strokeDasharray="198 264" strokeLinecap="round" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="7"
          className={`${tone} transition-all duration-slow`} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * 198} 264`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`kpi-num text-4xl font-bold ${tone}`} dir="ltr">{value ?? "—"}</span>
        {value !== null && (
          <span className={`kpi-num text-xs ${delta > 0 ? "text-moss-600" : delta < 0 ? "text-clay-600" : "text-ink-400"}`} dir="ltr">
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)}
          </span>
        )}
      </div>
      {/* the needle notch */}
      <div className="absolute left-1/2 top-1/2 h-[3px] w-4 origin-left rounded-full bg-ink-900/70"
        style={{ transform: `rotate(${angle}deg) translateX(46px)` }} />
    </div>
  );
}

const PRIO_TONE: Record<string, string> = { HIGH: "bg-clay-100 text-clay-700", MEDIUM: "bg-amber-500/15 text-amber-700", LOW: "bg-paper-200 text-ink-500" };

export default function Morning() {
  const { tr, lang } = useI18n();
  const { user } = useAuth();
  const [b, setB] = useState<Briefing | null>(null);
  useEffect(() => { api.get<Briefing>("/digest/morning").then(setB).catch(() => {}); }, []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? tr("mo_morning") : hour < 17 ? tr("mo_day") : tr("mo_evening");
  const dstr = new Date().toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "long", day: "numeric", month: "long" });

  if (!b) return <SkeletonCards count={3} />;

  const List = ({ title, to, items, render, emptyKey }: { title: string; to: string; items: unknown[]; render: (x: never) => React.ReactNode; emptyKey: string }) => (
    <Card className="p-4">
      <Link to={to} className="text-xs font-bold uppercase tracking-wide text-ink-500 hover:text-amber-700">{title}</Link>
      {!items.length ? <p className="mt-2 text-sm text-ink-400">{tr(emptyKey)}</p> : (
        <ul className="mt-2 space-y-1.5">{items.map((x, i) => <li key={i}>{render(x as never)}</li>)}</ul>
      )}
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ── the header: greeting + the pulse ── */}
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-amber-500 via-amber-500/40 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">{greet}{user?.name ? `، ${user.name.split(" ")[0]}` : ""} ☀️</h1>
            <p className="mt-1 text-sm text-ink-500">{dstr} · {tr("mo_sub")}</p>
            {b.wonYesterday.length > 0 && (
              <div className="mt-3 rounded-xl bg-moss-100 px-3 py-2 text-sm text-moss-700">
                🎉 {tr("mo_won")}: {b.wonYesterday.map((w) => w.company).join("، ")}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {b.counts.inboxOpen > 0 && <Link to="/inbox" className="rounded-full bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">💬 {b.counts.inboxOpen} {tr("mo_inbox")}</Link>}
              {b.counts.coldMedia > 0 && <Link to="/reach" className="rounded-full bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">🧊 {b.counts.coldMedia} {tr("mo_cold")}</Link>}
              {b.alerts.map((a, i) => (
                <Link key={i} to="/analytics" className="rounded-full bg-clay-100 px-2.5 py-1 text-clay-700 hover:bg-clay-100/70" dir="ltr">⚠ {a.metricKey}</Link>
              ))}
            </div>
          </div>
          <div className="text-center">
            <Dial value={b.pulse.value} delta={b.pulse.delta} />
            <div className="mt-1 text-xs font-semibold text-ink-500">{tr("mo_index")}</div>
          </div>
        </div>
      </Card>

      {/* ── today's four lanes ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <List title={tr("mo_tasks")} to="/tasks" items={b.tasksDue} emptyKey="mo_clearT"
          render={(t: Briefing["tasksDue"][0]) => (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-800">{t.title}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${PRIO_TONE[t.priority] || PRIO_TONE.LOW}`}>{t.priority}</span>
            </div>
          )} />
        <List title={tr("mo_publish")} to="/publish" items={b.publishDue} emptyKey="mo_clearP"
          render={(p: Briefing["publishDue"][0]) => (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-800">{p.title}</span>
              <span className="kpi-num shrink-0 text-[11px] text-ink-500" dir="ltr">{new Date(p.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )} />
        <List title={tr("mo_outreach")} to="/reach" items={b.outreachDue} emptyKey="mo_clearO"
          render={(o: Briefing["outreachDue"][0]) => (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-800">{o.targetName}</span>
              <span className="shrink-0 text-[11px] text-ink-500">{o.campaign}</span>
            </div>
          )} />
        <List title={tr("mo_hot")} to="/leads" items={b.hotLeads} emptyKey="mo_clearH"
          render={(l: Briefing["hotLeads"][0]) => (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-800">{l.company}</span>
              <span className="kpi-num shrink-0 rounded-full bg-clay-100 px-2 py-0.5 text-[10px] font-bold text-clay-700" dir="ltr">🔥 {l.score}</span>
            </div>
          )} />
      </div>

      <p className="text-center text-[11px] text-ink-400">
        {b.logged ? tr("mo_fromNight") : tr("mo_live")} · {tr("mo_ritual")}
        <br />{tr("mo_emailHint")}
      </p>
    </div>
  );
}
