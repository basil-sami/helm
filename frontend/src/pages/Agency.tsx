import { useState } from "react";
import { Card, SectionTitle, Field, Select, Modal, StatusPill, Empty, SkeletonRows, Money, useFetch } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate, daysUntil } from "../lib/format";

// ── AGENCY — external vendor management ──────────────────────────────
// Registry + scorecards · engagements · deliverables (revision rounds
// become data) · invoices→budget bridge · magic-link portal tokens.

interface Vendor { id: string; name: string; kind: string; phone?: string; email?: string; notes?: string; active: boolean }
interface Engagement { id: string; vendorId: string; vendorName?: string; title: string; scope?: string; feeUsd: number; startDate?: string; endDate?: string; status: string; ownerName?: string }
interface Deliv { id: string; engagementId: string; engagementTitle?: string; vendorName?: string; title: string; briefTitle?: string; dueDate?: string; status: string; revisionCount: number; submittedUrl?: string; submittedAt?: string }
interface Invoice { id: string; vendorId: string; vendorName?: string; engagementTitle?: string; number: string; amountUsd: number; rateAtEntry?: number; status: string; paidAt?: string }
interface Approval { id: string; entity: string; entityId: string; status: string }
interface Token { id: string; vendorId: string; vendorName?: string; token: string; expiresAt: string; revoked: boolean; lastUsedAt?: string }
interface Scorecard { deliverables: { total: number; approved: number; open: number; onTimeRate: number | null; avgRevisions: number; approvalRate: number | null }; spend: { approvedUsd: number; invoices: number }; engagements: { total: number; active: number } }
interface Comment { id: string; author: string; authorName: string; body: string; createdAt: string }

const DNEXT: Record<string, string[]> = { BRIEFED: ["IN_PROGRESS"], IN_PROGRESS: ["SUBMITTED"], SUBMITTED: ["IN_REVIEW"], REVISION: ["IN_PROGRESS"] };

export default function Agency() {
  const { can } = useAuth();
  const w = can("agency", "write");
  const { data: vendors, reload: reloadV } = useFetch<Vendor[]>("/vendors");
  const { data: engagements, reload: reloadE } = useFetch<Engagement[]>("/engagements");
  const { data: delivs, reload: reloadD } = useFetch<Deliv[]>("/deliverables");
  const { data: invoices, reload: reloadI } = useFetch<Invoice[]>("/invoices");
  const { data: approvals, reload: reloadA } = useFetch<Approval[]>("/approvals?status=PENDING");
  const reloadAll = () => { reloadV(); reloadE(); reloadD(); reloadI(); reloadA(); };
  const pendingFor = (entity: string, id: string) => (approvals || []).find((a) => a.entity === entity && a.entityId === id);
  const decide = async (apId: string, status: "APPROVED" | "REJECTED", note?: string) => {
    await api.post(`/approvals/${apId}/decide`, { status, note });
    reloadAll();
  };

  return (
    <div className="space-y-4">
      <Vendors vendors={vendors} engagements={engagements} canWrite={w} reload={reloadAll} />
      <Deliverables delivs={delivs} engagements={engagements} canWrite={w} reload={reloadAll} pendingFor={pendingFor} decide={decide} />
      <Invoices invoices={invoices} vendors={vendors} engagements={engagements} canWrite={w} reload={reloadAll} pendingFor={pendingFor} decide={decide} />
    </div>
  );
}

// ── Vendors + scorecard + tokens + engagements ───────────────────────
function Vendors({ vendors, engagements, canWrite, reload }: { vendors: Vendor[] | null; engagements: Engagement[] | null; canWrite: boolean; reload: () => void }) {
  const { lang, tr, el } = useI18n();
  const [editing, setEditing] = useState<Partial<Vendor> | null>(null);
  const [open, setOpen] = useState<Vendor | null>(null);
  const [newEng, setNewEng] = useState<Partial<Engagement> | null>(null);
  const save = async () => {
    if (!editing?.name) return;
    if (editing.id) await api.patch(`/vendors/${editing.id}`, editing); else await api.post("/vendors", editing);
    setEditing(null); reload();
  };
  const saveEng = async () => {
    if (!newEng?.title || !newEng.vendorId) return;
    await api.post("/engagements", newEng); setNewEng(null); reload();
  };
  return (
    <Card>
      <SectionTitle action={canWrite && <button onClick={() => setEditing({ kind: "AGENCY", active: true })} className="btn-amber text-xs">+ {tr("ag_newVendor")}</button>}>
        {tr("ag_vendors")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ag_vendors_sub")}</p>
      {!vendors ? <SkeletonRows rows={3} cols={4} /> : vendors.length === 0 ? <Empty text={tr("ag_vendorsEmpty")} /> : (
        <div className="grid gap-2 md:grid-cols-2">
          {vendors.map((v) => {
            const engs = (engagements || []).filter((e) => e.vendorId === v.id);
            return (
              <button key={v.id} onClick={() => setOpen(v)} className="rounded-xl border border-paper-200 bg-white p-3 text-start hover:border-paper-300 hover:shadow-soft">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink-800">{v.name}</span>
                  <span className="pill bg-paper-200 text-[10px] text-ink-500">{el(v.kind)}</span>
                </div>
                <div className="mt-1 text-xs text-ink-400">
                  {engs.filter((e) => e.status === "ACTIVE").length}/{engs.length} {tr("ag_engagements")}
                  {!v.active && <span className="ms-2 text-clay-600">{tr("inactive")}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Vendor drawer: scorecard + engagements + portal link */}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name || ""}
        footer={canWrite ? <><button onClick={() => { setEditing(open); setOpen(null); }} className="btn-ghost me-auto">{tr("edit")}</button><button onClick={() => setOpen(null)} className="btn-ghost">{tr("close")}</button></> : undefined}>
        {open && <VendorDrawer vendor={open} engagements={(engagements || []).filter((e) => e.vendorId === open.id)} canWrite={canWrite} onNewEng={() => { setNewEng({ vendorId: open.id, status: "ACTIVE" }); setOpen(null); }} />}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("ag_newVendor")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label={tr("name")}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("type")}>
                <Select value={editing.kind || "AGENCY"} onChange={(v) => setEditing({ ...editing, kind: v })}
                  options={["AGENCY", "FREELANCER", "PRINTER", "PRODUCTION", "MEDIA_BUYER"].map((k) => ({ value: k, label: el(k) }))} />
              </Field>
              <Field label={tr("phone")}><input className="input" dir="ltr" value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            </div>
            <Field label={tr("email")}><input className="input" dir="ltr" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label={tr("notes")}><textarea className="input min-h-16" value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> {tr("active")}
            </label>
          </div>
        )}
      </Modal>

      <Modal open={!!newEng} onClose={() => setNewEng(null)} title={tr("ag_newEngagement")}
        footer={<><button onClick={() => setNewEng(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={saveEng} className="btn-amber">{tr("save")}</button></>}>
        {newEng && (
          <div className="space-y-3">
            <Field label={tr("title")}><input className="input" value={newEng.title || ""} onChange={(e) => setNewEng({ ...newEng, title: e.target.value })} /></Field>
            <Field label={tr("ag_scope")}><textarea className="input min-h-16" value={newEng.scope || ""} onChange={(e) => setNewEng({ ...newEng, scope: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("fee")} (USD)`}><input type="number" className="input" dir="ltr" value={newEng.feeUsd ?? ""} onChange={(e) => setNewEng({ ...newEng, feeUsd: Number(e.target.value) })} /></Field>
              <Field label={tr("status")}>
                <Select value={newEng.status || "ACTIVE"} onChange={(v) => setNewEng({ ...newEng, status: v })}
                  options={["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"].map((s) => ({ value: s, label: el(s) }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("startDate")}><input type="date" className="input" value={(newEng.startDate || "").slice(0, 10)} onChange={(e) => setNewEng({ ...newEng, startDate: e.target.value })} /></Field>
              <Field label={tr("endDate")}><input type="date" className="input" value={(newEng.endDate || "").slice(0, 10)} onChange={(e) => setNewEng({ ...newEng, endDate: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-ink-400">{lang === "ar" ? "سعر الصرف يُلتقط تلقائيًا عند الإنشاء." : "The FX rate is captured automatically on creation."}</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function VendorDrawer({ vendor, engagements, canWrite, onNewEng }: { vendor: Vendor; engagements: Engagement[]; canWrite: boolean; onNewEng: () => void }) {
  const { lang, tr, el } = useI18n();
  const { data: sc } = useFetch<Scorecard>(`/vendors/${vendor.id}/scorecard`, [vendor.id]);
  const { data: tokens, reload: reloadT } = useFetch<Token[]>(`/agency/tokens?vendorId=${vendor.id}`, [vendor.id]);
  const [days, setDays] = useState("30");
  const [minted, setMinted] = useState("");
  const mint = async () => {
    const r = await api.post<Token & { link: string }>("/agency/tokens", { vendorId: vendor.id, days: Number(days) });
    const url = `${window.location.origin}${r.link}`;
    setMinted(url); try { await navigator.clipboard.writeText(url); } catch { /* clipboard optional */ }
    reloadT();
  };
  const revoke = async (t: Token) => { await api.post(`/agency/tokens/${t.id}/revoke`, {}); reloadT(); };
  const live = (tokens || []).filter((t) => !t.revoked && new Date(t.expiresAt) > new Date());
  return (
    <div className="space-y-4">
      {sc && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label={tr("ag_onTime")} value={sc.deliverables.onTimeRate === null ? "—" : `${sc.deliverables.onTimeRate}%`} />
          <Stat label={tr("ag_avgRevisions")} value={String(sc.deliverables.avgRevisions)} />
          <Stat label={tr("ag_approvalRate")} value={sc.deliverables.approvalRate === null ? "—" : `${sc.deliverables.approvalRate}%`} />
          <Stat label={tr("ag_openDeliv")} value={String(sc.deliverables.open)} />
          <Stat label={tr("ag_spend")} value={`$${Math.round(sc.spend.approvedUsd).toLocaleString()}`} />
          <Stat label={tr("ag_engagements")} value={`${sc.engagements.active}/${sc.engagements.total}`} />
        </div>
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-ink-700">{tr("ag_engagements")}</span>
          {canWrite && <button onClick={onNewEng} className="btn-ghost text-xs">+ {tr("add")}</button>}
        </div>
        <div className="space-y-1.5">
          {engagements.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate text-ink-800">{e.title}</div>
                <div className="text-[11px] text-ink-400">{e.ownerName} · <Money usd={e.feeUsd} size="sm" /></div>
              </div>
              <StatusPill value={e.status} />
            </div>
          ))}
          {engagements.length === 0 && <p className="text-sm text-ink-400">{tr("ag_noEngagements")}</p>}
        </div>
      </div>
      {canWrite && (
        <div className="rounded-xl border border-paper-200 bg-paper-100/60 p-3">
          <div className="mb-2 text-sm font-medium text-ink-700">{tr("ag_portal")}</div>
          <p className="mb-2 text-xs text-ink-500">{tr("ag_portal_sub")}</p>
          <div className="flex items-center gap-2">
            <input className="input w-24" dir="ltr" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
            <span className="text-xs text-ink-500">{tr("ag_days")}</span>
            <button onClick={mint} className="btn-amber text-xs">{tr("ag_mintLink")}</button>
          </div>
          {minted && <div className="mt-2 break-all rounded-lg bg-white px-2 py-1.5 text-[11px] text-moss-600" dir="ltr">✓ {tr("ag_copied")} · {minted}</div>}
          {live.length > 0 && (
            <div className="mt-2 space-y-1">
              {live.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-[11px] text-ink-500">
                  <span dir="ltr">…{t.token.slice(-8)} · {lang === "ar" ? "حتى" : "until"} {fmtDate(t.expiresAt, lang)}</span>
                  <button onClick={() => revoke(t)} className="text-clay-600 hover:underline">{tr("ag_revoke")}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-paper-200 bg-white px-2 py-2">
      <div className="kpi-num text-base font-semibold text-ink-800">{value}</div>
      <div className="text-[10px] text-ink-400">{label}</div>
    </div>
  );
}

// ── Deliverables ─────────────────────────────────────────────────────
function Deliverables({ delivs, engagements, canWrite, reload, pendingFor, decide }: {
  delivs: Deliv[] | null; engagements: Engagement[] | null; canWrite: boolean; reload: () => void;
  pendingFor: (e: string, id: string) => Approval | undefined;
  decide: (apId: string, s: "APPROVED" | "REJECTED", note?: string) => Promise<void>;
}) {
  const { lang, tr, el } = useI18n();
  const [editing, setEditing] = useState<Partial<Deliv> | null>(null);
  const [thread, setThread] = useState<Deliv | null>(null);
  const [revising, setRevising] = useState<{ apId: string; note: string } | null>(null);
  const save = async () => {
    if (!editing?.title || !editing.engagementId) return;
    if (editing.id) await api.patch(`/deliverables/${editing.id}`, editing); else await api.post("/deliverables", editing);
    setEditing(null); reload();
  };
  const advance = async (d: Deliv, to: string) => { await api.patch(`/deliverables/${d.id}`, { status: to }); reload(); };
  return (
    <Card>
      <SectionTitle action={canWrite && (engagements?.length || 0) > 0 && <button onClick={() => setEditing({ engagementId: engagements![0].id })} className="btn-ghost text-xs">+ {tr("add")}</button>}>
        {tr("ag_deliverables")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ag_deliverables_sub")}</p>
      {!delivs ? <SkeletonRows rows={3} cols={5} /> : delivs.length === 0 ? <Empty text={tr("ag_delivEmpty")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-ink-400">
              <th className="pb-2 text-start">{tr("title")}</th><th className="pb-2 text-start">{tr("ag_vendor")}</th>
              <th className="pb-2 text-start">{tr("dueDate")}</th><th className="pb-2 text-start">{tr("ag_revisions")}</th>
              <th className="pb-2 text-start">{tr("status")}</th><th className="pb-2" />
            </tr></thead>
            <tbody>
              {delivs.map((d) => {
                const late = (daysUntil(d.dueDate) ?? 1) < 0 && d.status !== "APPROVED";
                const ap = pendingFor("deliverables", d.id);
                return (
                  <tr key={d.id} className="border-t border-paper-200 align-top">
                    <td className="py-2.5 pe-3">
                      <div className="font-medium text-ink-800">{d.title}</div>
                      <div className="text-xs text-ink-400">
                        {d.engagementTitle}
                        {d.submittedUrl && <> · <a href={d.submittedUrl} target="_blank" rel="noreferrer" className="text-steel-600 hover:underline">{tr("ag_work")} ↗</a></>}
                        {" · "}<button onClick={() => setThread(d)} className="text-steel-600 hover:underline">{tr("ag_comments")}</button>
                      </div>
                    </td>
                    <td className="py-2.5 pe-3 text-ink-600">{d.vendorName}</td>
                    <td className={`py-2.5 pe-3 text-xs ${late ? "text-clay-600" : "text-ink-500"}`}>{fmtDate(d.dueDate, lang)}{late ? " ⚠" : ""}</td>
                    <td className="py-2.5 pe-3 kpi-num text-ink-600">{d.revisionCount}</td>
                    <td className="py-2.5 pe-3"><StatusPill value={d.status} /></td>
                    <td className="py-2.5 text-end">
                      {canWrite && ap && (
                        <span className="inline-flex gap-1">
                          <button onClick={() => decide(ap.id, "APPROVED")} className="rounded-lg bg-moss-500/12 px-2 py-1 text-[11px] font-medium text-moss-600 hover:bg-moss-500/20">✓ {tr("ap_approve")}</button>
                          <button onClick={() => setRevising({ apId: ap.id, note: "" })} className="rounded-lg bg-clay-500/10 px-2 py-1 text-[11px] font-medium text-clay-600 hover:bg-clay-500/20">↺ {tr("ag_requestRevision")}</button>
                        </span>
                      )}
                      {canWrite && !ap && (DNEXT[d.status] || []).map((to) => (
                        <button key={to} onClick={() => advance(d, to)} className="ms-1 rounded-lg border border-paper-300 bg-white px-2 py-1 text-[11px] text-ink-600 hover:bg-paper-100">→ {el(to)}</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={tr("ag_newDeliverable")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label={tr("title")}><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label={tr("ag_engagement")}>
              <Select value={editing.engagementId || ""} onChange={(v) => setEditing({ ...editing, engagementId: v })}
                options={(engagements || []).map((e) => ({ value: e.id, label: `${e.vendorName} — ${e.title}` }))} />
            </Field>
            <Field label={tr("dueDate")}><input type="date" className="input" value={(editing.dueDate || "").slice(0, 10)} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!thread} onClose={() => setThread(null)} title={thread ? thread.title : ""}>
        {thread && <Thread deliv={thread} canWrite={canWrite} />}
      </Modal>

      <Modal open={!!revising} onClose={() => setRevising(null)} title={tr("ag_requestRevision")}
        footer={<><button onClick={() => setRevising(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={async () => { if (revising) { await decide(revising.apId, "REJECTED", revising.note || undefined); setRevising(null); } }} className="btn-amber">{tr("send")}</button></>}>
        {revising && <Field label={tr("ap_note")}><textarea className="input min-h-24" value={revising.note} onChange={(e) => setRevising({ ...revising, note: e.target.value })} placeholder={lang === "ar" ? "ما المطلوب تعديله؟ يظهر للوكالة في البوابة." : "What needs to change? The vendor sees this in the portal."} /></Field>}
      </Modal>
    </Card>
  );
}

function Thread({ deliv, canWrite }: { deliv: Deliv; canWrite: boolean }) {
  const { lang, tr } = useI18n();
  const { data: comments, reload } = useFetch<Comment[]>(`/deliverables/${deliv.id}/comments`, [deliv.id]);
  const [body, setBody] = useState("");
  const post = async () => {
    if (!body.trim()) return;
    await api.post(`/deliverables/${deliv.id}/comments`, { body }); setBody(""); reload();
  };
  return (
    <div className="space-y-3">
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {(comments || []).map((c) => (
          <div key={c.id} className={`rounded-xl px-3 py-2 text-sm ${c.author === "VENDOR" ? "bg-paper-100 text-ink-700" : "bg-amber-500/10 text-ink-800"}`}>
            <div className="mb-0.5 text-[11px] text-ink-400">{c.authorName} · {fmtDate(c.createdAt, lang)}</div>
            {c.body}
          </div>
        ))}
        {comments && comments.length === 0 && <p className="text-sm text-ink-400">{tr("ag_noComments")}</p>}
      </div>
      {canWrite && (
        <div className="flex gap-2">
          <input className="input flex-1" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && post()} placeholder={tr("ag_reply")} />
          <button onClick={post} className="btn-amber">{tr("send")}</button>
        </div>
      )}
    </div>
  );
}

// ── Invoices ─────────────────────────────────────────────────────────
function Invoices({ invoices, vendors, engagements, canWrite, reload, pendingFor, decide }: {
  invoices: Invoice[] | null; vendors: Vendor[] | null; engagements: Engagement[] | null; canWrite: boolean; reload: () => void;
  pendingFor: (e: string, id: string) => Approval | undefined;
  decide: (apId: string, s: "APPROVED" | "REJECTED", note?: string) => Promise<void>;
}) {
  const { lang, tr } = useI18n();
  const [adding, setAdding] = useState<Partial<Invoice & { engagementId?: string }> | null>(null);
  const save = async () => {
    if (!adding?.vendorId || !adding.number) return;
    await api.post("/invoices", adding); setAdding(null); reload();
  };
  const markPaid = async (i: Invoice) => { await api.patch(`/invoices/${i.id}`, { status: "PAID" }); reload(); };
  return (
    <Card>
      <SectionTitle action={canWrite && (vendors?.length || 0) > 0 && <button onClick={() => setAdding({ vendorId: vendors![0].id })} className="btn-ghost text-xs">+ {tr("add")}</button>}>
        {tr("ag_invoices")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ag_invoices_sub")}</p>
      {!invoices ? <SkeletonRows rows={2} cols={4} /> : invoices.length === 0 ? <Empty text={tr("ag_invEmpty")} /> : (
        <div className="space-y-1.5">
          {invoices.map((i) => {
            const ap = pendingFor("invoices", i.id);
            return (
              <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
                <span className="kpi-num font-medium text-ink-800" dir="ltr">{i.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-500">{i.vendorName}{i.engagementTitle ? ` · ${i.engagementTitle}` : ""}</span>
                <Money usd={i.amountUsd} sdg={i.rateAtEntry ? i.amountUsd * i.rateAtEntry : undefined} size="sm" />
                <StatusPill value={i.status} />
                {canWrite && ap && <button onClick={() => decide(ap.id, "APPROVED")} className="rounded-lg bg-moss-500/12 px-2 py-1 text-[11px] font-medium text-moss-600 hover:bg-moss-500/20">✓ {tr("ap_approve")}</button>}
                {canWrite && i.status === "APPROVED" && <button onClick={() => markPaid(i)} className="rounded-lg border border-paper-300 px-2 py-1 text-[11px] text-ink-600 hover:bg-paper-100">{tr("ag_markPaid")}</button>}
                {i.status === "PAID" && i.paidAt && <span className="text-[11px] text-ink-400">{fmtDate(i.paidAt, lang)}</span>}
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title={tr("ag_newInvoice")}
        footer={<><button onClick={() => setAdding(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {adding && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("ag_vendor")}>
                <Select value={adding.vendorId || ""} onChange={(v) => setAdding({ ...adding, vendorId: v })}
                  options={(vendors || []).map((v) => ({ value: v.id, label: v.name }))} />
              </Field>
              <Field label={tr("ag_invoiceNo")}><input className="input" dir="ltr" value={adding.number || ""} onChange={(e) => setAdding({ ...adding, number: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="USD"><input type="number" className="input" dir="ltr" value={adding.amountUsd ?? ""} onChange={(e) => setAdding({ ...adding, amountUsd: Number(e.target.value) })} /></Field>
              <Field label={tr("ag_engagement")}>
                <Select value={adding.engagementId || ""} onChange={(v) => setAdding({ ...adding, engagementId: v })} placeholder="—"
                  options={(engagements || []).filter((e) => e.vendorId === adding.vendorId).map((e) => ({ value: e.id, label: e.title }))} />
              </Field>
            </div>
            <p className="text-xs text-ink-400">{lang === "ar" ? "عند الاعتماد من صندوق الموافقات يُسجَّل الصرف تلقائيًا في الميزانية." : "On approval from the inbox, the spend is posted to the budget automatically."}</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}
