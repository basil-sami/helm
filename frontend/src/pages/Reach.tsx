import { useEffect, useMemo, useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle, SkeletonCards } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { fmtDate, fmtNum } from "../lib/format";

// ═══ REACH — the outreach engine & relationship health ═══════════════

interface Campaign { id: string; name: string; nameAr?: string | null; goal?: string | null; audienceKind: string; steps: string | Step[]; status: string; touchCount?: number; plannedCount?: number; wonCount?: number }
interface Step { day: number; channel: string; templateId?: string | null }
interface Touch { id: string; targetId: string; targetName: string; stepNo: number; channel: string; templateId?: string | null; dueAt?: string | null; status: string; note?: string | null; sentAt?: string | null }
interface AudienceRow { id: string; name: string; sub?: string | null; phone?: string | null }
interface WaTpl { id: string; name: string }
interface HealthRes { counts: { warm: number; cooling: number; cold: number }; contacts: { id: string; name: string; outlet?: string | null; tier?: string | null; days: number; health: string }[] }
interface Coverage { id: string; title: string; periodStart: string; periodEnd: string; snapshot: string | Snapshot; createdAt: string }
interface Snapshot { pressCount: number; press: { title: string; url?: string | null; publishedAt?: string | null; contact?: string | null; outlet?: string | null }[]; signalCount: number; topics: { label: string; count: number }[]; sov: { ownMentions: number; competitorMentions: number; sovPct: number | null; perCompetitor: { name: string; count: number }[] }; outreach: { sent: number; replied: number; placed: number } }
interface Competitor { id: string; name: string; nameAr?: string | null; listeningTopicId?: string | null; topicLabel?: string | null; mentions30d?: number; notes?: string | null; active: boolean }
interface Topic { id: string; label: string }

const P = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const AUD_KINDS = ["MEDIA", "INFLUENCER", "CUSTOMER", "CUSTOM"];
const CHANNELS = ["WA", "EMAIL", "CALL"];
const C_TONE: Record<string, string> = { DRAFT: "bg-paper-200 text-ink-600", ACTIVE: "bg-moss-100 text-moss-700", PAUSED: "bg-amber-500/15 text-amber-700", DONE: "bg-ink-900/10 text-ink-600" };
const T_TONE: Record<string, string> = { PLANNED: "bg-paper-200 text-ink-600", SENT: "bg-amber-500/15 text-amber-700", REPLIED: "bg-moss-100 text-moss-700", PLACED: "bg-amber-600 text-paper-50", DECLINED: "bg-clay-100 text-clay-700", SKIPPED: "bg-paper-300 text-ink-400" };
const NEXT: Record<string, string[]> = { PLANNED: ["SENT", "SKIPPED"], SENT: ["REPLIED", "DECLINED", "PLACED"], REPLIED: ["PLACED"], SKIPPED: ["PLANNED"], DECLINED: [], PLACED: [] };

// ── Campaigns tab ────────────────────────────────────────────────────
function CampaignsTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: camps, reload } = useFetch<Campaign[]>("/outreach");
  const { data: waTpls } = useFetch<WaTpl[]>("/wa-templates");
  const [sel, setSel] = useState<Campaign | null>(null);
  const [ed, setEd] = useState<{ name: string; nameAr: string; goal: string; audienceKind: string; steps: Step[] } | null>(null);

  const nm = (c: { name: string; nameAr?: string | null }) => (lang === "ar" && c.nameAr ? c.nameAr : c.name);

  const save = async () => {
    if (!ed?.name || !ed.steps.length) { toast.push(tr("rc_needBasics"), "error"); return; }
    try {
      await api.post("/outreach", { ...ed, nameAr: ed.nameAr || null, goal: ed.goal || null, status: "ACTIVE" });
      setEd(null); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const setStatus = async (c: Campaign, status: string) => { await api.patch(`/outreach/${c.id}`, { status }); reload(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>{tr("rc_campaigns")}</SectionTitle>
        {writable && <button className="btn-amber" onClick={() => setEd({ name: "", nameAr: "", goal: "", audienceKind: "MEDIA", steps: [{ day: 0, channel: "WA", templateId: null }] })}>{tr("rc_new")}</button>}
      </div>
      {!camps ? <SkeletonCards count={2} /> : !camps.length ? (
        <Card className="p-6 text-center text-sm text-ink-500">{tr("rc_empty")}</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {camps.map((c) => (
            <Card key={c.id} className="p-4 transition hover:shadow-md">
              <div className="flex cursor-pointer items-start justify-between gap-2" onClick={() => setSel(c)}>
                <div>
                  <div className="font-semibold text-ink-800">{nm(c)}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">{tr(`rc_aud_${c.audienceKind}`)} · {(P(c.steps) as Step[]).length} {tr("rc_steps")}{c.goal ? ` · ${c.goal}` : ""}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${C_TONE[c.status]}`}>{tr(`rc_st_${c.status}`)}</span>
              </div>
              <div className="mt-3 flex cursor-pointer gap-4 text-[11px] text-ink-500" dir="ltr" onClick={() => setSel(c)}>
                <span className="kpi-num">{c.touchCount || 0} {tr("rc_touches")}</span>
                <span className="kpi-num text-amber-700">{c.plannedCount || 0} {tr("rc_planned")}</span>
                <span className="kpi-num text-moss-700">{c.wonCount || 0} {tr("rc_won")}</span>
              </div>
              {writable && (
                <div className="mt-2 flex gap-2 border-t border-paper-200 pt-2">
                  {c.status === "ACTIVE" ? <button className="text-[11px] text-ink-500 hover:underline" onClick={() => setStatus(c, "PAUSED")}>{tr("rc_pause")}</button>
                    : <button className="text-[11px] text-moss-700 hover:underline" onClick={() => setStatus(c, "ACTIVE")}>{tr("rc_activate")}</button>}
                  <button className="text-[11px] text-ink-500 hover:underline" onClick={() => setStatus(c, "DONE")}>{tr("rc_finish")}</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {sel && <CampaignDetail c={sel} onClose={() => { setSel(null); reload(); }} writable={writable} waTpls={waTpls || []} />}

      <Modal open={!!ed} onClose={() => setEd(null)} title={tr("rc_new")}
        footer={<><button onClick={() => setEd(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {ed && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" dir="rtl" value={ed.nameAr} onChange={(e) => setEd({ ...ed, nameAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></Field>
              <Field label={tr("rc_goal")}><input className="input" value={ed.goal} onChange={(e) => setEd({ ...ed, goal: e.target.value })} /></Field>
              <Field label={tr("rc_audience")}><Select value={ed.audienceKind} onChange={(v) => setEd({ ...ed, audienceKind: v })} options={AUD_KINDS.map((k) => ({ value: k, label: tr(`rc_aud_${k}`) }))} /></Field>
            </div>
            <div className="rounded-xl border border-paper-200 bg-paper-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-500">{tr("rc_sequence")}</span>
                <button className="btn-ghost text-xs" onClick={() => setEd({ ...ed, steps: [...ed.steps, { day: (ed.steps[ed.steps.length - 1]?.day ?? 0) + 3, channel: "WA", templateId: null }] })}>+ {tr("add")}</button>
              </div>
              <div className="space-y-2">
                {ed.steps.map((st, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-ink-400" dir="ltr">#{i + 1}</span>
                    <span className="text-xs text-ink-500">{tr("rc_day")}</span>
                    <input className="input w-16" type="number" dir="ltr" value={st.day}
                      onChange={(e) => setEd({ ...ed, steps: ed.steps.map((s, j) => (j === i ? { ...s, day: Number(e.target.value) } : s)) })} />
                    <Select value={st.channel} onChange={(v) => setEd({ ...ed, steps: ed.steps.map((s, j) => (j === i ? { ...s, channel: v } : s)) })}
                      options={CHANNELS.map((ch) => ({ value: ch, label: tr(`rc_ch_${ch}`) }))} />
                    {st.channel === "WA" && (
                      <Select value={st.templateId || ""} onChange={(v) => setEd({ ...ed, steps: ed.steps.map((s, j) => (j === i ? { ...s, templateId: v || null } : s)) })}
                        placeholder={tr("au_waTpl")} options={(waTpls || []).map((t) => ({ value: t.id, label: t.name }))} />
                    )}
                    <button className="text-clay-600" onClick={() => setEd({ ...ed, steps: ed.steps.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Campaign detail: enroll + the touches board ──────────────────────
function CampaignDetail({ c, onClose, writable, waTpls }: { c: Campaign; onClose: () => void; writable: boolean; waTpls: WaTpl[] }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [touches, setTouches] = useState<Touch[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [q, setQ] = useState("");
  const [aud, setAud] = useState<AudienceRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sendOut, setSendOut] = useState<{ textAr?: string; text?: string; waUrl?: string | null } | null>(null);

  const load = async () => setTouches(await api.get<Touch[]>(`/outreach/${c.id}/touches`));
  useEffect(() => { load(); }, [c.id]);
  useEffect(() => {
    if (!enrolling) return;
    const t = setTimeout(async () => setAud(await api.get<AudienceRow[]>(`/outreach/audience?kind=${c.audienceKind}&q=${encodeURIComponent(q)}`)), 250);
    return () => clearTimeout(t);
  }, [q, enrolling, c.audienceKind]);

  const enroll = async () => {
    if (!picked.size) return;
    try {
      const r = await api.post<{ enrolled: number; skipped: number }>(`/outreach/${c.id}/enroll`, { targetIds: [...picked] });
      toast.push(`${tr("rc_enrolled")}: ${r.enrolled} · ${tr("rc_skipped")}: ${r.skipped}`, "success");
      setEnrolling(false); setPicked(new Set()); load();
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const send = async (t: Touch) => {
    try {
      const r = await api.post<{ ok: boolean; textAr?: string; text?: string; waUrl?: string | null }>(`/outreach-touches/${t.id}/send`, {});
      if (r.waUrl || r.textAr || r.text) setSendOut(r); else toast.push(tr("rc_sentOk"), "success");
      load();
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const move = async (t: Touch, status: string) => {
    try { await api.patch(`/outreach-touches/${t.id}`, { status }); load(); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Touch[]>();
    for (const t of touches || []) { const k = t.targetName; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return [...m.entries()];
  }, [touches]);

  return (
    <Modal open onClose={onClose} title={lang === "ar" && c.nameAr ? c.nameAr : c.name}
      footer={<button onClick={onClose} className="btn-ghost">{tr("close")}</button>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-500">{tr(`rc_aud_${c.audienceKind}`)} · {(P(c.steps) as Step[]).map((s) => `${tr("rc_day")} ${s.day} ${tr(`rc_ch_${s.channel}`)}`).join(" ← ")}</span>
          {writable && c.audienceKind !== "PARTNER" && <button className="btn-amber text-xs" onClick={() => setEnrolling(!enrolling)}>{tr("rc_enroll")}</button>}
        </div>

        {enrolling && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <input className="input" placeholder={tr("search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {aud.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-paper-100">
                  <input type="checkbox" checked={picked.has(a.id)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(a.id) : n.delete(a.id); setPicked(n); }} />
                  <span className="font-medium text-ink-800">{a.name}</span>
                  <span className="text-[11px] text-ink-500">{a.sub || ""}</span>
                  {!a.phone && <span className="text-[10px] text-clay-600">{tr("rc_noPhone")}</span>}
                </label>
              ))}
              {!aud.length && <p className="px-2 py-1 text-xs text-ink-400">{tr("empty")}</p>}
            </div>
            <button className="btn-amber mt-2 text-xs" onClick={enroll}>{tr("rc_enrollN")} ({picked.size})</button>
          </div>
        )}

        <div className="max-h-[46vh] space-y-3 overflow-y-auto">
          {grouped.map(([name, list]) => (
            <div key={name} className="rounded-xl border border-paper-200 p-3">
              <div className="mb-1.5 text-sm font-semibold text-ink-800">{name}</div>
              <div className="space-y-1.5">
                {list.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-400" dir="ltr">#{t.stepNo}</span>
                    <span className="text-ink-600">{tr(`rc_ch_${t.channel}`)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${T_TONE[t.status]}`}>{tr(`rc_ts_${t.status}`)}</span>
                    {t.dueAt && t.status === "PLANNED" && <span className="text-ink-400">{fmtDate(t.dueAt)}</span>}
                    {t.note && <span className="text-ink-500">“{t.note}”</span>}
                    {writable && (
                      <span className="ms-auto flex gap-1.5">
                        {t.status === "PLANNED" && t.channel === "WA" && t.templateId && (
                          <button className="rounded-lg bg-ink-900 px-2 py-0.5 text-[10px] font-bold text-paper-50" onClick={() => send(t)}>{tr("rc_send")}</button>
                        )}
                        {NEXT[t.status].filter((n) => !(t.status === "PLANNED" && n === "SENT" && t.channel === "WA" && t.templateId)).map((n) => (
                          <button key={n} className="text-[10px] text-ink-500 hover:underline" onClick={() => move(t, n)}>{tr(`rc_ts_${n}`)}</button>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {touches && !touches.length && <p className="text-sm text-ink-500">{tr("rc_noTouches")}</p>}
        </div>
      </div>

      <Modal open={!!sendOut} onClose={() => setSendOut(null)} title={tr("rc_readyToSend")}
        footer={<button onClick={() => setSendOut(null)} className="btn-ghost">{tr("close")}</button>}>
        {sendOut && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-xl border border-paper-200 bg-paper-50 p-3 text-sm text-ink-800" dir="rtl">{sendOut.textAr || sendOut.text}</p>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => { navigator.clipboard.writeText(sendOut.textAr || sendOut.text || ""); toast.push(tr("pb_copied"), "success"); }}>{tr("pb_copied")}</button>
              {sendOut.waUrl && <a className="btn-amber text-xs" href={sendOut.waUrl} target="_blank" rel="noreferrer">{tr("au_openWa")}</a>}
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  );
}

// ── Health tab ───────────────────────────────────────────────────────
function HealthTab() {
  const { tr } = useI18n();
  const { data } = useFetch<HealthRes>("/outreach/health");
  const H_TONE: Record<string, string> = { warm: "bg-moss-100 text-moss-700", cooling: "bg-amber-500/15 text-amber-700", cold: "bg-clay-100 text-clay-700" };
  return (
    <div className="space-y-4">
      <SectionTitle>{tr("rc_health")}</SectionTitle>
      <p className="text-xs text-ink-500">{tr("rc_healthHint")}</p>
      {!data ? <SkeletonCards count={1} /> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {(["warm", "cooling", "cold"] as const).map((b) => (
              <Card key={b} className="p-4 text-center">
                <div className={`mx-auto w-fit rounded-full px-2.5 py-0.5 text-[10px] font-bold ${H_TONE[b]}`}>{tr(`rc_h_${b}`)}</div>
                <div className="kpi-num mt-2 text-2xl text-ink-800" dir="ltr">{fmtNum(data.counts[b], "en")}</div>
              </Card>
            ))}
          </div>
          <Card className="p-4">
            <table className="w-full text-sm">
              <thead><tr className="text-start text-[11px] uppercase tracking-wide text-ink-400">
                <th className="pb-2 text-start">{tr("name")}</th><th className="pb-2 text-start">{tr("rc_outlet")}</th>
                <th className="pb-2 text-start">{tr("rc_tier")}</th><th className="pb-2 text-start">{tr("rc_lastTouch")}</th><th className="pb-2" /></tr></thead>
              <tbody className="divide-y divide-paper-200">
                {data.contacts.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-medium text-ink-800">{r.name}</td>
                    <td className="py-2 text-ink-500">{r.outlet || "—"}</td>
                    <td className="py-2 text-ink-500" dir="ltr">{r.tier || "—"}</td>
                    <td className="py-2 text-ink-500" dir="ltr">{r.days >= 9999 ? tr("rc_never") : `${r.days} ${tr("au_days")}`}</td>
                    <td className="py-2 text-end"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${H_TONE[r.health]}`}>{tr(`rc_h_${r.health}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Coverage tab ─────────────────────────────────────────────────────
function CoverageTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: reports, reload } = useFetch<Coverage[]>("/coverage-reports");
  const [sel, setSel] = useState<Coverage | null>(null);
  const today = new Date(); const mAgo = new Date(Date.now() - 30 * 864e5);
  const d10 = (d: Date) => d.toISOString().slice(0, 10);
  const [form, setForm] = useState({ title: "", periodStart: d10(mAgo), periodEnd: d10(today) });

  const compile = async () => {
    if (!form.title) { toast.push(tr("rc_needTitle"), "error"); return; }
    try {
      const r = await api.post<Coverage>("/coverage-reports/compile", form);
      reload(); setSel(r); toast.push(tr("rc_compiled"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const snap = sel ? (P(sel.snapshot) as Snapshot) : null;

  return (
    <div className="space-y-4">
      <SectionTitle>{tr("rc_coverage")}</SectionTitle>
      {writable && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Field label={tr("rc_reportTitle")}><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={tr("rc_titlePh")} /></Field>
          <Field label={tr("rc_from")}><input type="date" className="input" dir="ltr" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></Field>
          <Field label={tr("rc_to")}><input type="date" className="input" dir="ltr" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></Field>
          <button className="btn-amber" onClick={compile}>{tr("rc_compile")}</button>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="p-3">
          {!reports?.length ? <p className="p-2 text-sm text-ink-500">{tr("empty")}</p> : (
            <ul className="divide-y divide-paper-200">
              {reports.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSel(r)} className={`w-full rounded-lg px-2 py-2 text-start text-sm hover:bg-paper-100 ${sel?.id === r.id ? "bg-paper-100 font-semibold" : ""}`}>
                    <div className="text-ink-800">{r.title}</div>
                    <div className="text-[11px] text-ink-500" dir="ltr">{r.periodStart} → {r.periodEnd}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>
          {!snap ? <Card className="p-6 text-center text-sm text-ink-500">{tr("rc_pickReport")}</Card> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[[tr("rc_press"), snap.pressCount], [tr("rc_signals"), snap.signalCount],
                  [tr("rc_sov"), snap.sov.sovPct != null ? `${snap.sov.sovPct}%` : "—"],
                  [tr("rc_placements"), snap.outreach.placed]].map(([label, v]) => (
                  <Card key={String(label)} className="p-3 text-center">
                    <div className="text-[11px] text-ink-500">{label}</div>
                    <div className="kpi-num mt-1 text-xl text-ink-800" dir="ltr">{v as string | number}</div>
                  </Card>
                ))}
              </div>
              <Card className="p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-500">{tr("rc_outreachLine")}</div>
                <div className="mt-1 text-sm text-ink-700" dir="ltr">
                  {snap.outreach.sent} {tr("rc_sent")} → {snap.outreach.replied} {tr("rc_replied")} → {snap.outreach.placed} {tr("rc_placed")}
                </div>
              </Card>
              {snap.sov.perCompetitor.length > 0 && (
                <Card className="p-4">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">{tr("rc_sovSplit")}</div>
                  {[{ name: tr("rc_us"), count: snap.sov.ownMentions }, ...snap.sov.perCompetitor].map((row, i) => {
                    const max = Math.max(snap.sov.ownMentions, ...snap.sov.perCompetitor.map((x) => x.count), 1);
                    return (
                      <div key={i} className="mb-1.5 flex items-center gap-2 text-xs">
                        <span className="w-28 truncate text-ink-700">{row.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-200">
                          <div className={`h-full ${i === 0 ? "bg-amber-500" : "bg-ink-300"}`} style={{ width: `${(row.count / max) * 100}%` }} />
                        </div>
                        <span className="kpi-num w-8 text-end text-ink-500" dir="ltr">{row.count}</span>
                      </div>
                    );
                  })}
                </Card>
              )}
              {snap.press.length > 0 && (
                <Card className="p-4">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">{tr("rc_pressList")}</div>
                  <ul className="divide-y divide-paper-200">
                    {snap.press.slice(0, 10).map((p, i) => (
                      <li key={i} className="py-2 text-sm">
                        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-ink-800 hover:text-amber-700">{p.title}</a>
                          : <span className="font-medium text-ink-800">{p.title}</span>}
                        <div className="text-[11px] text-ink-500">{[p.outlet, p.contact, p.publishedAt ? fmtDate(p.publishedAt) : null].filter(Boolean).join(" · ")}</div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Competitors tab ──────────────────────────────────────────────────
function CompetitorsTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: comps, reload } = useFetch<Competitor[]>("/competitors");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [ed, setEd] = useState<{ name: string; nameAr: string; listeningTopicId: string; notes: string } | null>(null);
  useEffect(() => { api.get<Topic[]>("/osint/topics").then(setTopics).catch(() => setTopics([])); }, []);

  const save = async () => {
    if (!ed?.name) return;
    try {
      await api.post("/competitors", { name: ed.name, nameAr: ed.nameAr || null, listeningTopicId: ed.listeningTopicId || null, notes: ed.notes || null });
      setEd(null); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>{tr("rc_competitors")}</SectionTitle>
        {writable && <button className="btn-amber" onClick={() => setEd({ name: "", nameAr: "", listeningTopicId: "", notes: "" })}>{tr("add")}</button>}
      </div>
      <p className="text-xs text-ink-500">{tr("rc_compHint")}</p>
      <Card className="p-4">
        {!comps?.length ? <p className="text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="divide-y divide-paper-200">
            {comps.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <span className="font-medium text-ink-800">{lang === "ar" && c.nameAr ? c.nameAr : c.name}</span>
                  {!c.active && <span className="ms-2 rounded-full bg-paper-200 px-2 py-0.5 text-[10px]">{tr("pb_off")}</span>}
                  <div className="text-[11px] text-ink-500">{c.topicLabel ? `📡 ${c.topicLabel}` : tr("rc_noTopic")}{c.notes ? ` · ${c.notes}` : ""}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="kpi-num text-xs text-ink-600" dir="ltr">{c.mentions30d ?? 0} <span className="text-ink-400">{tr("rc_mentions30")}</span></span>
                  {writable && <button className="text-[11px] text-ink-500 hover:underline" onClick={async () => { await api.patch(`/competitors/${c.id}`, { active: !c.active }); reload(); }}>{c.active ? tr("pb_disable") : tr("pb_enable")}</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!ed} onClose={() => setEd(null)} title={tr("rc_newComp")}
        footer={<><button onClick={() => setEd(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {ed && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" dir="rtl" value={ed.nameAr} onChange={(e) => setEd({ ...ed, nameAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></Field>
            </div>
            <Field label={tr("rc_topicBind")}><Select value={ed.listeningTopicId} onChange={(v) => setEd({ ...ed, listeningTopicId: v })} placeholder={tr("none")} options={topics.map((t) => ({ value: t.id, label: t.label }))} /></Field>
            <Field label={tr("notes")}><textarea className="input" rows={2} value={ed.notes} onChange={(e) => setEd({ ...ed, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
export default function Reach() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const writable = can("reach", "write");
  const [tab, setTab] = useState<"camp" | "health" | "cov" | "comp">("camp");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {([["camp", tr("rc_tabCamp")], ["health", tr("rc_tabHealth")], ["cov", tr("rc_tabCov")], ["comp", tr("rc_tabComp")]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${tab === id ? "bg-ink-900 text-paper-50" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "camp" && <CampaignsTab writable={writable} />}
      {tab === "health" && <HealthTab />}
      {tab === "cov" && <CoverageTab writable={writable} />}
      {tab === "comp" && <CompetitorsTab writable={writable} />}
    </div>
  );
}
