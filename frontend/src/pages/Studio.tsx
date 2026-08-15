import { useState } from "react";
import { Card, SectionTitle, Field, Select, Modal, StatusPill, Empty, SkeletonRows, useFetch, UploadButton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate, daysUntil } from "../lib/format";

// ── STUDIO — the creative side ───────────────────────────────────────
// Intake queue with SLA · approved copy bank · Brand Center management ·
// asset versioning with approval stamps.

interface Req { id: string; title: string; brief?: string; kind: string; priority: string; status: string;
  requesterName?: string; assigneeName?: string; assigneeId?: string; campaignId?: string; campaignName?: string;
  dueDate?: string; slaDueAt?: string; }
interface UserRow { id: string; name: string }
interface Copy { id: string; text: string; textAr?: string; kind: string; approved: boolean; productName?: string }
interface BrandAsset { id: string; kind: string; label: string; labelAr?: string; value?: string; url?: string; public: boolean; sort: number }
interface Asset { id: string; name: string }
interface Version { id: string; assetId: string; assetName?: string; version: number; url: string; note?: string; status: string; approvedByName?: string }

const NEXT: Record<string, string[]> = { NEW: ["TRIAGED"], TRIAGED: ["IN_PROGRESS"], IN_PROGRESS: ["REVIEW"], REVIEW: ["DONE", "REJECTED", "IN_PROGRESS"] };

export default function Studio() {
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const w = can("studio", "write");
  const { data: reqs, reload } = useFetch<Req[]>("/creative-requests");
  const { data: briefs, reload: reloadBr } = useFetch<{ id: string; title: string; format?: string; dueDate?: string; requestId?: string; engagementId?: string; spec?: string }[]>("/creative-briefs");
  const { data: brEngs } = useFetch<{ id: string; title: string; vendorName?: string }[]>("/engagements");
  const [brNew, setBrNew] = useState<{ title: string; requestId?: string; engagementId?: string; format: string; dueDate: string; spec: string } | null>(null);
  const [brErr, setBrErr] = useState("");
  const saveBrief = async () => {
    if (!brNew?.title) return;
    try { await api.post("/creative-briefs", brNew); setBrNew(null); setBrErr(""); reloadBr(); }
    catch (e) { setBrErr((e as Error).message); }
  };
  const { data: users } = useFetch<UserRow[]>("/users");
  const [editing, setEditing] = useState<Partial<Req> | null>(null);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!editing?.title) return;
    setErr("");
    try {
      if (editing.id) await api.patch(`/creative-requests/${editing.id}`, editing);
      else await api.post("/creative-requests", editing);
      setEditing(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const advance = async (r: Req, to: string) => { try { await api.patch(`/creative-requests/${r.id}`, { status: to }); reload(); } catch { /* matrix guard */ } };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={w && <button onClick={() => setEditing({ kind: "DESIGN", priority: "MEDIUM" })} className="btn-amber text-xs">+ {tr("st_newRequest")}</button>}>
          {tr("st_requests")}
        </SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("st_requests_sub")}</p>
        {!reqs ? <SkeletonRows rows={4} cols={5} /> : reqs.length === 0 ? <Empty text={tr("st_empty")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-start text-xs text-ink-400">
                <th className="pb-2 text-start">{tr("title")}</th><th className="pb-2 text-start">{tr("type")}</th>
                <th className="pb-2 text-start">{tr("assignee")}</th><th className="pb-2 text-start">SLA</th>
                <th className="pb-2 text-start">{tr("status")}</th><th className="pb-2" />
              </tr></thead>
              <tbody>
                {reqs.map((r) => {
                  const d = daysUntil(r.slaDueAt);
                  const late = d !== null && d < 0 && !["DONE", "REJECTED"].includes(r.status);
                  return (
                    <tr key={r.id} className="border-t border-paper-200">
                      <td className="py-2.5 pe-3">
                        <button onClick={() => w && setEditing(r)} className="text-start font-medium text-ink-800 hover:underline">{r.title}</button>
                        <div className="text-xs text-ink-400">{r.requesterName}{r.campaignName ? ` · ${r.campaignName}` : ""}</div>
                      </td>
                      <td className="py-2.5 pe-3 text-ink-600">{el(r.kind)} · <span className="text-xs">{el(r.priority)}</span></td>
                      <td className="py-2.5 pe-3 text-ink-600">{r.assigneeName || "—"}</td>
                      <td className={`py-2.5 pe-3 kpi-num text-xs ${late ? "text-clay-600" : "text-ink-500"}`}>{fmtDate(r.slaDueAt, lang)}{late ? " ⚠" : ""}</td>
                      <td className="py-2.5 pe-3"><StatusPill value={r.status} /></td>
                      <td className="py-2.5 text-end">
                        {w && (NEXT[r.status] || []).map((to) => (
                          <button key={to} onClick={() => advance(r, to)} className="ms-1 rounded-lg border border-paper-300 bg-white px-2 py-1 text-[11px] text-ink-600 hover:bg-paper-100">→ {el(to)}</button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <CopyBank canWrite={w} />
        <BrandManager canWrite={w} />
      </div>
      <Versions canWrite={w} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("st_newRequest")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label={tr("title")}><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label={tr("st_brief")}><textarea className="input min-h-20" value={editing.brief || ""} onChange={(e) => setEditing({ ...editing, brief: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("type")}>
                <Select value={editing.kind || "DESIGN"} onChange={(v) => setEditing({ ...editing, kind: v })}
                  options={["DESIGN", "VIDEO", "COPY", "PRINT", "OTHER"].map((v) => ({ value: v, label: el(v) }))} />
              </Field>
              <Field label={tr("priority")}>
                <Select value={editing.priority || "MEDIUM"} onChange={(v) => setEditing({ ...editing, priority: v })}
                  options={["LOW", "MEDIUM", "HIGH"].map((v) => ({ value: v, label: el(v) }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("assignee")}>
                <Select value={editing.assigneeId || ""} onChange={(v) => setEditing({ ...editing, assigneeId: v })}
                  placeholder={tr("none")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} />
              </Field>
              <Field label={tr("dueDate")}>
                <input type="date" className="input" value={(editing.dueDate || "").slice(0, 10)} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} />
              </Field>
            </div>
            {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
          </div>
        )}
      </Modal>

      {/* ── the briefs rail gets its door ── */}
      <Card>
        <SectionTitle action={<button onClick={() => setBrNew({ title: "", format: "", dueDate: "", spec: "" })} className="btn-ghost text-xs">+ {tr("br_new")}</button>}>
          📋 {tr("br_title")}
        </SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("br_sub")}</p>
        {brErr && <p className="mb-2 text-xs text-clay-600" dir="auto">{brErr}</p>}
        <div className="space-y-1.5">
          {(briefs || []).slice(0, 10).map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs">
              <span className="min-w-0 truncate font-medium text-ink-800">{b.title}
                {b.format && <span className="ms-2 text-[10px] text-ink-400" dir="ltr">{b.format}</span>}
              </span>
              {b.dueDate && <span className="kpi-num shrink-0 text-[11px] text-ink-400" dir="ltr">{b.dueDate.slice(0, 10)}</span>}
            </div>
          ))}
          {briefs && briefs.length === 0 && <p className="text-xs text-ink-400">{tr("br_none")}</p>}
        </div>
        {brNew && (
          <div className="mt-3 space-y-2">
            <input className="input" placeholder={tr("title")} value={brNew.title} onChange={(e) => setBrNew({ ...brNew, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={brNew.requestId || ""} onChange={(v: string) => setBrNew({ ...brNew, requestId: v || undefined, engagementId: undefined })} placeholder={tr("br_forRequest")}
                options={(reqs || []).map((r: { id: string; title: string }) => ({ value: r.id, label: r.title }))} />
              <Select value={brNew.engagementId || ""} onChange={(v: string) => setBrNew({ ...brNew, engagementId: v || undefined, requestId: undefined })} placeholder={tr("br_forEngagement")}
                options={(brEngs || []).map((e) => ({ value: e.id, label: `${e.vendorName || ""} — ${e.title}` }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" dir="ltr" placeholder="1080×1350 / 30s…" value={brNew.format} onChange={(e) => setBrNew({ ...brNew, format: e.target.value })} />
              <input type="date" className="input" value={brNew.dueDate} onChange={(e) => setBrNew({ ...brNew, dueDate: e.target.value })} />
            </div>
            <textarea className="input min-h-20 text-xs" placeholder={tr("br_specPh")} value={brNew.spec} onChange={(e) => setBrNew({ ...brNew, spec: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={saveBrief} className="btn-amber text-xs">{tr("save")}</button>
              <button onClick={() => setBrNew(null)} className="btn-ghost text-xs">{tr("cancel")}</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function CopyBank({ canWrite }: { canWrite: boolean }) {
  const { lang, tr, el } = useI18n();
  const { data, reload } = useFetch<Copy[]>("/copy-bank");
  const [editing, setEditing] = useState<Partial<Copy> | null>(null);
  const save = async () => {
    if (!editing?.text) return;
    if (editing.id) await api.patch(`/copy-bank/${editing.id}`, editing); else await api.post("/copy-bank", editing);
    setEditing(null); reload();
  };
  return (
    <Card>
      <SectionTitle action={canWrite && <button onClick={() => setEditing({ kind: "CLAIM" })} className="btn-ghost text-xs">+ {tr("add")}</button>}>{tr("st_copyBank")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("st_copyBank_sub")}</p>
      <div className="space-y-2">
        {(data || []).map((c) => (
          <button key={c.id} onClick={() => canWrite && setEditing(c)} className="block w-full rounded-lg border border-paper-200 bg-white px-3 py-2 text-start hover:bg-paper-100/60">
            <div className="text-sm text-ink-800">{lang === "ar" && c.textAr ? c.textAr : c.text}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
              <span className="pill bg-paper-200 text-ink-500">{el(c.kind)}</span>
              {c.approved && <span className="pill bg-moss-500/12 text-moss-600">✓ {tr("st_approvedCopy")}</span>}
            </div>
          </button>
        ))}
        {data && data.length === 0 && <Empty text={tr("st_copyEmpty")} />}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={tr("st_copyBank")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="AR"><input className="input" value={editing.textAr || ""} onChange={(e) => setEditing({ ...editing, textAr: e.target.value })} /></Field>
            <Field label="EN"><input className="input" dir="ltr" value={editing.text || ""} onChange={(e) => setEditing({ ...editing, text: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label={tr("type")}>
                <Select value={editing.kind || "CLAIM"} onChange={(v) => setEditing({ ...editing, kind: v })}
                  options={["CLAIM", "TAGLINE", "CTA", "DISCLAIMER"].map((v) => ({ value: v, label: el(v) }))} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm text-ink-700">
                <input type="checkbox" checked={!!editing.approved} onChange={(e) => setEditing({ ...editing, approved: e.target.checked })} /> {tr("st_approvedCopy")}
              </label>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function BrandManager({ canWrite }: { canWrite: boolean }) {
  const { lang, tr, el } = useI18n();
  const { data, reload } = useFetch<BrandAsset[]>("/brand-assets");
  const [editing, setEditing] = useState<Partial<BrandAsset> | null>(null);
  const save = async () => {
    if (!editing?.label) return;
    if (editing.id) await api.patch(`/brand-assets/${editing.id}`, editing); else await api.post("/brand-assets", editing);
    setEditing(null); reload();
  };
  return (
    <Card>
      <SectionTitle action={
        <span className="flex items-center gap-2">
          <a href="/brand" target="_blank" rel="noreferrer" className="btn-ghost text-xs">↗ {tr("st_openBrand")}</a>
          {canWrite && <button onClick={() => setEditing({ kind: "COLOR", public: true, sort: (data?.length || 0) })} className="btn-ghost text-xs">+ {tr("add")}</button>}
        </span>}>
        {tr("st_brandCenter")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("st_brand_sub")}</p>
      <div className="space-y-1.5">
        {(data || []).map((b) => (
          <button key={b.id} onClick={() => canWrite && setEditing(b)} className="flex w-full items-center gap-3 rounded-lg border border-paper-200 bg-white px-3 py-2 text-start hover:bg-paper-100/60">
            {b.kind === "COLOR" && b.value ? (
              <span className="h-6 w-6 shrink-0 rounded-full border border-paper-300" style={{ background: b.value }} />
            ) : b.kind === "LOGO" && b.url ? (
              <img src={b.url} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded border border-paper-200 bg-paper-100 object-contain" />
            ) : (
              <span className="pill bg-paper-200 text-[10px] text-ink-500">{el(b.kind)}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{lang === "ar" && b.labelAr ? b.labelAr : b.label}</span>
            {!b.public && <span className="pill bg-ink-500/10 text-[10px] text-ink-500">{tr("st_private")}</span>}
          </button>
        ))}
        {data && data.length === 0 && <Empty text={tr("st_brandEmpty")} />}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={tr("st_brandCenter")}
        footer={<>
          {editing?.id && <button onClick={async () => { await api.del(`/brand-assets/${editing.id}`); setEditing(null); reload(); }} className="btn-ghost me-auto text-clay-600">{tr("delete")}</button>}
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("type")}>
                <Select value={editing.kind || "COLOR"} onChange={(v) => setEditing({ ...editing, kind: v })}
                  options={["LOGO", "COLOR", "FONT", "TONE", "DOC"].map((v) => ({ value: v, label: el(v) }))} />
              </Field>
              <label className="flex items-center gap-2 pb-2 pt-5 text-sm text-ink-700">
                <input type="checkbox" checked={editing.public !== false} onChange={(e) => setEditing({ ...editing, public: e.target.checked })} /> {tr("st_public")}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" value={editing.labelAr || ""} onChange={(e) => setEditing({ ...editing, labelAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
            </div>
            <Field label={tr("st_value")}><input className="input" dir="ltr" placeholder="#E8A33D / tone text / font name" value={editing.value || ""} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
            <Field label="URL">
              <div className="flex items-center gap-2">
                <input className="input flex-1" dir="ltr" placeholder="https://…" value={editing.url || ""} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
                <UploadButton entity="brand" isPublic accept="*/*" onDone={(f) => setEditing({ ...editing, url: f.url })} />
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Versions({ canWrite }: { canWrite: boolean }) {
  const { tr } = useI18n();
  const { data: versions, reload } = useFetch<Version[]>("/asset-versions");
  const { data: assets } = useFetch<Asset[]>("/assets");
  const [adding, setAdding] = useState<{ assetId: string; url: string; note: string } | null>(null);
  const add = async () => {
    if (!adding?.assetId || !adding.url) return;
    await api.post("/asset-versions", adding); setAdding(null); reload();
  };
  const toReview = async (v: Version) => { await api.patch(`/asset-versions/${v.id}`, { status: "REVIEW" }); reload(); };
  const byAsset: Record<string, Version[]> = {};
  for (const v of versions || []) (byAsset[v.assetName || v.assetId] ||= []).push(v);
  return (
    <Card>
      <SectionTitle action={canWrite && (assets?.length || 0) > 0 && <button onClick={() => setAdding({ assetId: assets![0].id, url: "", note: "" })} className="btn-ghost text-xs">+ {tr("st_newVersion")}</button>}>
        {tr("st_versions")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("st_versions_sub")}</p>
      {versions && versions.length === 0 && <Empty text={tr("st_versionsEmpty")} />}
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(byAsset).map(([name, list]) => (
          <div key={name} className="rounded-lg border border-paper-200 bg-white p-3">
            <div className="mb-2 text-sm font-medium text-ink-800">{name}</div>
            <div className="space-y-1.5">
              {list.map((v) => (
                <div key={v.id} className="flex items-center gap-2 text-sm">
                  <span className="kpi-num text-xs text-ink-400">v{v.version}</span>
                  <a href={v.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-steel-600 hover:underline" dir="ltr">{v.url}</a>
                  <StatusPill value={v.status} />
                  {canWrite && v.status === "DRAFT" && <button onClick={() => toReview(v)} className="rounded-lg border border-paper-300 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-paper-100">{tr("st_sendReview")}</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={tr("st_newVersion")}
        footer={<><button onClick={() => setAdding(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={add} className="btn-amber">{tr("save")}</button></>}>
        {adding && (
          <div className="space-y-3">
            <Field label={tr("st_asset")}>
              <Select value={adding.assetId} onChange={(v) => setAdding({ ...adding, assetId: v })}
                options={(assets || []).map((a) => ({ value: a.id, label: a.name }))} />
            </Field>
            <Field label="URL">
              <div className="flex items-center gap-2">
                <input className="input flex-1" dir="ltr" placeholder="https://…" value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} />
                <UploadButton entity="asset" entityId={adding.assetId} isPublic accept="*/*" onDone={(f) => setAdding({ ...adding, url: f.url })} />
              </div>
            </Field>
            <Field label={tr("st_note")}><input className="input" value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
