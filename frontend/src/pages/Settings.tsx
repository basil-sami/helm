import { useState, useEffect } from "react";
import { Card, SectionTitle, Field, useFetch } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api, download } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";

interface Setting { orgName: string; orgNameAr: string; usdToSdgRate: number; staleLeadDays?: number; customerReviewDays?: number }

export default function Settings() {
  const { lang, tr } = useI18n();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get<Setting>("/settings").then(setSetting); }, []);

  const save = async () => {
    if (!setting) return;
    setSaving(true);
    try {
      const r = await api.patch<Setting>("/settings", setting);
      setSetting(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  if (!setting) return <div className="py-20 text-center text-ink-500">{tr("loading")}</div>;

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <SectionTitle>{tr("nav_settings")}</SectionTitle>
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{tr("set_headOnly")}</p>

        <div className="space-y-4">
          <Field label={tr("set_exchange")}>
            <input type="number" className="input" dir="ltr" value={setting.usdToSdgRate}
              onChange={(e) => setSetting({ ...setting, usdToSdgRate: Number(e.target.value) })} />
          </Field>
          <div className="rounded-lg bg-paper-100 px-3 py-2 text-sm text-ink-600">
            1 USD = <span className="kpi-num text-ink-800">{fmtMoney(setting.usdToSdgRate, "SDG", lang)}</span>
          </div>

          <Field label={tr("set_orgName")}>
            <input className="input" value={setting.orgName} onChange={(e) => setSetting({ ...setting, orgName: e.target.value })} />
          </Field>
          <Field label={tr("set_orgNameAr")}>
            <input className="input" value={setting.orgNameAr} onChange={(e) => setSetting({ ...setting, orgNameAr: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${tr("n_SWEEP_STALE_LEADS")} (${tr("date")})`}>
              <input className="input" type="number" min={1} value={setting.staleLeadDays ?? 3} onChange={(e) => setSetting({ ...setting, staleLeadDays: +e.target.value })} />
            </Field>
            <Field label={`${tr("cu_nextReview")} (${tr("date")})`}>
              <input className="input" type="number" min={7} value={setting.customerReviewDays ?? 90} onChange={(e) => setSetting({ ...setting, customerReviewDays: +e.target.value })} />
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
            {saved && <span className="text-sm text-moss-600">✓ {tr("set_saved")}</span>}
          </div>
        </div>
      </Card>

      <TemplatesManager />
      <AuditTrail />
      <SovereignBackup />
    </div>
  );
}

interface Tpl { id: string; key: string; name: string; nameAr?: string; builtin: boolean; tasks: { t: { ar: string; en: string }; offset: number; priority: string }[] }

function TemplatesManager() {
  const { lang, tr } = useI18n();
  const { data, reload } = useFetch<Tpl[]>("/templates");
  const [editing, setEditing] = useState<{ id?: string; key: string; name: string; nameAr: string; tasksJson: string } | null>(null);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!editing) return;
    let tasks;
    try { tasks = JSON.parse(editing.tasksJson); } catch { setErr("JSON?"); return; }
    try {
      if (editing.id) await api.patch(`/templates/${editing.id}`, { name: editing.name, nameAr: editing.nameAr, tasks });
      else await api.post("/templates", { key: editing.key, name: editing.name, nameAr: editing.nameAr, tasks });
      setEditing(null); setErr(""); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div><SectionTitle>{tr("tp_title")}</SectionTitle><p className="-mt-1 text-sm text-ink-500">{tr("tp_sub")}</p></div>
        <button onClick={() => setEditing({ key: "", name: "", nameAr: "", tasksJson: '[\n  {"t":{"ar":"مهمة","en":"Task"},"offset":0,"priority":"HIGH"}\n]' })} className="btn-ghost text-xs">+ {tr("tp_add")}</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(data || []).map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-ink-800">{lang === "ar" && t.nameAr ? t.nameAr : t.name}</span>
              <span className="ms-2 font-mono text-[11px] text-ink-400">{t.key} · {t.tasks.length}</span>
            </div>
            {t.builtin ? <span className="pill bg-paper-200 text-[10px] text-ink-500" title={tr("tp_locked")}>🔒</span> : (
              <div className="flex gap-2 text-xs">
                <button onClick={() => setEditing({ id: t.id, key: t.key, name: t.name, nameAr: t.nameAr || "", tasksJson: JSON.stringify(t.tasks, null, 1) })} className="text-steel-600 hover:underline">{tr("edit")}</button>
                <button onClick={async () => { if (confirm(tr("confirmDelete"))) { await api.del(`/templates/${t.id}`).catch(() => {}); reload(); } }} className="text-clay-600 hover:underline">{tr("delete")}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border border-paper-200 bg-paper-100/40 p-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="key"><input className="input font-mono" dir="ltr" disabled={!!editing.id} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></Field>
            <Field label="Name"><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="الاسم"><input className="input" value={editing.nameAr} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field>
          </div>
          <Field label={tr("tp_tasksJson")}>
            <textarea className="input h-36 font-mono text-xs" dir="ltr" value={editing.tasksJson} onChange={(e) => setEditing({ ...editing, tasksJson: e.target.value })} />
          </Field>
          {err && <p className="text-xs text-clay-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
            <button onClick={save} className="btn-amber">{tr("save")}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface AuditRow { id: string; actorName: string; action: string; entity: string; entityId?: string; createdAt: string }

function AuditTrail() {
  const { lang, tr } = useI18n();
  const { data, loading } = useFetch<AuditRow[]>("/audit?limit=60");
  return (
    <Card>
      <SectionTitle>{tr("audit_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("audit_subtitle")}</p>
      {loading ? (
        <div className="skeleton h-24" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-ink-500">{tr("audit_empty")}</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-paper-200">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-paper-200">
              {data.map((a) => (
                <tr key={a.id} className="hover:bg-paper-100/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-400">{fmtDate(a.createdAt, lang)}</td>
                  <td className="px-3 py-2 font-medium text-ink-700">{a.actorName}</td>
                  <td className="px-3 py-2"><span className="pill bg-steel-500/12 font-mono text-[11px] text-steel-600">{a.action}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SovereignBackup() {
  const { tr } = useI18n();
  const grab = () => download("/export/backup", `helm-backup-${new Date().toISOString().slice(0, 10)}.json`).catch(() => {});
  return (
    <Card>
      <SectionTitle>{tr("bk_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("bk_subtitle")}</p>
      <button onClick={grab} className="btn-ghost">⬇ {tr("bk_download")}</button>
    </Card>
  );
}
