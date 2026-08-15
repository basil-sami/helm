import { useEffect, useState } from "react";
import { Card, SectionTitle, Select } from "./ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";

// ═══ UI·DEBT3 · THE CONTROL ROOM GETS ITS DOOR ════════════════════════
// W4·F shipped a full listening control-plane — band calibration with
// replay-before-apply, Admiralty regrades that demand a written reason,
// block-vs-mute source levers, watch assignment, bulk queue rulings
// that feed the agreement KPI, alert rules under the guardrail, and a
// change trail. Seventeen verbs, zero consumers — until now. The UI
// adds nothing the rail doesn't have and shows every refusal verbatim.

interface Overview {
  settings: { bandLow: number; bandHigh: number; slaHours: number; paused: boolean };
  queue: { pending: number; overdueSla: number; oldestHours: number | null };
  sources: { total: number; blocked: number; muted: number };
  watches: { total: number; paused: number };
  budgets: { provider: string; usedUsd: number; capUsd: number; pctOfCap: number; warn?: boolean; exhausted?: boolean }[];
  recentChanges: Change[];
  guardrail: { entityKinds: string[]; note: string };
}
interface Source { id: string; domain: string; reliability: string | null; gradeNote?: string; gradedByName?: string; active: boolean; muted: boolean; signals: number }
interface Watch { id: string; label: string; campaignId?: string | null; campaignName?: string; assigneeId?: string | null; assigneeName?: string; paused: boolean; signals: number; pending: number }
interface QItem { id: string; title: string; source?: string; topicLabel?: string; aiRelevance?: number | null; aiVerdict?: string | null; reliability?: string | null; muted?: boolean; assignedToName?: string }
interface Rule { id: string; name: string; kind: string; topicLabel?: string; entityName?: string; threshold: number; windowHours: number; severity: string; corroboratedOnly: boolean; active: boolean }
interface Change { id?: string; kind: string; field?: string; from?: string | number | boolean | null; to?: string | number | boolean | null; note?: string | null; byName?: string; at?: string; createdAt?: string }

const GRADE_TONE: Record<string, string> = {
  A: "bg-moss-500/15 text-moss-700", B: "bg-moss-500/10 text-moss-700", C: "bg-amber-500/15 text-amber-700",
  D: "bg-amber-500/10 text-amber-700", E: "bg-clay-500/10 text-clay-700", F: "bg-clay-500/15 text-clay-700",
};
const RULE_KINDS = ["VOLUME_SPIKE", "NEGATIVE_BURST", "GRADE_A_MENTION", "EMERGING_TOPIC"];

export function ListeningControl() {
  const { lang, tr } = useI18n();
  const { can, user } = useAuth();
  const toast = useToast();
  const admin = can("system", "write");
  const w = can("intel", "write");

  const [ov, setOv] = useState<Overview | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  const [band, setBand] = useState<{ lo: string; hi: string; note: string } | null>(null);
  const [replay, setReplay] = useState<{ nowPending?: number; wouldPend?: number; wouldAuto?: number; delta?: number } | null>(null);
  const [grading, setGrading] = useState<{ id: string; grade: string; note: string } | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [ruleReason, setRuleReason] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [newRule, setNewRule] = useState<{ name: string; kind: string; topicId: string; threshold: string; windowHours: string; severity: string; corroboratedOnly: boolean } | null>(null);
  const [fired, setFired] = useState<string>("");

  const load = async () => {
    try {
      const [o, s, wt, q, r, c, u] = await Promise.all([
        api.get<Overview>("/listening/control"),
        api.get<Source[]>("/listening/control/sources"),
        api.get<Watch[]>("/listening/control/watches"),
        api.get<{ health: Overview["queue"]; items: QItem[] }>("/listening/control/queue"),
        api.get<Rule[]>("/listening/control/rules"),
        api.get<Change[]>("/listening/control/changes?days=90"),
        api.get<{ id: string; name: string }[]>("/users"),
      ]);
      setOv(o); setSources(s); setWatches(wt); setQueue(q.items); setRules(r); setChanges(c.slice(0, 10)); setUsers(u);
      setBand({ lo: String(o.settings.bandLow), hi: String(o.settings.bandHigh), note: "" });
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try { const r = await fn(); if (okMsg) toast.push(okMsg, "success"); await load(); return r; }
    catch (e) { toast.push((e as Error).message, "error"); return null; }
  };

  if (!ov || !band) return <div className="skeleton h-40 w-full rounded-2xl" />;
  const st = ov.settings;

  return (
    <div className="space-y-4">
      {/* ── the cockpit strip: state, SLA, budgets, and the line no lever can cross ── */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button disabled={!w} onClick={() => act(() => api.patch("/listening/control/settings", { paused: !st.paused }), st.paused ? tr("lc_resumed") : tr("lc_pausedMsg"))}
            className={`rounded-full px-3 py-1 font-semibold ${st.paused ? "bg-clay-500/15 text-clay-700" : "bg-moss-500/12 text-moss-700"}`}>
            {st.paused ? `⏸ ${tr("lc_paused")}` : `● ${tr("lc_live")}`}
          </button>
          <span className="rounded-full bg-paper-100 px-2.5 py-1">{tr("lc_queue")}: <b className="kpi-num">{ov.queue.pending}</b>{ov.queue.overdueSla > 0 && <b className="ms-1 text-clay-600">({ov.queue.overdueSla} {tr("lc_overSla")})</b>}</span>
          <span className="rounded-full bg-paper-100 px-2.5 py-1" dir="ltr">SLA {st.slaHours}h</span>
          {ov.budgets.map((b) => (
            <span key={b.provider} className={`rounded-full px-2.5 py-1 ${b.exhausted ? "bg-clay-500/15 text-clay-700" : b.warn ? "bg-amber-500/15 text-amber-700" : "bg-paper-100 text-ink-600"}`} dir="ltr">
              {b.provider} {Math.round(b.pctOfCap)}%
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          🛡 {tr("lc_guardrail")}: {ov.guardrail.entityKinds.join(" · ")} — <span className="italic">{ov.guardrail.note}</span>
        </p>
      </Card>

      {/* ── the band: replay first, apply second ── */}
      <Card>
        <SectionTitle>🎚 {tr("lc_band")}</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("lc_bandSub")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><span className="label">{tr("lc_bandLow")}</span>
            <input className="input h-9 w-24" dir="ltr" type="number" step="0.05" min={0} max={1} value={band.lo} onChange={(e) => setBand({ ...band, lo: e.target.value })} /></div>
          <div><span className="label">{tr("lc_bandHigh")}</span>
            <input className="input h-9 w-24" dir="ltr" type="number" step="0.05" min={0} max={1} value={band.hi} onChange={(e) => setBand({ ...band, hi: e.target.value })} /></div>
          <button disabled={!w} onClick={async () => {
            const r = await act(() => api.post<typeof replay>("/listening/control/replay", { bandLow: Number(band.lo), bandHigh: Number(band.hi), days: 7 }));
            if (r) setReplay(r as typeof replay);
          }} className="btn-ghost text-xs">👁 {tr("lc_replay")}</button>
          {replay && (
            <button disabled={!w} onClick={() => { act(() => api.patch("/listening/control/band", { bandLow: Number(band.lo), bandHigh: Number(band.hi), note: band.note || null }), tr("saved")); setReplay(null); }}
              className="btn-amber text-xs">✓ {tr("lc_apply")}</button>
          )}
        </div>
        {replay && (
          <div className="mt-2 rounded-lg bg-paper-100 px-3 py-2 text-xs text-ink-700" dir="auto">
            {tr("lc_replayResult")} — {Object.entries(replay).map(([k, v]) => `${k}: ${v}`).join(" · ")}
          </div>
        )}
        {replay && <input className="input mt-2 h-9 text-xs" dir="auto" placeholder={tr("lc_changeNote")} value={band.note} onChange={(e) => setBand({ ...band, note: e.target.value })} />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── sources: block stops ingestion, mute keeps evidence ── */}
        <Card>
          <SectionTitle>📡 {tr("lc_sources")}</SectionTitle>
          <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("lc_sourcesSub")}</p>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {sources.map((s) => (
              <div key={s.id} className="rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${s.reliability ? GRADE_TONE[s.reliability] : "bg-paper-100 text-ink-400"}`}>{s.reliability || "–"}</span>
                    <span className="truncate font-medium text-ink-800" dir="ltr">{s.domain}</span>
                    <span className="kpi-num text-[10px] text-ink-400">{s.signals}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {admin && <button onClick={() => setGrading(grading?.id === s.id ? null : { id: s.id, grade: s.reliability || "C", note: "" })} className="rounded-md bg-paper-100 px-1.5 py-0.5 text-[10px] hover:bg-paper-200">⚖</button>}
                    <button disabled={!w} onClick={() => act(() => api.patch(`/listening/control/sources/${s.id}/lever`, { muted: !s.muted }), s.muted ? tr("lc_unmuted") : tr("lc_mutedMsg"))}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] ${s.muted ? "bg-amber-500/15 text-amber-700" : "bg-paper-100 hover:bg-paper-200"}`}>🔇</button>
                    <button disabled={!w} onClick={() => act(() => api.patch(`/listening/control/sources/${s.id}/lever`, { blocked: s.active }), s.active ? tr("lc_blockedMsg") : tr("lc_unblocked"))}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] ${!s.active ? "bg-clay-500/15 text-clay-700" : "bg-paper-100 hover:bg-paper-200"}`}>🚫</button>
                  </span>
                </div>
                {grading?.id === s.id && (
                  <div className="mt-1.5 flex gap-1.5">
                    <Select value={grading.grade} onChange={(v: string) => setGrading({ ...grading, grade: v })}
                      options={["A", "B", "C", "D", "E", "F"].map((g) => ({ value: g, label: g }))} />
                    <input className="input h-8 flex-1 text-[11px]" dir="auto" placeholder={tr("lc_gradeWhy")} value={grading.note} onChange={(e) => setGrading({ ...grading, note: e.target.value })} />
                    <button onClick={() => { act(() => api.patch(`/listening/control/sources/${grading.id}/grade`, { reliability: grading.grade, note: grading.note }), tr("saved")); setGrading(null); }}
                      className="btn-amber text-xs">✓</button>
                  </div>
                )}
              </div>
            ))}
            {sources.length === 0 && <p className="text-xs text-ink-400">{tr("lc_noSources")}</p>}
          </div>
        </Card>

        {/* ── watches ── */}
        <Card>
          <SectionTitle>👁 {tr("lc_watches")}</SectionTitle>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {watches.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="truncate font-medium text-ink-800" dir="auto">{t.label}</span>
                  {t.campaignName && <span className="ms-2 text-[10px] text-steel-600">{t.campaignName}</span>}
                  {t.pending > 0 && <b className="ms-2 kpi-num text-[10px] text-amber-700">{t.pending} {tr("lc_pendingShort")}</b>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Select value={t.assigneeId || ""} onChange={(v: string) => act(() => api.patch(`/listening/control/watches/${t.id}`, { assigneeId: v || null }))}
                    placeholder={tr("lc_assignee")} options={users.map((u) => ({ value: u.id, label: u.name }))} />
                  <button disabled={!w} onClick={() => act(() => api.patch(`/listening/control/watches/${t.id}`, { paused: !t.paused }))}
                    className={`rounded-md px-1.5 py-1 text-[10px] ${t.paused ? "bg-amber-500/15 text-amber-700" : "bg-paper-100 hover:bg-paper-200"}`}>{t.paused ? "⏸" : "▶"}</button>
                </span>
              </div>
            ))}
            {watches.length === 0 && <p className="text-xs text-ink-400">{tr("lc_noWatches")}</p>}
          </div>
        </Card>
      </div>

      {/* ── the review queue: the model recommends, the analyst rules ── */}
      <Card>
        <SectionTitle>📥 {tr("lc_reviewQueue")} <span className="kpi-num text-sm text-ink-400">({queue.length})</span></SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("lc_queueSub")}</p>
        {queue.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-paper-100 px-2.5 py-2 text-xs">
            <span className="text-ink-500">{sel.length} {tr("lc_selected")}</span>
            <Select value={assignTo} onChange={(v: string) => setAssignTo(v)} placeholder={tr("lc_assignTo")}
              options={[{ value: user?.id || "", label: tr("lc_me") }, ...users.filter((u) => u.id !== user?.id).map((u) => ({ value: u.id, label: u.name }))]} />
            <button disabled={!w || !sel.length} onClick={() => { act(() => api.post("/listening/control/queue/assign", { ids: sel, assigneeId: assignTo || undefined }), tr("lc_assigned")); setSel([]); }}
              className="btn-ghost text-xs">👤 {tr("lc_assign")}</button>
            <span className="mx-1 h-4 w-px bg-paper-300" />
            <input className="input h-8 w-44 text-[11px]" dir="auto" placeholder={tr("lc_ruleReason")} value={ruleReason} onChange={(e) => setRuleReason(e.target.value)} />
            <button disabled={!w || !sel.length} onClick={async () => {
              const r = await act(() => api.post<{ ruled: number; agreedWithAi: number }>("/listening/control/queue/rule", { ids: sel, verdict: "CONFIRMED", reason: ruleReason || undefined }));
              if (r) toast.push(`${tr("lc_ruled")} ${(r as { ruled: number }).ruled} · ${tr("lc_aiAgreed")} ${(r as { agreedWithAi: number }).agreedWithAi}`, "success");
              setSel([]); setRuleReason("");
            }} className="rounded-lg bg-moss-500/12 px-2.5 py-1.5 font-medium text-moss-700 hover:bg-moss-500/20">✓ {tr("lc_confirm")}</button>
            <button disabled={!w || !sel.length} onClick={async () => {
              const r = await act(() => api.post<{ ruled: number; agreedWithAi: number }>("/listening/control/queue/rule", { ids: sel, verdict: "REJECTED", reason: ruleReason || undefined }));
              if (r) toast.push(`${tr("lc_ruled")} ${(r as { ruled: number }).ruled} · ${tr("lc_aiAgreed")} ${(r as { agreedWithAi: number }).agreedWithAi}`, "success");
              setSel([]); setRuleReason("");
            }} className="rounded-lg bg-clay-500/10 px-2.5 py-1.5 font-medium text-clay-700 hover:bg-clay-500/20">✗ {tr("lc_reject")}</button>
          </div>
        )}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {queue.map((q) => (
            <label key={q.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs hover:border-amber-500/30">
              <input type="checkbox" checked={sel.includes(q.id)} onChange={(e) => setSel(e.target.checked ? [...sel, q.id] : sel.filter((x) => x !== q.id))} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-800" dir="auto">{q.title}</span>
                <span className="text-[10px] text-ink-400" dir="ltr">{q.source}{q.topicLabel ? ` · ${q.topicLabel}` : ""}{q.assignedToName ? ` · → ${q.assignedToName}` : ""}</span>
              </span>
              {q.reliability && <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${GRADE_TONE[q.reliability]}`}>{q.reliability}</span>}
              {q.aiRelevance != null && (
                <span className="shrink-0 rounded-full bg-steel-500/10 px-1.5 py-0.5 text-[9px] text-steel-600" dir="ltr" title={tr("lc_aiHint")}>
                  🤖 {(Number(q.aiRelevance) * 100).toFixed(0)}%{q.aiVerdict ? ` ${q.aiVerdict === "RELEVANT" ? "✓" : q.aiVerdict === "NOT_RELEVANT" ? "✗" : "?"}` : ""}
                </span>
              )}
            </label>
          ))}
          {queue.length === 0 && <p className="text-xs text-ink-400">{tr("lc_queueClear")}</p>}
        </div>
      </Card>

      {/* ── alert rules under the guardrail ── */}
      <Card>
        <SectionTitle action={
          <span className="flex gap-2">
            <button disabled={!w} onClick={async () => {
              const r = await act(() => api.post<{ evaluated: number; fired: number }>("/listening/control/rules/evaluate", {}));
              if (r) setFired(`${tr("lc_evaluated")} ${(r as { evaluated: number }).evaluated} · ${tr("lc_wouldFire")} ${(r as { fired: number }).fired}`);
            }} className="btn-ghost text-xs">⚡ {tr("lc_whatFires")}</button>
            <button disabled={!w} onClick={() => setNewRule({ name: "", kind: "VOLUME_SPIKE", topicId: "", threshold: "2", windowHours: "24", severity: "MEDIUM", corroboratedOnly: false })} className="btn-ghost text-xs">+ {tr("lc_newRule")}</button>
          </span>
        }>🔔 {tr("lc_rules")}</SectionTitle>
        {fired && <p className="mb-2 rounded-lg bg-paper-100 px-2.5 py-1.5 text-xs text-ink-700">{fired}</p>}
        <div className="space-y-1">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs">
              <span className="min-w-0">
                <span className="truncate font-medium text-ink-800" dir="auto">{r.name}</span>
                <span className="ms-2 text-[10px] text-ink-400" dir="ltr">{r.kind} · ≥{r.threshold}/{r.windowHours}h · {r.severity}{r.corroboratedOnly ? " · ✓×2" : ""}</span>
                {(r.topicLabel || r.entityName) && <span className="ms-2 text-[10px] text-steel-600" dir="auto">{r.topicLabel || r.entityName}</span>}
              </span>
              <span className="flex shrink-0 gap-1">
                <button disabled={!w} onClick={() => act(() => api.patch(`/listening/control/rules/${r.id}`, { active: !r.active }))}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] ${r.active ? "bg-moss-500/12 text-moss-700" : "bg-paper-100 text-ink-400"}`}>{r.active ? tr("lc_on") : tr("lc_off")}</button>
                <button disabled={!w} onClick={() => act(() => api.del(`/listening/control/rules/${r.id}`), tr("deleted"))} className="rounded-md bg-paper-100 px-1.5 py-0.5 text-[10px] text-clay-600 hover:bg-clay-500/10">🗑</button>
              </span>
            </div>
          ))}
          {rules.length === 0 && <p className="text-xs text-ink-400">{tr("lc_noRules")}</p>}
        </div>
        {newRule && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="input h-9 text-xs" dir="auto" placeholder={tr("name")} value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
              <Select value={newRule.kind} onChange={(v: string) => setNewRule({ ...newRule, kind: v })}
                options={RULE_KINDS.map((k) => ({ value: k, label: tr(`lc_kind_${k}`) }))} />
              <Select value={newRule.topicId} onChange={(v: string) => setNewRule({ ...newRule, topicId: v })} placeholder={tr("lc_watchPick")}
                options={watches.map((t) => ({ value: t.id, label: t.label }))} />
              <Select value={newRule.severity} onChange={(v: string) => setNewRule({ ...newRule, severity: v })}
                options={["LOW", "MEDIUM", "HIGH"].map((x) => ({ value: x, label: x }))} />
              <input className="input h-9 text-xs" dir="ltr" type="number" min={1} placeholder={tr("lc_threshold")} value={newRule.threshold} onChange={(e) => setNewRule({ ...newRule, threshold: e.target.value })} />
              <input className="input h-9 text-xs" dir="ltr" type="number" min={1} max={720} placeholder={tr("lc_windowH")} value={newRule.windowHours} onChange={(e) => setNewRule({ ...newRule, windowHours: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" checked={newRule.corroboratedOnly} onChange={(e) => setNewRule({ ...newRule, corroboratedOnly: e.target.checked })} />
              {tr("lc_corrobOnly")}
            </label>
            <div className="flex gap-2">
              <button onClick={() => act(() => api.post("/listening/control/rules", {
                name: newRule.name, kind: newRule.kind, topicId: newRule.topicId || null,
                threshold: Number(newRule.threshold), windowHours: Number(newRule.windowHours),
                severity: newRule.severity, corroboratedOnly: newRule.corroboratedOnly,
              }), tr("saved")).then(() => setNewRule(null))} className="btn-amber text-xs">{tr("save")}</button>
              <button onClick={() => setNewRule(null)} className="btn-ghost text-xs">{tr("cancel")}</button>
            </div>
          </div>
        )}
      </Card>

      {/* ── the change trail: why the chart jumped ── */}
      {changes.length > 0 && (
        <Card>
          <SectionTitle>📜 {tr("lc_changes")}</SectionTitle>
          <div className="space-y-1 text-xs">
            {changes.map((c, i) => (
              <div key={c.id || i} className="flex flex-wrap items-center justify-between gap-2 text-ink-600">
                <span dir="auto">
                  <b className="text-ink-800">{c.kind}</b>{c.field ? ` · ${c.field}` : ""}
                  {c.from !== undefined && c.from !== null && <span dir="ltr"> {String(c.from)} → {String(c.to)}</span>}
                  {c.note && <span className="italic"> — {c.note}</span>}
                </span>
                <span className="kpi-num shrink-0 text-[10px] text-ink-400" dir="ltr">{(c.at || c.createdAt || "").slice(0, 10)}{c.byName ? ` · ${c.byName}` : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <p className="text-center text-[10px] text-ink-300">{lang === "ar" ? "كل زر هنا يضبط خط الأنابيب — ولا زر يتجاوزه." : "Every control tunes the pipeline — none bypasses it."}</p>
    </div>
  );
}
