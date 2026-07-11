import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle, Empty } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";

interface Segment { id: string; name: string; nameAr?: string; businessUnit?: string; kind: string; sizeEstimate?: string; notes?: string }
interface Persona { id: string; segmentId: string; name: string; nameAr?: string; goals?: string; pains?: string; message?: string; messageAr?: string; objections?: string; segmentName?: string; segmentNameAr?: string }
const KINDS = ["B2B_DISTRIBUTOR", "B2B_ENTERPRISE", "GOV_TENDER", "CONSUMER", "NGO", "OTHER"];

export default function Audience() {
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data: segments, reload: reloadS } = useFetch<Segment[]>("/segments");
  const { data: personas, reload: reloadP } = useFetch<Persona[]>("/personas");
  const [seg, setSeg] = useState<Partial<Segment> | null>(null);
  const [per, setPer] = useState<Partial<Persona> | null>(null);
  const [saving, setSaving] = useState(false);
  const nameOf = (x: { name: string; nameAr?: string }) => (lang === "ar" && x.nameAr ? x.nameAr : x.name);

  const saveSeg = async () => {
    if (!seg?.name) return;
    setSaving(true);
    try { seg.id ? await api.patch(`/segments/${seg.id}`, seg) : await api.post("/segments", seg); setSeg(null); reloadS(); }
    catch { toast.push(tr("saveError"), "error"); } finally { setSaving(false); }
  };
  const savePer = async () => {
    if (!per?.name || !per?.segmentId) return;
    setSaving(true);
    try { per.id ? await api.patch(`/personas/${per.id}`, per) : await api.post("/personas", per); setPer(null); reloadP(); }
    catch { toast.push(tr("saveError"), "error"); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("au_title")}</h1>
          <p className="text-sm text-ink-500">{tr("au_sub")}</p>
        </div>
        {can("campaigns") && (
          <div className="flex gap-2">
            <button onClick={() => setSeg({ name: "", kind: "B2B_DISTRIBUTOR" })} className="btn-ghost">+ {tr("au_addSegment")}</button>
            <button onClick={() => setPer({ name: "", segmentId: segments?.[0]?.id })} className="btn-amber">+ {tr("au_addPersona")}</button>
          </div>
        )}
      </div>

      {!segments?.length ? <Card><Empty text={tr("noData")} /></Card> : segments.map((s) => (
        <Card key={s.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <SectionTitle>{nameOf(s)}</SectionTitle>
              <div className="-mt-1 flex items-center gap-2 text-xs text-ink-500">
                <span className="pill bg-steel-500/12 text-steel-600">{tr(s.kind)}</span>
                {s.businessUnit && <span>{s.businessUnit}</span>}
                {s.sizeEstimate && <span>· {s.sizeEstimate}</span>}
              </div>
            </div>
            {can("campaigns") && <button onClick={() => setSeg(s)} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(personas || []).filter((p) => p.segmentId === s.id).map((p) => (
              <button key={p.id} onClick={() => can("campaigns") && setPer(p)}
                className="rounded-xl border border-paper-200 bg-paper-100/40 p-3 text-start transition hover:border-amber-500/40">
                <div className="font-medium text-ink-800">👤 {nameOf(p)}</div>
                {p.pains && <div className="mt-1 line-clamp-2 text-xs text-ink-500">⚠ {p.pains}</div>}
                {(lang === "ar" ? p.messageAr || p.message : p.message) && (
                  <div className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    “{lang === "ar" ? p.messageAr || p.message : p.message}”
                  </div>
                )}
              </button>
            ))}
          </div>
        </Card>
      ))}

      <Modal open={!!seg} onClose={() => setSeg(null)} title={seg?.id ? tr("edit") : tr("au_addSegment")}
        footer={<><button onClick={() => setSeg(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveSeg} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {seg && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (EN)"><input className="input" value={seg.name || ""} onChange={(e) => setSeg({ ...seg, name: e.target.value })} /></Field>
            <Field label="الاسم (AR)"><input className="input" value={seg.nameAr || ""} onChange={(e) => setSeg({ ...seg, nameAr: e.target.value })} /></Field>
            <Field label={tr("au_kind")}><Select value={seg.kind || "OTHER"} onChange={(v) => setSeg({ ...seg, kind: v })} options={KINDS.map((k) => ({ value: k, label: tr(k) || k }))} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={seg.businessUnit || ""} onChange={(e) => setSeg({ ...seg, businessUnit: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={tr("au_size")}><input className="input" value={seg.sizeEstimate || ""} onChange={(e) => setSeg({ ...seg, sizeEstimate: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>

      <Modal open={!!per} onClose={() => setPer(null)} title={per?.id ? tr("edit") : tr("au_addPersona")}
        footer={<><button onClick={() => setPer(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={savePer} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {per && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("au_segment")}>
              <Select value={per.segmentId || ""} onChange={(v) => setPer({ ...per, segmentId: v })}
                options={(segments || []).map((s) => ({ value: s.id, label: nameOf(s) }))} />
            </Field></div>
            <Field label="Persona (EN)"><input className="input" value={per.name || ""} onChange={(e) => setPer({ ...per, name: e.target.value })} /></Field>
            <Field label="الشخصية (AR)"><input className="input" value={per.nameAr || ""} onChange={(e) => setPer({ ...per, nameAr: e.target.value })} /></Field>
            <Field label={tr("au_goals")}><input className="input" value={per.goals || ""} onChange={(e) => setPer({ ...per, goals: e.target.value })} /></Field>
            <Field label={tr("au_pains")}><input className="input" value={per.pains || ""} onChange={(e) => setPer({ ...per, pains: e.target.value })} /></Field>
            <Field label={`${tr("au_message")} (EN)`}><input className="input" value={per.message || ""} onChange={(e) => setPer({ ...per, message: e.target.value })} /></Field>
            <Field label={`${tr("au_message")} (AR)`}><input className="input" value={per.messageAr || ""} onChange={(e) => setPer({ ...per, messageAr: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={tr("au_objections")}><input className="input" value={per.objections || ""} onChange={(e) => setPer({ ...per, objections: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
