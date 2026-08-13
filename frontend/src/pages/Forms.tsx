import { useState } from "react";
import { Card, SectionTitle, Field, Select, Modal, Empty, SkeletonRows, useFetch } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ── FORMS — the capture layer, generalized ───────────────────────────
// Many forms per campaign, each with its own conversion stats,
// public at /f/:slug.

interface FieldDef { key: string; label: string; labelAr?: string; type: string; required?: boolean; options?: string[] }
interface Form { id: string; name: string; slug: string; campaignId?: string; campaignName?: string;
  fields: FieldDef[] | string; successMsg?: string; successMsgAr?: string; active: boolean;
  submissionCount: number; leadCount: number }
interface Campaign { id: string; name: string }
interface Submission { id: string; data: Record<string, string> | string; leadCompany?: string; contactName?: string; src?: string; createdAt: string }

const TYPES = ["text", "phone", "email", "select", "textarea"];
const parseFields = (v: FieldDef[] | string): FieldDef[] => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch { return []; } })();

export default function Forms() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const w = can("automate", "write");
  const { data: forms, reload } = useFetch<Form[]>("/forms");
  const { data: campaigns } = useFetch<Campaign[]>("/campaigns");
  const [editing, setEditing] = useState<(Partial<Form> & { fieldsArr?: FieldDef[] }) | null>(null);
  const [viewing, setViewing] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  const openEdit = (f?: Form) => setEditing(f
    ? { ...f, fieldsArr: parseFields(f.fields) }
    : { active: true, fieldsArr: [
        { key: "name", label: "Your name", labelAr: "الاسم", type: "text", required: true },
        { key: "phone", label: "Phone (WhatsApp)", labelAr: "الهاتف (واتساب)", type: "phone", required: true },
      ] });
  const save = async () => {
    if (!editing?.name || !editing.fieldsArr?.length) return;
    setErr("");
    const payload = { ...editing, fields: editing.fieldsArr };
    delete (payload as Record<string, unknown>).fieldsArr;
    try {
      if (editing.id) await api.patch(`/forms/${editing.id}`, payload);
      else await api.post("/forms", payload);
      setEditing(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const copyLink = async (f: Form) => {
    const url = `${window.location.origin}/f/${f.slug}`;
    try { await navigator.clipboard.writeText(url); } catch { /* optional */ }
    setCopied(f.id); setTimeout(() => setCopied(""), 1500);
  };
  const setF = (i: number, patch: Partial<FieldDef>) => {
    const arr = [...(editing?.fieldsArr || [])]; arr[i] = { ...arr[i], ...patch };
    setEditing({ ...editing!, fieldsArr: arr });
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={w && <button onClick={() => openEdit()} className="btn-amber text-xs">+ {tr("fm_new")}</button>}>
          {tr("fm_title")}
        </SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("fm_sub")}</p>
        {!forms ? <SkeletonRows rows={3} cols={4} /> : forms.length === 0 ? <Empty text={tr("fm_empty")} /> : (
          <div className="grid gap-2 md:grid-cols-2">
            {forms.map((f) => (
              <div key={f.id} className="rounded-xl border border-paper-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => w && openEdit(f)} className="text-start font-medium text-ink-800 hover:underline">{f.name}</button>
                  {!f.active && <span className="pill bg-ink-500/10 text-[10px] text-ink-500">{tr("inactive")}</span>}
                </div>
                <div className="mt-0.5 text-xs text-ink-400" dir="ltr">/f/{f.slug}{f.campaignName ? ` · ${f.campaignName}` : ""}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="kpi-num text-ink-700">{f.submissionCount} <span className="text-ink-400">{tr("fm_submissions")}</span></span>
                  <span className="kpi-num text-moss-600">{f.leadCount} <span className="text-ink-400">{tr("fm_leads")}</span></span>
                  <span className="ms-auto flex gap-2">
                    <button onClick={() => setViewing(f)} className="text-steel-600 hover:underline">{tr("fm_view")}</button>
                    <button onClick={() => copyLink(f)} className="text-steel-600 hover:underline">{copied === f.id ? `✓ ${tr("ag_copied")}` : tr("fm_copyLink")}</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Builder */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("fm_new")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("name")}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Slug"><input className="input" dir="ltr" placeholder={tr("fm_slugAuto")} value={editing.slug || ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></Field>
            </div>
            <Field label={tr("campaign")}>
              <Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v || undefined })} placeholder="—"
                options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">{tr("fm_fields")}</span>
                <button onClick={() => setEditing({ ...editing, fieldsArr: [...(editing.fieldsArr || []), { key: `q${(editing.fieldsArr?.length || 0) + 1}`, label: "", type: "text" }] })}
                  className="btn-ghost text-xs">+ {tr("add")}</button>
              </div>
              <div className="space-y-2">
                {(editing.fieldsArr || []).map((fd, i) => (
                  <div key={i} className="rounded-lg border border-paper-200 bg-paper-100/50 p-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <input className="input" dir="ltr" placeholder="key" value={fd.key} onChange={(e) => setF(i, { key: e.target.value })} />
                      <Select value={fd.type} onChange={(v) => setF(i, { type: v })} options={TYPES.map((t) => ({ value: t, label: t }))} />
                      <label className="flex items-center justify-between gap-1 text-xs text-ink-600">
                        <span className="flex items-center gap-1"><input type="checkbox" checked={!!fd.required} onChange={(e) => setF(i, { required: e.target.checked })} /> {tr("fm_required")}</span>
                        <button onClick={() => setEditing({ ...editing, fieldsArr: editing.fieldsArr!.filter((_, j) => j !== i) })} className="text-clay-600">✕</button>
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input className="input" placeholder="Label (AR)" value={fd.labelAr || ""} onChange={(e) => setF(i, { labelAr: e.target.value })} />
                      <input className="input" dir="ltr" placeholder="Label (EN)" value={fd.label} onChange={(e) => setF(i, { label: e.target.value })} />
                    </div>
                    {fd.type === "select" && (
                      <input className="mt-2 input" dir="ltr" placeholder={tr("fm_optionsPh")} value={(fd.options || []).join(", ")}
                        onChange={(e) => setF(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("fm_success")} (AR)`}><input className="input" value={editing.successMsgAr || ""} onChange={(e) => setEditing({ ...editing, successMsgAr: e.target.value })} /></Field>
              <Field label={`${tr("fm_success")} (EN)`}><input className="input" dir="ltr" value={editing.successMsg || ""} onChange={(e) => setEditing({ ...editing, successMsg: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> {tr("active")}
            </label>
            {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
          </div>
        )}
      </Modal>

      {/* Submissions drawer */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name || ""}>
        {viewing && <Submissions form={viewing} />}
      </Modal>
    </div>
  );
}

function Submissions({ form }: { form: Form }) {
  const { lang, tr } = useI18n();
  const { data } = useFetch<Submission[]>(`/forms/${form.id}/submissions`, [form.id]);
  return (
    <div className="space-y-2">
      {(data || []).map((s) => {
        const d: Record<string, string> = typeof s.data === "string" ? JSON.parse(s.data || "{}") : s.data;
        return (
          <div key={s.id} className="rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
            <div className="flex items-center justify-between text-xs text-ink-400">
              <span>{fmtDate(s.createdAt, lang)}{s.src ? ` · src: ${s.src}` : ""}</span>
              {s.leadCompany && <span className="pill bg-moss-500/12 text-[10px] text-moss-600">→ {tr("fm_lead")}</span>}
            </div>
            <div className="mt-1 text-ink-700">{Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
          </div>
        );
      })}
      {data && data.length === 0 && <Empty text={tr("fm_noSubs")} />}
    </div>
  );
}
