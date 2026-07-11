import { useState } from "react";
import { useFetch, Card, Field, Select, Modal } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtDate } from "../lib/format";

interface Objective {
  id: string; label: string; labelAr?: string; metric: string;
  targetValue: number; manualCurrent: number; startDate?: string; endDate?: string;
  businessUnit?: string; ownerId?: string; ownerName?: string; status: string;
  current: number; progress: number; pace: string;
}
interface UserRow { id: string; name: string }

const METRICS = ["PIPELINE_USD", "WON_USD", "LEADS_COUNT", "WON_COUNT", "CONTENT_PUBLISHED", "SPEND_USD", "CUSTOM"];
const MONEY = ["PIPELINE_USD", "WON_USD", "SPEND_USD"];
const PACE_TONE: Record<string, string> = {
  achieved: "bg-moss-500/15 text-moss-600", on_track: "bg-moss-500/12 text-moss-600",
  at_risk: "bg-amber-500/15 text-amber-700", off_track: "bg-clay-500/15 text-clay-600",
};
const BAR_TONE: Record<string, string> = {
  achieved: "bg-moss-500", on_track: "bg-moss-500", at_risk: "bg-amber-500", off_track: "bg-clay-500",
};
const blank: Partial<Objective> = { label: "", metric: "PIPELINE_USD", targetValue: 0, manualCurrent: 0, businessUnit: "All" };

export default function Planning() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can("planning");
  const { data, loading, reload } = useFetch<Objective[]>("/planning/objectives");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [editing, setEditing] = useState<Partial<Objective> | null>(null);
  const [saving, setSaving] = useState(false);

  const objectives = data || [];
  const fmtVal = (metric: string, n: number) => (MONEY.includes(metric) ? fmtMoney(n, "USD", lang) : fmtNum(n, lang));
  const health = ["achieved", "on_track", "at_risk", "off_track"].map((p) => ({ pace: p, n: objectives.filter((o) => o.pace === p).length }));

  const save = async () => {
    if (!editing?.label) return;
    setSaving(true);
    try {
      const payload = {
        label: editing.label, labelAr: editing.labelAr, metric: editing.metric,
        targetValue: Number(editing.targetValue) || 0, manualCurrent: Number(editing.manualCurrent) || 0,
        startDate: editing.startDate || null, endDate: editing.endDate || null,
        businessUnit: editing.businessUnit, ownerId: editing.ownerId || null,
      };
      if (editing.id) await api.patch(`/planning/objectives/${editing.id}`, payload);
      else await api.post("/planning/objectives", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/planning/objectives/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("pl_title")}</h1>
          <p className="text-sm text-ink-500">{tr("pl_subtitle")}</p>
        </div>
        {canManage && <button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("pl_addObjective")}</button>}
      </div>

      {/* Plan health */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {health.map((h) => (
          <Card key={h.pace} className="p-4">
            <div className="kpi-num text-2xl text-ink-900">{h.n}</div>
            <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${PACE_TONE[h.pace]}`}>{tr(`pace_${h.pace}`)}</div>
          </Card>
        ))}
      </div>

      {/* Objectives */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 w-full" />)}</div>
      ) : objectives.length === 0 ? (
        <Card><p className="py-10 text-center text-sm text-ink-500">{tr("pl_noObjectives")}</p></Card>
      ) : (
        <div className="space-y-3">
          {objectives.map((o) => {
            const pct = Math.min(100, Math.round(o.progress * 100));
            return (
              <Card key={o.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">{lang === "ar" && o.labelAr ? o.labelAr : o.label}</span>
                      {o.businessUnit && <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-ink-500">{o.businessUnit}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {tr(`metric_${o.metric}`)} · {o.startDate ? fmtDate(o.startDate, lang) : "—"} → {o.endDate ? fmtDate(o.endDate, lang) : "—"}
                      {o.ownerName ? ` · ${o.ownerName}` : ""}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PACE_TONE[o.pace]}`}>{tr(`pace_${o.pace}`)}</span>
                </div>

                <div className="mt-3 flex items-end justify-between">
                  <div className="kpi-num text-lg text-ink-900">{fmtVal(o.metric, o.current)}</div>
                  <div className="text-sm text-ink-500">{tr("pl_target")}: <span className="kpi-num text-ink-700">{fmtVal(o.metric, o.targetValue)}</span></div>
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-paper-200">
                  <div className={`h-full rounded-full transition-all duration-slow ${BAR_TONE[o.pace]}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-ink-500">
                  <span className="kpi-num">{pct}%</span>
                  {canManage && (
                    <span>
                      <button onClick={() => setEditing({ ...o, startDate: o.startDate?.slice(0, 10), endDate: o.endDate?.slice(0, 10) })} className="text-steel-600 hover:underline">{tr("edit")}</button>
                      <button onClick={() => remove(o.id)} className="ms-3 text-clay-600 hover:underline">{tr("delete")}</button>
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("pl_addObjective")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("name")}><input className="input" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={`${tr("name")} (عربي)`}><input className="input" dir="rtl" value={editing.labelAr || ""} onChange={(e) => setEditing({ ...editing, labelAr: e.target.value })} /></Field></div>
            <Field label={tr("pl_metric")}><Select value={editing.metric || "PIPELINE_USD"} onChange={(v) => setEditing({ ...editing, metric: v })} options={METRICS.map((mt) => ({ value: mt, label: tr(`metric_${mt}`) }))} /></Field>
            <Field label={tr("pl_target")}><input type="number" className="input" value={editing.targetValue ?? 0} onChange={(e) => setEditing({ ...editing, targetValue: Number(e.target.value) })} /></Field>
            <Field label={tr("pl_start")}><input type="date" className="input" value={editing.startDate || ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label={tr("pl_end")}><input type="date" className="input" value={editing.endDate || ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={editing.businessUnit || ""} onChange={(e) => setEditing({ ...editing, businessUnit: e.target.value })} /></Field>
            <Field label={tr("owner")}><Select value={editing.ownerId || ""} onChange={(v) => setEditing({ ...editing, ownerId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            {editing.metric === "CUSTOM" && (
              <div className="col-span-2"><Field label={tr("pl_current")}><input type="number" className="input" value={editing.manualCurrent ?? 0} onChange={(e) => setEditing({ ...editing, manualCurrent: Number(e.target.value) })} /></Field></div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
