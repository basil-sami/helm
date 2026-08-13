import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionTitle, Field, Modal, Select, StatusPill, Empty, SkeletonRows, useFetch } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useAuth } from "../context/AuthContext";

// ── APPROVALS — one inbox for every sign-off in Pulse ────────────────

interface Preview { kind: string; title?: string; body?: string | null; bodyAr?: string | null;
  meta?: string | null; mediaUrl?: string | null; amountUsd?: number; when?: string | null }
interface Approval { id: string; entity: string; entityId: string; stage: string; status: string; note?: string;
  requesterName?: string; approverName?: string; createdAt: string; decidedAt?: string; preview?: Preview | null }

const ENTITY_LINK: Record<string, string> = {
  invoices: "/agency", deliverables: "/agency", asset_versions: "/studio",
  scheduled_posts: "/publish", content_items: "/calendar",
};
interface UserRow { id: string; name: string }
interface Delegation { id: string; approverId: string; approverName?: string; delegateId: string; delegateName?: string; fromDate: string; toDate: string; reason?: string; active: boolean }

// W4·UX — the thing being approved, shown where the decision happens.
function PreviewBlock({ p, lang }: { p: Preview; lang: "ar" | "en" }) {
  const body = lang === "ar" ? (p.bodyAr || p.body) : (p.body || p.bodyAr);
  const isImg = p.mediaUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(p.mediaUrl);
  return (
    <div className="mt-2 flex w-full items-start gap-3 rounded-lg border border-paper-200 bg-white p-2.5">
      {p.mediaUrl && (isImg
        ? <img src={p.mediaUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
        : <a href={p.mediaUrl} target="_blank" rel="noreferrer" className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-paper-100 text-lg">📎</a>)}
      <div className="min-w-0 flex-1">
        {p.title && <div className="truncate text-sm font-medium text-ink-800">{p.title}</div>}
        {body && <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-ink-600" dir="auto">{body}</div>}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500" dir="ltr">
          {p.meta && <span>{p.meta}</span>}
          {p.when && <span>{fmtDate(p.when, lang)}</span>}
          {p.amountUsd != null && <span className="kpi-num font-semibold text-ink-800">${p.amountUsd.toLocaleString()}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Approvals() {
  const { lang, tr } = useI18n();
  const { can, isAdmin } = useAuth();
  const { data, reload } = useFetch<Approval[]>("/approvals");
  const { data: delegations, reload: reloadDelegations } = useFetch<Delegation[]>("/delegations");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [deciding, setDeciding] = useState<{ ap: Approval; status: "APPROVED" | "REJECTED"; note: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [delegation, setDelegation] = useState({ approverId: "", delegateId: "", fromDate: "", toDate: "", reason: "" });
  const [err, setErr] = useState("");
  const pending = (data || []).filter((a) => a.status === "PENDING");
  const decided = (data || []).filter((a) => a.status !== "PENDING").slice(0, 30);

  const entityLabel = (e: string) => tr(`ap_e_${e}`) !== `ap_e_${e}` ? tr(`ap_e_${e}`) : e;
  const submit = async () => {
    if (!deciding) return;
    setErr("");
    try {
      await api.post(`/approvals/${deciding.ap.id}/decide`, { status: deciding.status, note: deciding.note || undefined });
      setDeciding(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const bulk = async (status: "APPROVED" | "REJECTED") => {
    try { const out = await api.post<{ decided: number }>("/approvals/bulk-decide", { ids: selected, status }); setSelected([]); reload(); setErr(""); if (!out.decided) setErr("No selected approvals could be decided."); }
    catch (e) { setErr((e as Error).message); }
  };
  const createDelegation = async () => {
    try { await api.post("/delegations", { ...delegation, approverId: delegation.approverId || undefined }); setDelegation({ approverId: "", delegateId: "", fromDate: "", toDate: "", reason: "" }); reloadDelegations(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={selected.length ? <div className="flex gap-2"><button onClick={() => bulk("APPROVED")} className="btn-ghost text-xs text-moss-700">{tr("ap_approve")} {selected.length}</button><button onClick={() => bulk("REJECTED")} className="btn-ghost text-xs text-clay-600">{tr("ap_reject")} {selected.length}</button></div> : undefined}>{tr("ap_title")}</SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ap_sub")}</p>
        {!data ? <SkeletonRows rows={3} cols={3} /> : pending.length === 0 ? <Empty text={tr("ap_clear")} /> : (
          <div className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[.04] px-3 py-2.5">
                <input type="checkbox" aria-label={entityLabel(a.entity)} checked={selected.includes(a.id)} onChange={() => setSelected((old) => old.includes(a.id) ? old.filter((id) => id !== a.id) : [...old, a.id])} />
                <div className="min-w-0 flex-1">
                  <Link to={ENTITY_LINK[a.entity] || "/"} className="text-sm font-medium text-ink-800 hover:underline">{entityLabel(a.entity)}</Link>
                  <div className="text-xs text-ink-500">
                    {a.requesterName || "—"} · {fmtDate(a.createdAt, lang)}
                    {a.note && <span className="ms-1 text-ink-400">— {a.note}</span>}
                  </div>
                  {a.preview && <PreviewBlock p={a.preview} lang={lang} />}
                </div>
                <button onClick={() => setDeciding({ ap: a, status: "APPROVED", note: "" })}
                  className="rounded-lg bg-moss-500/12 px-3 py-1.5 text-xs font-medium text-moss-600 hover:bg-moss-500/20">✓ {tr("ap_approve")}</button>
                <button onClick={() => setDeciding({ ap: a, status: "REJECTED", note: "" })}
                  className="rounded-lg bg-clay-500/10 px-3 py-1.5 text-xs font-medium text-clay-600 hover:bg-clay-500/20">✕ {tr("ap_reject")}</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {can("campaigns", "read") && <Card>
        <SectionTitle>{lang === "ar" ? "تفويض الموافقات" : "Approval delegation"}</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {isAdmin ? <Select value={delegation.approverId} onChange={(approverId) => setDelegation({ ...delegation, approverId })} placeholder={lang === "ar" ? "أنا (الافتراضي)" : "Me (default)"} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /> : <div />}
          <Select value={delegation.delegateId} onChange={(delegateId) => setDelegation({ ...delegation, delegateId })} placeholder={lang === "ar" ? "المفوَّض" : "Delegate"} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} />
          <input className="input" type="date" value={delegation.fromDate} onChange={(e) => setDelegation({ ...delegation, fromDate: e.target.value })} />
          <input className="input" type="date" value={delegation.toDate} onChange={(e) => setDelegation({ ...delegation, toDate: e.target.value })} />
          <input className="input" placeholder={tr("notes")} value={delegation.reason} onChange={(e) => setDelegation({ ...delegation, reason: e.target.value })} />
          {can("campaigns") && <button onClick={createDelegation} disabled={!delegation.delegateId || !delegation.fromDate || !delegation.toDate} className="btn-amber">{tr("save")}</button>}
        </div>
        {!!delegations?.length && <div className="mt-4 space-y-2">{delegations.map((d) => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 p-2 text-xs"><span>{d.approverName} → {d.delegateName} · {fmtDate(d.fromDate, lang)} → {fmtDate(d.toDate, lang)}</span>{d.active && <button onClick={async () => { await api.del(`/delegations/${d.id}`); reloadDelegations(); }} className="text-clay-600">{lang === "ar" ? "إلغاء التفويض" : "Revoke"}</button>}</div>)}</div>}
        {err && <div className="mt-3 rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
      </Card>}

      <Card>
        <SectionTitle>{tr("ap_history")}</SectionTitle>
        {decided.length === 0 ? <Empty text={tr("ap_noHistory")} /> : (
          <div className="space-y-1.5">
            {decided.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusPill value={a.status} />
                <span className="text-ink-700">{entityLabel(a.entity)}</span>
                <span className="text-xs text-ink-400">{a.approverName || "—"} · {fmtDate(a.decidedAt || a.createdAt, lang)}</span>
                {a.note && <span className="min-w-0 flex-1 truncate text-xs text-ink-400">— {a.note}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!deciding} onClose={() => setDeciding(null)}
        title={deciding?.status === "APPROVED" ? tr("ap_approve") : tr("ap_reject")}
        footer={<><button onClick={() => setDeciding(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={submit} className={deciding?.status === "APPROVED" ? "btn-amber" : "rounded-xl bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600"}>{tr("confirm")}</button></>}>
        {deciding && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">{entityLabel(deciding.ap.entity)} · {deciding.ap.requesterName || "—"}</p>
            {deciding.ap.preview && <PreviewBlock p={deciding.ap.preview} lang={lang} />}
            <Field label={tr("ap_note")}>
              <textarea className="input min-h-20" value={deciding.note} onChange={(e) => setDeciding({ ...deciding, note: e.target.value })}
                placeholder={deciding.status === "REJECTED" ? tr("ap_notePh") : ""} />
            </Field>
            {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
