import { useState } from "react";
import { useFetch, StatusPill, Field, Select, Modal, Money } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import ExportButton from "../components/ExportButton";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { useEffect } from "react";
import { fmtMoney } from "../lib/format";
import { fmtDate, toDateInput } from "../lib/format";

interface Campaign {
  id: string; name: string; nameAr?: string; objective?: string;
  status: string; channel: string; startDate?: string; endDate?: string;
  budgetUsd: number; budgetSdg: number; businessUnit?: string;
  ownerId?: string; ownerName?: string; leadCount?: number;
}
interface UserRow { id: string; name: string; role: string }

const STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"];
const CHANNELS = ["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"];
const blank: Partial<Campaign> = { name: "", status: "PLANNING", channel: "SOCIAL", budgetUsd: 0, budgetSdg: 0 };

interface Brief { objective?: string; personaId?: string; productId?: string; keyMessage?: string; keyMessageAr?: string; kpiMetric?: string; kpiTarget?: number; learnings?: string }
interface Roi { spentUsd: number; plannedUsd: number; pipelineUsd: number; wonUsd: number; wonCount: number; leads: number; romiPct: number | null; cplUsd: number | null; links: number; clicks: number; posts: number; avgEr: number }

function BriefPanel({ campaignId }: { campaignId: string }) {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [brief, setBrief] = useState<Brief>({});
  const [roi, setRoi] = useState<Roi | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: personasList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/personas");
  const { data: productsList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/products");
  useEffect(() => {
    api.get<Brief | null>(`/briefs/${campaignId}`).then((b) => setBrief(b || {})).catch(() => {});
    api.get<Roi>(`/analytics/campaign/${campaignId}`).then(setRoi).catch(() => {});
  }, [campaignId]);

  const saveBrief = async () => {
    setBusy(true);
    try { await api.post(`/briefs/${campaignId}`, brief); toast.push(tr("bf_saved"), "success"); }
    catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };
  const nm = (x: { name: string; nameAr?: string }) => (lang === "ar" && x.nameAr ? x.nameAr : x.name);

  return (
    <div className="space-y-3">
      {roi && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-paper-200 bg-paper-100/40 p-3 text-center sm:grid-cols-6">
          {[
            [tr("an_spend"), fmtMoney(roi.spentUsd, "USD", lang)],
            [tr("an_pipeline"), fmtMoney(roi.pipelineUsd, "USD", lang)],
            [tr("an_won"), fmtMoney(roi.wonUsd, "USD", lang)],
            ["ROMI", roi.romiPct != null ? `${roi.romiPct}%` : "—"],
            [tr("bf_clicks"), String(roi.clicks)],
            [`${tr("bf_posts")} ER`, `${roi.avgEr}%`],
          ].map(([l, v]) => (
            <div key={l as string}><div className="text-[10px] uppercase tracking-wide text-ink-500">{l}</div>
              <div className="kpi-num text-sm text-ink-800">{v}</div></div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-amber-500/25 bg-amber-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-800">📋 {tr("bf_title")}</span>
          <span className="text-[11px] text-amber-700">{tr("bf_hint")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Field label={tr("bf_objective")}><input className="input" value={brief.objective || ""} onChange={(e) => setBrief({ ...brief, objective: e.target.value })} /></Field></div>
          <Field label={tr("au_persona")}><Select value={brief.personaId || ""} onChange={(v) => setBrief({ ...brief, personaId: v })} placeholder={tr("none")} options={(personasList || []).map((x) => ({ value: x.id, label: nm(x) }))} /></Field>
          <Field label={tr("product")}><Select value={brief.productId || ""} onChange={(v) => setBrief({ ...brief, productId: v })} placeholder={tr("none")} options={(productsList || []).map((x) => ({ value: x.id, label: nm(x) }))} /></Field>
          <Field label={`${tr("au_message")} (AR)`}><input className="input" value={brief.keyMessageAr || ""} onChange={(e) => setBrief({ ...brief, keyMessageAr: e.target.value })} /></Field>
          <Field label={`${tr("au_message")} (EN)`}><input className="input" value={brief.keyMessage || ""} onChange={(e) => setBrief({ ...brief, keyMessage: e.target.value })} /></Field>
          <Field label={tr("bf_kpi")}><input className="input" placeholder="LEADS / WON_USD / ER%" value={brief.kpiMetric || ""} onChange={(e) => setBrief({ ...brief, kpiMetric: e.target.value })} /></Field>
          <Field label={tr("bf_kpiTarget")}><input className="input" type="number" value={brief.kpiTarget ?? ""} onChange={(e) => setBrief({ ...brief, kpiTarget: e.target.value === "" ? undefined : +e.target.value })} /></Field>
          <div className="col-span-2"><Field label={tr("bf_learnings")}><textarea className="input" rows={2} value={brief.learnings || ""} onChange={(e) => setBrief({ ...brief, learnings: e.target.value })} /></Field></div>
        </div>
        {can("campaigns") && <button onClick={saveBrief} disabled={busy} className="btn-amber mt-2 w-full">{tr("save")} — {tr("bf_title")}</button>}
      </div>
    </div>
  );
}

export default function Campaigns() {
  const { lang, tr, el } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Campaign[]>("/campaigns");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [saving, setSaving] = useState(false);

  const list = (data || []).filter((c) => !filter || c.status === filter);

  const save = async () => {
    if (!editing?.name) return;
    setSaving(true);
    try {
      const payload = {
        name: editing.name, nameAr: editing.nameAr, objective: editing.objective,
        status: editing.status, channel: editing.channel,
        startDate: editing.startDate, endDate: editing.endDate,
        budgetUsd: editing.budgetUsd, budgetSdg: editing.budgetSdg,
        businessUnit: editing.businessUnit, ownerId: editing.ownerId || null,
      };
      if (editing.id) await api.patch(`/campaigns/${editing.id}`, payload);
      else await api.post("/campaigns", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/campaigns/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  const removeMany = async (rows: Campaign[]) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await Promise.all(rows.map((c) => api.del(`/campaigns/${c.id}`))); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setFilter("")} className={`pill ${!filter ? "bg-ink-900 text-paper" : "bg-paper-200 text-ink-600"}`}>{tr("all")}</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`pill ${filter === s ? "bg-ink-900 text-paper" : "bg-paper-200 text-ink-600"}`}>{el(s)}</button>
          ))}
        </div>
        <div className="flex items-center gap-2"><ExportButton resource="campaigns" /><button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button></div>
      </div>

      <DataTable<Campaign>
        rows={list}
        loading={loading}
        rowKey={(c) => c.id}
        initialSort={{ key: "name", dir: "asc" }}
        bulkActions={[{ label: tr("deleteSelected"), tone: "danger", onRun: removeMany }]}
        columns={[
          {
            key: "name", header: tr("name"),
            sortValue: (c) => (lang === "ar" && c.nameAr ? c.nameAr : c.name),
            render: (c) => (
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-800">{lang === "ar" && c.nameAr ? c.nameAr : c.name}</span>
                  {!!c.leadCount && (
                    <span className="rounded-full bg-steel-500/12 px-2 py-0.5 text-[11px] text-steel-600">{c.leadCount} {tr("camp_leads")}</span>
                  )}
                </div>
                <div className="text-xs text-ink-500">{c.businessUnit} · {fmtDate(c.startDate, lang)} → {fmtDate(c.endDate, lang)}</div>
              </div>
            ),
          },
          { key: "status", header: tr("status"), sortValue: (c) => c.status, render: (c) => <StatusPill value={c.status} /> },
          { key: "channel", header: tr("channel"), sortValue: (c) => c.channel, render: (c) => <span className="text-ink-600">{el(c.channel)}</span> },
          { key: "ownerName", header: tr("owner"), sortValue: (c) => c.ownerName || "", render: (c) => <span className="text-ink-600">{c.ownerName || tr("unassigned")}</span> },
          { key: "budgetUsd", header: tr("budget"), numeric: true, sortValue: (c) => c.budgetUsd, render: (c) => <Money usd={c.budgetUsd} sdg={c.budgetSdg} /> },
        ]}
        rowActions={(c) => (
          <>
            <button onClick={() => setEditing({ ...c, startDate: toDateInput(c.startDate), endDate: toDateInput(c.endDate) })} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
            <button onClick={() => remove(c.id)} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>
          </>
        )}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={`${tr("name")} (EN)`}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={`${tr("name")} (AR)`}><input className="input" value={editing.nameAr || ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={tr("objective")}><input className="input" value={editing.objective || ""} onChange={(e) => setEditing({ ...editing, objective: e.target.value })} /></Field></div>
            <Field label={tr("status")}><Select value={editing.status || "PLANNING"} onChange={(v) => setEditing({ ...editing, status: v })} options={STATUSES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("channel")}><Select value={editing.channel || "SOCIAL"} onChange={(v) => setEditing({ ...editing, channel: v })} options={CHANNELS.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("startDate")}><input type="date" className="input" value={editing.startDate || ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label={tr("endDate")}><input type="date" className="input" value={editing.endDate || ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} /></Field>
            <Field label={`${tr("budget")} (USD)`}><input type="number" className="input" value={editing.budgetUsd ?? 0} onChange={(e) => setEditing({ ...editing, budgetUsd: Number(e.target.value) })} /></Field>
            <Field label={`${tr("budget")} (SDG)`}><input type="number" className="input" value={editing.budgetSdg ?? 0} onChange={(e) => setEditing({ ...editing, budgetSdg: Number(e.target.value) })} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={editing.businessUnit || ""} onChange={(e) => setEditing({ ...editing, businessUnit: e.target.value })} /></Field>
            <Field label={tr("owner")}><Select value={editing.ownerId || ""} onChange={(v) => setEditing({ ...editing, ownerId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            {editing.id && <div className="col-span-2"><BriefPanel campaignId={editing.id} /></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
