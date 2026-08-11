import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import FlowCanvas, { type Node, type Library } from "./FlowCanvas";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ═══ AUTOMATE — workflows, lead scoring, WhatsApp templates ══════════

interface Workflow { id: string; name: string; nameAr?: string | null; trigger: string | { event: string; filters?: Record<string, string> }; actions: string | { type: string; [k: string]: unknown }[]; active: boolean; lastRunAt?: string | null; runCount?: number }
interface Run { id: string; workflowId: string; workflowName: string; workflowNameAr?: string | null; status: string; log: string | { action: string; ok: boolean; detail: string }[]; createdAt: string }
interface Rule { id: string; label: string; labelAr?: string | null; condition: string | { field: string; op: string; value?: unknown }; points: number; active: boolean }
interface WaTpl { id: string; name: string; nameAr?: string | null; body?: string | null; bodyAr?: string | null; category: string; uses: number }
interface LeadRow { id: string; company: string; phone?: string }
interface UserRow { id: string; name: string }

const P = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const EVENTS = ["lead.created", "lead.stage_changed", "form.submitted"];
const SCORE_FIELDS = ["source", "businessUnit", "stage", "valueUsd", "email", "phone", "company"];
const SCORE_OPS = ["eq", "neq", "gte", "lte", "contains", "notnull"];

type ActionDraft = { type: string; userId?: string; tag?: string; title?: string; assigneeId?: string; priority?: string; dueInDays?: number; templateKey?: string; templateId?: string; message?: string };

// ── Workflows tab ────────────────────────────────────────────────────
function WorkflowsTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: wfs, reload } = useFetch<Workflow[]>("/workflows");
  const { data: runs, reload: reloadRuns } = useFetch<Run[]>("/workflows/runs");
  const { data: users } = useFetch<UserRow[]>("/users");
  const { data: waTpls } = useFetch<WaTpl[]>("/wa-templates");
  const [ed, setEd] = useState<{ name: string; nameAr: string; event: string; fKey: string; fVal: string; actions: ActionDraft[] } | null>(null);
  const { data: library } = useFetch<Library>("/workflows/library");

  const nameOf = (x: { name?: string; nameAr?: string | null; workflowName?: string; workflowNameAr?: string | null }) =>
    lang === "ar" ? (x.nameAr || x.workflowNameAr || x.name || x.workflowName) : (x.name || x.workflowName);

  const ACTION_TYPES: { type: string; label: string }[] = [
    { type: "ASSIGN_OWNER", label: tr("au_actAssign") },
    { type: "ADD_TAG", label: tr("au_actTag") },
    { type: "CREATE_TASK", label: tr("au_actTask") },
    { type: "START_PROCESS", label: tr("au_actProcess") },
    { type: "SEND_WA_DRAFT", label: tr("au_actWa") },
    { type: "NOTIFY", label: tr("au_actNotify") },
  ];

  const save = async () => {
    if (!ed?.name || ed.actions.length === 0) { toast.push(tr("au_needBasics"), "error"); return; }
    try {
      await api.post("/workflows", {
        name: ed.name, nameAr: ed.nameAr || null,
        trigger: { event: ed.event, filters: ed.fKey && ed.fVal ? { [ed.fKey]: ed.fVal } : {} },
        actions: ed.actions,
      });
      setEd(null); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const toggle = async (w: Workflow) => { await api.patch(`/workflows/${w.id}`, { active: !w.active }); reload(); };
  const testFire = async (w: Workflow) => {
    try { await api.post(`/workflows/${w.id}/test`, { payload: {} }); reloadRuns(); toast.push(tr("au_tested"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  const setAction = (i: number, patch: Partial<ActionDraft>) =>
    setEd((s) => s && { ...s, actions: s.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>{tr("au_workflows")}</SectionTitle>
        {writable && <button className="btn-amber" onClick={() => setEd({ name: "", nameAr: "", event: "lead.created", fKey: "", fVal: "", actions: [{ type: "NOTIFY", message: "" }] })}>{tr("au_new")}</button>}
      </div>
      <Card className="p-4">
        {!wfs?.length ? <p className="text-sm text-ink-500">{tr("au_emptyWf")}</p> : (
          <ul className="divide-y divide-paper-200">
            {wfs.map((w) => {
              const t = P(w.trigger) as { event: string; filters?: Record<string, string> };
              const acts = P(w.actions) as { type: string }[];
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-ink-800">{nameOf(w)} {!w.active && <span className="ms-1 rounded-full bg-paper-200 px-2 py-0.5 text-[10px]">{tr("pb_off")}</span>}</div>
                    <div className="text-[11px] text-ink-500" dir="ltr">
                      ⚡ {t.event}{Object.entries(t.filters || {}).map(([k, v]) => ` · ${k}=${v}`)} → {acts.map((a) => a.type).join(" · ")}
                    </div>
                    <div className="text-[11px] text-ink-400" dir="ltr">{w.runCount || 0} runs{w.lastRunAt ? ` · ${fmtDate(w.lastRunAt)}` : ""}</div>
                  </div>
                  {writable && (
                    <div className="flex gap-2">
                      <button className="btn-ghost text-xs" onClick={() => testFire(w)}>{tr("au_test")}</button>
                      <button className="text-[11px] text-ink-500 hover:underline" onClick={() => toggle(w)}>{w.active ? tr("pb_disable") : tr("pb_enable")}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle>{tr("au_runs")}</SectionTitle>
        {!runs?.length ? <p className="mt-2 text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="mt-2 divide-y divide-paper-200">
            {runs.slice(0, 12).map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink-800">{nameOf(r)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "DONE" ? "bg-moss-100 text-moss-700" : "bg-clay-100 text-clay-700"}`}>{r.status}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-500" dir="ltr">
                  {(P(r.log) as { action: string; ok: boolean }[]).map((e) => `${e.ok ? "✓" : "✗"} ${e.action}`).join("  ")} · {fmtDate(r.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!ed} onClose={() => setEd(null)} title={tr("au_new")}
        footer={<><button onClick={() => setEd(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {ed && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" dir="rtl" value={ed.nameAr} onChange={(e) => setEd({ ...ed, nameAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={tr("au_trigger")}><Select value={ed.event} onChange={(v) => setEd({ ...ed, event: v })} options={EVENTS.map((e) => ({ value: e, label: e }))} /></Field>
              <Field label={tr("au_filterKey")}><input className="input" dir="ltr" placeholder="source" value={ed.fKey} onChange={(e) => setEd({ ...ed, fKey: e.target.value })} /></Field>
              <Field label={tr("au_filterVal")}><input className="input" dir="ltr" placeholder="EXPO" value={ed.fVal} onChange={(e) => setEd({ ...ed, fVal: e.target.value })} /></Field>
            </div>
            <div className="rounded-xl border border-paper-200 bg-paper-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-500">{tr("au_actions")}</span>
                <span className="text-[10px] text-ink-400">{tr("fb_canvasHint")}</span>
              </div>
              <FlowCanvas value={ed.actions as Node[]} library={library} onChange={(n) => setEd({ ...ed, actions: n as ActionDraft[] })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Scoring tab ──────────────────────────────────────────────────────
function ScoringTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: rules, reload } = useFetch<Rule[]>("/lead-score-rules");
  const [ed, setEd] = useState<{ label: string; labelAr: string; field: string; op: string; value: string; points: number } | null>(null);

  const save = async () => {
    if (!ed?.label) return;
    try {
      await api.post("/lead-score-rules", {
        label: ed.label, labelAr: ed.labelAr || null, points: ed.points,
        condition: { field: ed.field, op: ed.op, ...(ed.op === "notnull" ? {} : { value: ed.value }) },
      });
      setEd(null); reload(); toast.push(tr("au_rescored"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const recompute = async () => {
    const r = await api.post<{ changed: number }>("/lead-score-rules/recompute", {});
    toast.push(`${tr("au_rescored")} (${r.changed})`, "success");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>{tr("au_scoring")}</SectionTitle>
        <div className="flex gap-2">
          {writable && <button className="btn-ghost text-xs" onClick={recompute}>{tr("au_recompute")}</button>}
          {writable && <button className="btn-amber" onClick={() => setEd({ label: "", labelAr: "", field: "source", op: "eq", value: "", points: 10 })}>{tr("au_newRule")}</button>}
        </div>
      </div>
      <Card className="p-4">
        <p className="mb-2 text-xs text-ink-500">{tr("au_scoringHint")}</p>
        {!rules?.length ? <p className="text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="divide-y divide-paper-200">
            {rules.map((r) => {
              const c = P(r.condition) as { field: string; op: string; value?: unknown };
              return (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-ink-800">{lang === "ar" && r.labelAr ? r.labelAr : r.label}</span>
                    <span className="ms-2 font-mono text-[11px] text-ink-500" dir="ltr">{c.field} {c.op} {c.value !== undefined ? String(c.value) : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="kpi-num text-amber-700" dir="ltr">+{r.points}</span>
                    {writable && <button className="text-[11px] text-ink-500 hover:underline" onClick={async () => { await api.patch(`/lead-score-rules/${r.id}`, { active: !r.active }); reload(); }}>{r.active ? tr("pb_disable") : tr("pb_enable")}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!ed} onClose={() => setEd(null)} title={tr("au_newRule")}
        footer={<><button onClick={() => setEd(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {ed && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${tr("au_ruleLabel")} (AR)`}><input className="input" dir="rtl" value={ed.labelAr} onChange={(e) => setEd({ ...ed, labelAr: e.target.value })} /></Field>
            <Field label={`${tr("au_ruleLabel")} (EN)`}><input className="input" dir="ltr" value={ed.label} onChange={(e) => setEd({ ...ed, label: e.target.value })} /></Field>
            <Field label={tr("au_field")}><Select value={ed.field} onChange={(v) => setEd({ ...ed, field: v })} options={SCORE_FIELDS.map((f) => ({ value: f, label: f }))} /></Field>
            <Field label={tr("au_op")}><Select value={ed.op} onChange={(v) => setEd({ ...ed, op: v })} options={SCORE_OPS.map((o) => ({ value: o, label: o }))} /></Field>
            {ed.op !== "notnull" && <Field label={tr("au_value")}><input className="input" dir="ltr" value={ed.value} onChange={(e) => setEd({ ...ed, value: e.target.value })} /></Field>}
            <Field label={tr("au_points")}><input type="number" className="input" dir="ltr" value={ed.points} onChange={(e) => setEd({ ...ed, points: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── WA templates tab ─────────────────────────────────────────────────
function WaTab({ writable }: { writable: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: tpls, reload } = useFetch<WaTpl[]>("/wa-templates");
  const { data: leads } = useFetch<LeadRow[]>("/leads");
  const [ed, setEd] = useState<{ name: string; nameAr: string; body: string; bodyAr: string; category: string } | null>(null);
  const [tryTpl, setTryTpl] = useState<string>("");
  const [tryLead, setTryLead] = useState<string>("");
  const [out, setOut] = useState<{ text: string; textAr: string; waUrl: string | null } | null>(null);

  const save = async () => {
    if (!ed?.name) return;
    try {
      await api.post("/wa-templates", { ...ed, nameAr: ed.nameAr || null, body: ed.body || null, bodyAr: ed.bodyAr || null });
      setEd(null); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const render = async () => {
    if (!tryTpl) return;
    try {
      const r = await api.post<{ text: string; textAr: string; waUrl: string | null }>(`/wa-templates/${tryTpl}/render`, { leadId: tryLead || null });
      setOut(r); reload();
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{tr("au_waLib")}</SectionTitle>
          {writable && <button className="btn-amber text-xs" onClick={() => setEd({ name: "", nameAr: "", body: "", bodyAr: "", category: "FOLLOW_UP" })}>{tr("add")}</button>}
        </div>
        <p className="mt-1 text-[11px] text-ink-500" dir="ltr">{tr("au_waVarsHint")}</p>
        <ul className="mt-2 divide-y divide-paper-200">
          {(tpls || []).map((t) => (
            <li key={t.id} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-800">{lang === "ar" && t.nameAr ? t.nameAr : t.name}</span>
                <span className="kpi-num text-[11px] text-ink-500" dir="ltr">{t.uses} {tr("au_uses")}</span>
              </div>
              <div className="truncate text-[11px] text-ink-500" dir="rtl">{t.bodyAr || t.body}</div>
            </li>
          ))}
          {!tpls?.length && <p className="py-2 text-sm text-ink-500">{tr("empty")}</p>}
        </ul>
      </Card>

      <Card className="p-4">
        <SectionTitle>{tr("au_try")}</SectionTitle>
        <div className="mt-2 space-y-3">
          <Field label={tr("au_waTpl")}><Select value={tryTpl} onChange={setTryTpl} placeholder={tr("au_pickTpl")} options={(tpls || []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label={tr("nav_leads")}><Select value={tryLead} onChange={setTryLead} placeholder={tr("none")} options={(leads || []).slice(0, 100).map((l) => ({ value: l.id, label: l.company }))} /></Field>
          <button className="btn-amber" onClick={render}>{tr("au_render")}</button>
          {out && (
            <div className="rounded-xl border border-paper-200 bg-paper-50 p-3">
              <p className="whitespace-pre-wrap text-sm text-ink-800" dir="rtl">{out.textAr || out.text}</p>
              <div className="mt-2 flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => { navigator.clipboard.writeText(out.textAr || out.text); toast.push(tr("pb_copied"), "success"); }}>{tr("pb_copied")}</button>
                {out.waUrl && <a className="btn-amber text-xs" href={out.waUrl} target="_blank" rel="noreferrer">{tr("au_openWa")}</a>}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Modal open={!!ed} onClose={() => setEd(null)} title={tr("au_newTpl")}
        footer={<><button onClick={() => setEd(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {ed && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" dir="rtl" value={ed.nameAr} onChange={(e) => setEd({ ...ed, nameAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></Field>
            </div>
            <Field label={`${tr("au_body")} (AR)`}><textarea className="input" rows={3} dir="rtl" value={ed.bodyAr} onChange={(e) => setEd({ ...ed, bodyAr: e.target.value })} /></Field>
            <Field label={`${tr("au_body")} (EN)`}><textarea className="input" rows={3} dir="ltr" value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} /></Field>
            <Field label={tr("au_category")}><Select value={ed.category} onChange={(v) => setEd({ ...ed, category: v })} options={["FOLLOW_UP", "OFFER", "NPS", "EVENT", "OTHER"].map((c) => ({ value: c, label: c }))} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
export default function Automate() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const writable = can("automate", "write");
  const [tab, setTab] = useState<"wf" | "score" | "wa">("wf");
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {([["wf", tr("au_tabWf")], ["score", tr("au_tabScore")], ["wa", tr("au_tabWa")]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${tab === id ? "tab-active" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "wf" && <WorkflowsTab writable={writable} />}
      {tab === "score" && <ScoringTab writable={writable} />}
      {tab === "wa" && <WaTab writable={writable} />}
    </div>
  );
}
