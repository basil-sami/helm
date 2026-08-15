import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useFetch, Card, SectionTitle, StatusPill, Field, Select, Modal, Empty, Money } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { useToast } from "../components/Toast";
import ExportButton from "../components/ExportButton";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtMoney, fmtDate, toDateInput } from "../lib/format";

interface Entry {
  id: string; label: string; kind: string; channel: string;
  amountUsd: number; amountSdg: number; date?: string; campaignId?: string; campaignName?: string;
}
interface CampaignRow { id: string; name: string }

const KINDS = ["PLANNED", "SPENT"];
const CHANNELS = ["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"];
const blank: Partial<Entry> = { label: "", kind: "SPENT", channel: "PAID", amountUsd: 0, amountSdg: 0 };

export default function Budget() {
  const { lang, tr, el } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Entry[]>("/budget");
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const { data: fin } = useFetch<{
    totals: { planned: number; committed: number; actual: number };
    totalsSdg: { planned: number; committed: number; actual: number };
    sdgMeta: { currentRate: number; atEntrySharePct: number | null };
    campaigns: { id: string; name: string; nameAr?: string; planned: number; committed: number; actual: number;
                 allocated: number; overAllocated: boolean; departmentId?: string | null;
                 pct: number | null; health: string | null; departmentName?: string | null }[];
    unlinked: { committed: number; actual: number };
    byChannel: { channel: string; actual: number; actualSdg: number }[];
    byDepartment: { departmentId: string | null; departmentName: string | null;
                    planned: number; committed: number; actual: number;
                    plannedSdg: number; committedSdg: number; actualSdg: number }[];
  }>("/finance/overview");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);
  const [saving, setSaving] = useState(false);

  const entries = data || [];
  const totals = useMemo(() => {
    const spent = entries.filter((e) => e.kind === "SPENT");
    const planned = entries.filter((e) => e.kind === "PLANNED");
    const sum = (rows: Entry[], k: "amountUsd" | "amountSdg") => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const byChannel: Record<string, number> = {};
    for (const e of spent) byChannel[e.channel] = (byChannel[e.channel] || 0) + (e.amountUsd || 0);
    return {
      spentUsd: sum(spent, "amountUsd"), spentSdg: sum(spent, "amountSdg"),
      plannedUsd: sum(planned, "amountUsd"), plannedSdg: sum(planned, "amountSdg"),
      byChannel: Object.entries(byChannel).sort((a, b) => b[1] - a[1]),
    };
  }, [entries]);

  const maxCh = Math.max(1, ...totals.byChannel.map(([, v]) => v));
  const pct = totals.plannedUsd > 0 ? Math.min(100, Math.round((totals.spentUsd / totals.plannedUsd) * 100)) : 0;

  const save = async () => {
    if (!editing?.label) return;
    setSaving(true);
    try {
      const payload = {
        label: editing.label, kind: editing.kind, channel: editing.channel,
        amountUsd: editing.amountUsd, amountSdg: editing.amountSdg,
        date: editing.date, campaignId: editing.campaignId || null,
      };
      if (editing.id) await api.patch(`/budget/${editing.id}`, payload);
      else await api.post("/budget", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/budget/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };
  const removeMany = async (rows: Entry[]) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await Promise.all(rows.map((e) => api.del(`/budget/${e.id}`))); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-6">
      {/* ── W5·NERVE — the finance model: one money truth ── */}
      {fin && (
        <Card>
          <SectionTitle>🫀 {tr("fin_title")}</SectionTitle>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" dir="ltr">
            <span><b className="kpi-num text-ink-900">{fmtMoney(fin.totals.planned, "USD", lang)}</b> <span className="text-xs text-ink-500">{tr("fin_planned")}</span></span>
            <span><b className="kpi-num text-amber-700">{fmtMoney(fin.totals.committed, "USD", lang)}</b> <span className="text-xs text-ink-500">{tr("fin_committed")}</span></span>
            <span><b className="kpi-num text-ink-900">{fmtMoney(fin.totals.actual, "USD", lang)}</b> <span className="text-xs text-ink-500">{tr("fin_actual")}</span></span>
          </div>
          {fin.sdgMeta.currentRate > 0 && (
            <p className="-mt-2 mb-3 text-[11px] text-ink-500" dir="auto">
              {tr("fin_sdgMirror")}: <span className="kpi-num" dir="ltr">{fmtMoney(fin.totalsSdg.actual, "SDG", lang)}</span> {tr("fin_actual")} · <span className="kpi-num" dir="ltr">{fmtMoney(fin.totalsSdg.committed, "SDG", lang)}</span> {tr("fin_committed")}
              {fin.sdgMeta.atEntrySharePct != null && (
                <span> — <span className="kpi-num" dir="ltr">{fin.sdgMeta.atEntrySharePct}%</span> {tr("fin_atEntry")}</span>
              )}
            </p>
          )}
          {fin.byChannel.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] font-medium text-ink-500">{tr("fin_byChannel")}:</span>
              {fin.byChannel.slice(0, 7).map((ch) => (
                <span key={ch.channel} className="rounded-full bg-paper-100 px-2.5 py-1 text-[11px] text-ink-700" dir="ltr">
                  {ch.channel} <b className="kpi-num">${ch.actual.toLocaleString()}</b>
                </span>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {fin.campaigns.filter((c) => (c.planned > 0 || c.actual > 0 || c.committed > 0)
              && (!deptFilter || c.departmentId === (deptFilter === "__none" ? null : deptFilter))).map((c) => {
              const load = c.planned > 0 ? Math.min(150, ((c.actual + c.committed) / c.planned) * 100) : 0;
              const aPct = c.planned > 0 ? Math.min(100, (c.actual / c.planned) * 100) : 0;
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <Link to={`/campaigns?room=${c.id}`} className="truncate font-medium text-ink-800 hover:underline">{lang === "ar" && c.nameAr ? c.nameAr : c.name}</Link>
                      {c.allocated > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${c.overAllocated ? "bg-clay-500/15 font-bold text-clay-700" : "bg-paper-200 text-ink-500"}`} dir="ltr">
                          {tr("fin_allocated")} ${c.allocated.toLocaleString()}{c.overAllocated ? ` — ${tr("fin_overAlloc")}` : ""}
                        </span>
                      )}
                      {c.health && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                          c.health === "OVER" ? "bg-clay-500/15 text-clay-700"
                          : c.health === "WATCH" ? "bg-amber-500/15 text-amber-700"
                          : "bg-moss-500/12 text-moss-700"}`}>
                          {tr(`fin_h_${c.health}`)}{c.pct != null ? ` ${c.pct}%` : ""}
                        </span>
                      )}
                    </span>
                    <span className="kpi-num shrink-0 text-[11px] text-ink-500" dir="ltr">
                      {fmtMoney(c.actual, "USD", lang)} + {fmtMoney(c.committed, "USD", lang)} / {fmtMoney(c.planned, "USD", lang)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-200" dir="ltr">
                    <div className="flex h-full">
                      <div className="bg-ink-800" style={{ width: `${aPct}%` }} />
                      <div className="bg-amber-500/70" style={{ width: `${Math.max(0, load - aPct)}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {fin.byDepartment.filter((d) => d.planned > 0 || d.actual > 0 || d.committed > 0).length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-medium text-ink-500">{tr("fin_byDept")}</div>
              <div className="space-y-1">
                {fin.byDepartment.filter((d) => d.planned > 0 || d.actual > 0 || d.committed > 0).map((d) => (
                  <button key={d.departmentId || "none"} onClick={() => setDeptFilter(
                      deptFilter === (d.departmentId || "__none") ? null : (d.departmentId || "__none"))}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-start text-xs ${deptFilter === (d.departmentId || "__none") ? "bg-amber-500/10" : "hover:bg-paper-100"}`}>
                    <span className="truncate text-ink-700">{deptFilter === (d.departmentId || "__none") ? "✓ " : ""}{d.departmentName || tr("fin_noDept")}</span>
                    <span className="kpi-num shrink-0 text-[11px] text-ink-500" dir="ltr">
                      {fmtMoney(d.actual, "USD", lang)} + {fmtMoney(d.committed, "USD", lang)} / {fmtMoney(d.planned, "USD", lang)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(fin.unlinked.actual > 0 || fin.unlinked.committed > 0) && (
            <p className="mt-3 rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11px] text-ink-600" dir="auto">
              ⚠ {tr("fin_unlinked")}: <span className="kpi-num" dir="ltr">{fmtMoney(fin.unlinked.actual, "USD", lang)}</span> {tr("fin_actual")} · <span className="kpi-num" dir="ltr">{fmtMoney(fin.unlinked.committed, "USD", lang)}</span> {tr("fin_committed")} — {tr("fin_unlinkedHint")}
            </p>
          )}
        </Card>
      )}

      {/* Summary */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle>{tr("dash_spend")}</SectionTitle>
          <div className="flex items-end justify-between">
            <div><div className="kpi-num text-2xl text-ink-900">{fmtMoney(totals.spentUsd, "USD", lang)}</div><div className="text-xs text-ink-500">{tr("dash_spentLabel")}</div></div>
            <div className="text-end"><div className="kpi-num text-lg text-ink-600">{fmtMoney(totals.plannedUsd, "USD", lang)}</div><div className="text-xs text-ink-500">{tr("dash_plannedLabel")}</div></div>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-paper-200"><div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 text-xs text-ink-500">{pct}% {lang === "ar" ? "من المخطط" : "of plan"}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-paper-200 pt-3 text-xs">
            <div><div className="text-ink-500">{tr("dash_spentLabel")} (SDG)</div><div className="kpi-num text-ink-700">{fmtMoney(totals.spentSdg, "SDG", lang)}</div></div>
            <div><div className="text-ink-500">{tr("dash_plannedLabel")} (SDG)</div><div className="kpi-num text-ink-700">{fmtMoney(totals.plannedSdg, "SDG", lang)}</div></div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>{tr("dash_byChannel")}</SectionTitle>
          {totals.byChannel.length === 0 ? <Empty text={tr("noData")} /> : (
            <div className="space-y-2.5">
              {totals.byChannel.map(([ch, v]) => (
                <div key={ch} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-ink-600">{el(ch)}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-paper-200">
                    <div className="flex h-full items-center justify-end rounded bg-ink-800 px-2" style={{ width: `${Math.max(8, (v / maxCh) * 100)}%` }}>
                      <span className="kpi-num text-[11px] text-paper">{fmtMoney(v, "USD", lang)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Entries table */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-700">{tr("nav_budget")}</h2>
        <div className="flex items-center gap-2"><ExportButton resource="budget" /><button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button></div>
      </div>
      <DataTable<Entry>
        rows={entries}
        loading={loading}
        rowKey={(e) => e.id}
        bulkActions={[{ label: tr("deleteSelected"), tone: "danger", onRun: removeMany }]}
        columns={[
          { key: "label", header: tr("label"), sortValue: (e) => e.label, render: (e) => <span className="font-medium text-ink-800">{e.label}</span> },
          { key: "kind", header: tr("kind"), sortValue: (e) => e.kind, render: (e) => <StatusPill value={e.kind} /> },
          { key: "channel", header: tr("channel"), sortValue: (e) => e.channel, render: (e) => <span className="text-ink-600">{el(e.channel)}</span> },
          { key: "campaignName", header: tr("campaign"), sortValue: (e) => e.campaignName || "", render: (e) => <span className="text-ink-600">{e.campaignName || "—"}</span> },
          { key: "amountUsd", header: tr("amount"), numeric: true, sortValue: (e) => e.amountUsd, render: (e) => <Money usd={e.amountUsd} sdg={e.amountSdg} /> },
          { key: "date", header: tr("date"), sortValue: (e) => e.date || "", render: (e) => <span className="text-ink-600">{fmtDate(e.date, lang)}</span> },
        ]}
        rowActions={(e) => (
          <>
            <button onClick={() => setEditing({ ...e, date: toDateInput(e.date) })} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
            <button onClick={() => remove(e.id)} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>
          </>
        )}
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("label")}><input className="input" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field></div>
            <Field label={tr("kind")}><Select value={editing.kind || "SPENT"} onChange={(v) => setEditing({ ...editing, kind: v })} options={KINDS.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("channel")}><Select value={editing.channel || "PAID"} onChange={(v) => setEditing({ ...editing, channel: v })} options={CHANNELS.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={`${tr("amount")} (USD)`}><input type="number" className="input" value={editing.amountUsd ?? 0} onChange={(e) => setEditing({ ...editing, amountUsd: Number(e.target.value) })} /></Field>
            <Field label={`${tr("amount")} (SDG)`}><input type="number" className="input" value={editing.amountSdg ?? 0} onChange={(e) => setEditing({ ...editing, amountSdg: Number(e.target.value) })} /></Field>
            <Field label={tr("date")}><input type="date" className="input" value={editing.date || ""} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></Field>
            <Field label={tr("campaign")}><Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
