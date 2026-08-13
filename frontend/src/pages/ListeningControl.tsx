import { useState } from "react";
import { Card, Empty, Field, SectionTitle, Select, StatusPill, useFetch } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

type Tab = "control" | "queue" | "watches" | "sources" | "rules" | "changes";
interface Cockpit {
  settings: { paused: boolean; bandLow: number; bandHigh: number; slaHours: number };
  queue: { pending: number; assigned: number; unassigned: number; oldestHours: number; slaHours: number; breaching: boolean };
  sources: { total: number; blocked: number; muted: number };
  watches: { total: number; paused: number };
  budgets: { provider?: string; pctOfCap?: number; exhausted?: boolean; warn?: boolean }[];
  recentChanges: Change[];
  guardrail: { entityKinds: string[]; note: string };
}
interface Replay { windowDays: number; scanned: number; wouldAccept: number; wouldQueue: number; wouldReject: number; reviewLoadChange: number; examples: { id: string; title: string; relevance: number; was: string; would: string }[] }
interface QueueItem { id: string; title: string; source: string; topicLabel?: string; assignedToName?: string; aiRelevance?: number; aiVerdict?: string; reliability?: string; muted?: boolean; createdAt: string }
interface QueueData { health: Cockpit["queue"]; items: QueueItem[] }
interface Watch { id: string; label: string; campaignId?: string; campaignName?: string; assigneeId?: string; assigneeName?: string; paused: boolean; signals: number; pending: number }
interface Source { id: string; domain: string; kind?: string; reliability?: string; active: boolean; muted: boolean; signals: number; gradedByName?: string; gradeNote?: string }
interface Rule { id: string; name: string; kind: string; topicId?: string; topicLabel?: string; threshold: number; windowHours: number; severity: string; corroboratedOnly: boolean; active: boolean; lastFiredAt?: string }
interface Change { id: string; kind: string; field?: string; fromValue?: string; toValue?: string; changedAt: string; note?: string; changedByName?: string; topicLabel?: string; sourceDomain?: string }
interface User { id: string; name: string }
interface Campaign { id: string; name: string }

export default function ListeningControl() {
  const { lang } = useI18n();
  const [tab, setTab] = useState<Tab>("control");
  const tabs: { id: Tab; ar: string; en: string }[] = [
    { id: "control", ar: "التحكم", en: "Control" }, { id: "queue", ar: "طابور المراجعة", en: "Review queue" },
    { id: "watches", ar: "المراقبات", en: "Watches" }, { id: "sources", ar: "المصادر", en: "Sources" },
    { id: "rules", ar: "قواعد التنبيه", en: "Alert rules" }, { id: "changes", ar: "سجل التغييرات", en: "Change log" },
  ];
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold text-ink-900">{lang === "ar" ? "غرفة تحكم الرصد" : "Listening Control Room"}</h1><p className="text-sm text-ink-500">{lang === "ar" ? "اضبط خط الرصد مع معاينة الأثر قبل التغيير" : "Tune the listening pipeline with replay evidence before changes are applied"}</p></div>
    <div className="flex flex-wrap gap-2">{tabs.map((x) => <button key={x.id} onClick={() => setTab(x.id)} className={tab === x.id ? "btn-amber" : "btn-ghost"}>{lang === "ar" ? x.ar : x.en}</button>)}</div>
    {tab === "control" && <Control />}{tab === "queue" && <ReviewQueue />}{tab === "watches" && <Watches />}{tab === "sources" && <Sources />}{tab === "rules" && <Rules />}{tab === "changes" && <Changes />}
  </div>;
}

function Control() {
  const { lang, tr } = useI18n(); const { can } = useAuth(); const toast = useToast();
  const cockpit = useFetch<Cockpit>("/listening/control");
  const [draft, setDraft] = useState<{ bandLow: string; bandHigh: string; slaHours: string; paused: boolean } | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const cfg = draft || (cockpit.data ? { bandLow: String(cockpit.data.settings.bandLow), bandHigh: String(cockpit.data.settings.bandHigh), slaHours: String(cockpit.data.settings.slaHours), paused: cockpit.data.settings.paused } : null);
  const preview = async () => { if (!cfg) return; try { setReplay(await api.post<Replay>("/listening/control/replay", { bandLow: Number(cfg.bandLow), bandHigh: Number(cfg.bandHigh), days: 7 })); } catch (e) { toast.push((e as Error).message, "error"); } };
  const saveBand = async () => { if (!cfg) return; try { const out = await api.patch<{ replay: Replay }>("/listening/control/band", { bandLow: Number(cfg.bandLow), bandHigh: Number(cfg.bandHigh) }); setReplay(out.replay); cockpit.reload(); toast.push(tr("saved"), "success"); } catch (e) { toast.push((e as Error).message, "error"); } };
  const saveSettings = async () => { if (!cfg) return; try { await api.patch("/listening/control/settings", { slaHours: Number(cfg.slaHours), paused: cfg.paused }); cockpit.reload(); toast.push(tr("saved"), "success"); } catch (e) { toast.push((e as Error).message, "error"); } };
  if (!cockpit.data || !cfg) return <div className="py-12 text-center text-ink-500">{tr("loading")}</div>;
  const c = cockpit.data;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label={lang === "ar" ? "بانتظار المراجعة" : "Pending review"} value={String(c.queue.pending)} warn={c.queue.breaching} /><Metric label={lang === "ar" ? "مصادر محجوبة" : "Blocked sources"} value={`${c.sources.blocked}/${c.sources.total}`} /><Metric label={lang === "ar" ? "مراقبات متوقفة" : "Paused watches"} value={`${c.watches.paused}/${c.watches.total}`} /><Metric label={lang === "ar" ? "أقدم عنصر" : "Oldest item"} value={`${c.queue.oldestHours}h`} warn={c.queue.breaching} /></div>
    <Card><SectionTitle>{lang === "ar" ? "حدود بوابة المراجعة" : "Review gate band"}</SectionTitle><div className="grid gap-3 sm:grid-cols-4"><Field label="Low"><input className="input" type="number" min="0" max="1" step="0.01" value={cfg.bandLow} onChange={(e) => setDraft({ ...cfg, bandLow: e.target.value })} /></Field><Field label="High"><input className="input" type="number" min="0" max="1" step="0.01" value={cfg.bandHigh} onChange={(e) => setDraft({ ...cfg, bandHigh: e.target.value })} /></Field><button onClick={preview} className="btn-ghost self-end">{lang === "ar" ? "معاينة 7 أيام" : "Replay 7 days"}</button>{can("intel") && <button onClick={saveBand} className="btn-amber self-end">{tr("save")}</button>}</div>
      {replay && <div className="mt-4 grid gap-2 sm:grid-cols-5">{[["scanned", replay.scanned], ["accept", replay.wouldAccept], ["queue", replay.wouldQueue], ["reject", replay.wouldReject], ["load change", replay.reviewLoadChange]].map(([k, v]) => <div key={String(k)} className="rounded-lg bg-paper-100 p-2 text-center"><div className="kpi-num text-lg">{v}</div><div className="text-[10px] text-ink-500">{k}</div></div>)}</div>}
      {!!replay?.examples.length && <div className="mt-3 space-y-1">{replay.examples.map((x) => <div key={x.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-ink-600">{x.title}</span><span dir="ltr" className="shrink-0 text-ink-400">{x.was} → {x.would} ({x.relevance})</span></div>)}</div>}
    </Card>
    <Card><SectionTitle>{lang === "ar" ? "تشغيل الخط والمهلة" : "Pipeline and review SLA"}</SectionTitle><div className="flex flex-wrap items-end gap-3"><Field label={lang === "ar" ? "المهلة بالساعات" : "SLA hours"}><input className="input w-32" type="number" min="1" max="720" value={cfg.slaHours} onChange={(e) => setDraft({ ...cfg, slaHours: e.target.value })} /></Field><label className="mb-2 flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={cfg.paused} onChange={(e) => setDraft({ ...cfg, paused: e.target.checked })} />{lang === "ar" ? "إيقاف الرصد" : "Pause listening"}</label>{can("intel") && <button onClick={saveSettings} className="btn-amber">{tr("save")}</button>}</div></Card>
    <Card><SectionTitle>{lang === "ar" ? "الحد الأخلاقي الثابت" : "Fixed ethical guardrail"}</SectionTitle><p className="text-sm text-ink-600">{c.guardrail.note}</p><div className="mt-2 flex flex-wrap gap-1">{c.guardrail.entityKinds.map((x) => <span key={x} className="pill bg-steel-500/12 text-steel-600">{x}</span>)}</div></Card>
  </div>;
}

function ReviewQueue() {
  const { lang, tr } = useI18n(); const { can } = useAuth(); const toast = useToast(); const queue = useFetch<QueueData>("/listening/control/queue"); const users = useFetch<User[]>("/users");
  const [selected, setSelected] = useState<string[]>([]); const [assigneeId, setAssigneeId] = useState("");
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const assign = async () => { try { await api.post("/listening/control/queue/assign", { ids: selected, assigneeId: assigneeId || undefined }); setSelected([]); queue.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  const rule = async (verdict: "CONFIRMED" | "REJECTED") => { try { await api.post("/listening/control/queue/rule", { ids: selected, verdict }); setSelected([]); queue.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  return <Card><SectionTitle action={can("intel") && selected.length > 0 ? <div className="flex flex-wrap gap-2"><Select value={assigneeId} onChange={setAssigneeId} placeholder={tr("owner")} options={(users.data || []).map((u) => ({ value: u.id, label: u.name }))} /><button onClick={assign} className="btn-ghost text-xs">{lang === "ar" ? "إسناد" : "Assign"}</button><button onClick={() => rule("CONFIRMED")} className="btn-ghost text-xs text-moss-700">{lang === "ar" ? "تأكيد" : "Confirm"}</button><button onClick={() => rule("REJECTED")} className="btn-ghost text-xs text-clay-600">{lang === "ar" ? "رفض" : "Reject"}</button></div> : undefined}>{lang === "ar" ? "طابور المراجعة" : "Review queue"}</SectionTitle>
    {!queue.data?.items.length ? <Empty text={tr("noData")} /> : <div className="space-y-2">{queue.data.items.map((x) => <label key={x.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-paper-200 p-3 hover:bg-paper-100"><input type="checkbox" checked={selected.includes(x.id)} onChange={() => toggle(x.id)} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink-800">{x.title}</div><div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-500"><span>{x.topicLabel || "—"}</span><span dir="ltr">{x.source}</span><span>{x.assignedToName || tr("unassigned")}</span><span dir="ltr">AI {x.aiRelevance ?? "—"} · {x.aiVerdict || "—"}</span></div></div><span className="text-[10px] text-ink-400">{fmtDate(x.createdAt, lang)}</span></label>)}</div>}
  </Card>;
}

function Watches() {
  const { lang, tr } = useI18n(); const { can } = useAuth(); const toast = useToast(); const rows = useFetch<Watch[]>("/listening/control/watches"); const campaigns = useFetch<Campaign[]>("/campaigns/picker"); const users = useFetch<User[]>("/users");
  const patch = async (id: string, body: Record<string, unknown>) => { try { await api.patch(`/listening/control/watches/${id}`, body); rows.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  return <div className="grid gap-3 md:grid-cols-2">{(rows.data || []).map((w) => <Card key={w.id}><div className="flex items-start justify-between"><div><h3 className="font-semibold text-ink-800">{w.label}</h3><p className="text-xs text-ink-500">{w.signals} signals · {w.pending} pending</p></div><StatusPill value={w.paused ? "PAUSED" : "ACTIVE"} /></div>{can("intel") && <div className="mt-3 grid gap-2 sm:grid-cols-2"><Select value={w.campaignId || ""} onChange={(campaignId) => patch(w.id, { campaignId })} placeholder={tr("campaign")} options={(campaigns.data || []).map((c) => ({ value: c.id, label: c.name }))} /><Select value={w.assigneeId || ""} onChange={(assigneeId) => patch(w.id, { assigneeId })} placeholder={tr("owner")} options={(users.data || []).map((u) => ({ value: u.id, label: u.name }))} /><button onClick={() => patch(w.id, { paused: !w.paused })} className="btn-ghost text-xs sm:col-span-2">{w.paused ? (lang === "ar" ? "استئناف" : "Resume") : (lang === "ar" ? "إيقاف" : "Pause")}</button></div>}</Card>)}</div>;
}

function Sources() {
  const { lang, tr } = useI18n(); const { can, isAdmin } = useAuth(); const toast = useToast(); const rows = useFetch<Source[]>("/listening/control/sources");
  const lever = async (s: Source, body: Record<string, unknown>) => { try { await api.patch(`/listening/control/sources/${s.id}/lever`, body); rows.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  const grade = async (s: Source) => { const reliability = window.prompt("Admiralty grade A-F", s.reliability || "C"); if (!reliability) return; const note = window.prompt("Reason for regrade"); if (!note) return; try { await api.patch(`/listening/control/sources/${s.id}/grade`, { reliability, note }); rows.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  return <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b text-xs text-ink-500"><th className="p-3 text-start">{lang === "ar" ? "المصدر" : "Source"}</th><th className="p-3 text-start">{lang === "ar" ? "الدرجة" : "Grade"}</th><th className="p-3 text-start">Signals</th><th className="p-3 text-start">{tr("status")}</th><th /></tr></thead><tbody>{(rows.data || []).map((s) => <tr key={s.id} className="border-b border-paper-100"><td className="p-3"><div className="font-mono text-xs" dir="ltr">{s.domain}</div><div className="text-[10px] text-ink-400">{s.kind}</div></td><td className="p-3"><span className="kpi-num">{s.reliability || "—"}</span>{isAdmin && <button onClick={() => grade(s)} className="ms-2 text-xs text-steel-600">{tr("edit")}</button>}</td><td className="p-3 kpi-num">{s.signals}</td><td className="p-3"><div className="flex gap-1"><StatusPill value={s.active ? "ACTIVE" : "PAUSED"} />{s.muted && <span className="pill bg-paper-200 text-ink-500">MUTED</span>}</div></td><td className="p-3 text-end">{can("intel") && <><button onClick={() => lever(s, { blocked: s.active })} className="text-xs text-clay-600">{s.active ? (lang === "ar" ? "حجب" : "Block") : (lang === "ar" ? "فتح" : "Unblock")}</button><button onClick={() => lever(s, { muted: !s.muted })} className="ms-3 text-xs text-steel-600">{s.muted ? (lang === "ar" ? "إلغاء الكتم" : "Unmute") : (lang === "ar" ? "كتم" : "Mute")}</button></>}</td></tr>)}</tbody></table></Card>;
}

function Rules() {
  const { lang, tr } = useI18n(); const { can } = useAuth(); const toast = useToast(); const rows = useFetch<Rule[]>("/listening/control/rules"); const watches = useFetch<Watch[]>("/listening/control/watches");
  const [form, setForm] = useState({ name: "", kind: "VOLUME_SPIKE", topicId: "", threshold: "2", windowHours: "24", severity: "MEDIUM", corroboratedOnly: false });
  const create = async () => { try { await api.post("/listening/control/rules", { ...form, threshold: Number(form.threshold), windowHours: Number(form.windowHours) }); setForm({ name: "", kind: "VOLUME_SPIKE", topicId: "", threshold: "2", windowHours: "24", severity: "MEDIUM", corroboratedOnly: false }); rows.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  const patch = async (r: Rule, body: Record<string, unknown>) => { try { await api.patch(`/listening/control/rules/${r.id}`, body); rows.reload(); } catch (e) { toast.push((e as Error).message, "error"); } };
  const evaluate = async () => { try { const out = await api.post<{ evaluated: number; fired: number }>("/listening/control/rules/evaluate", {}); toast.push(`${out.evaluated} evaluated · ${out.fired} fired`, "success"); } catch (e) { toast.push((e as Error).message, "error"); } };
  return <div className="space-y-4">{can("intel") && <Card><SectionTitle action={<button onClick={evaluate} className="btn-ghost text-xs">{lang === "ar" ? "تشغيل تجريبي" : "Evaluate now"}</button>}>{lang === "ar" ? "قاعدة جديدة" : "New alert rule"}</SectionTitle><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"><input className="input" placeholder={tr("name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><Select value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={["VOLUME_SPIKE", "NEGATIVE_BURST", "EMERGING_TOPIC", "GRADE_A_MENTION"].map((x) => ({ value: x, label: x }))} /><Select value={form.topicId} onChange={(topicId) => setForm({ ...form, topicId })} placeholder={lang === "ar" ? "المراقبة" : "Watch"} options={(watches.data || []).map((w) => ({ value: w.id, label: w.label }))} /><input className="input" type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} placeholder="Threshold" /><input className="input" type="number" value={form.windowHours} onChange={(e) => setForm({ ...form, windowHours: e.target.value })} placeholder="Hours" /><button onClick={create} disabled={!form.name || !form.topicId} className="btn-amber">{tr("save")}</button></div></Card>}
    <div className="grid gap-3 md:grid-cols-2">{(rows.data || []).map((r) => <Card key={r.id}><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-ink-800">{r.name}</h3><p className="text-xs text-ink-500">{r.kind} · {r.topicLabel || "—"} · {r.threshold}/{r.windowHours}h</p></div><StatusPill value={r.active ? "ACTIVE" : "PAUSED"} /></div>{can("intel") && <div className="mt-3 flex gap-3"><button onClick={() => patch(r, { active: !r.active })} className="text-xs text-steel-600">{r.active ? (lang === "ar" ? "إيقاف" : "Disable") : (lang === "ar" ? "تفعيل" : "Enable")}</button><button onClick={async () => { await api.del(`/listening/control/rules/${r.id}`); rows.reload(); }} className="text-xs text-clay-600">{tr("delete")}</button></div>}</Card>)}</div>
  </div>;
}

function Changes() {
  const { lang, tr } = useI18n(); const rows = useFetch<Change[]>("/listening/control/changes?days=90");
  return <Card><SectionTitle>{lang === "ar" ? "آخر 90 يومًا" : "Last 90 days"}</SectionTitle>{!rows.data?.length ? <Empty text={tr("noData")} /> : <div className="space-y-2">{rows.data.map((c) => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 p-3"><div><b className="text-sm text-ink-700">{c.kind}</b><div className="text-xs text-ink-500">{c.topicLabel || c.sourceDomain || c.field || "—"} · {c.fromValue || "—"} → {c.toValue || "—"}</div>{c.note && <p className="text-xs text-ink-400">{c.note}</p>}</div><span className="text-[10px] text-ink-400">{c.changedByName || "system"} · {fmtDate(c.changedAt, lang)}</span></div>)}</div>}</Card>;
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) { return <Card className={warn ? "border-clay-500/40" : ""}><div className="text-xs text-ink-500">{label}</div><div className={`kpi-num mt-1 text-2xl ${warn ? "text-clay-600" : "text-ink-900"}`}>{value}</div></Card>; }
