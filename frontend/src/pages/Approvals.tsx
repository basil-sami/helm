import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionTitle, Field, Modal, StatusPill, Empty, SkeletonRows, useFetch, Select } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ── APPROVALS — one inbox for every sign-off in Pulse ────────────────

interface Preview { kind: string; title?: string; body?: string | null; bodyAr?: string | null;
  meta?: string | null; mediaUrl?: string | null; amountUsd?: number; when?: string | null;
  budgetContext?: { campaignName: string; pctAfter: number | null; planned: number } | null }
interface Approval { id: string; entity: string; entityId: string; stage: string; status: string; note?: string;
  requesterName?: string; approverName?: string; createdAt: string; decidedAt?: string; preview?: Preview | null }

const ENTITY_LINK: Record<string, string> = {
  invoices: "/agency", deliverables: "/agency", asset_versions: "/studio",
  scheduled_posts: "/publish", content: "/calendar",
};

// W4·UX — the thing being approved, shown where the decision happens.
function PreviewBlock({ p, lang }: { p: Preview; lang: "ar" | "en" }) {
  const { tr } = useI18n();
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
        {p.budgetContext && p.budgetContext.pctAfter != null && (
          <div className={`mt-1 text-[11px] ${p.budgetContext.pctAfter >= 100 ? "font-semibold text-clay-600"
            : p.budgetContext.pctAfter >= 90 ? "font-medium text-amber-700" : "text-ink-500"}`} dir="auto">
            {tr("fin_takesTo")} «{p.budgetContext.campaignName}» {tr("fin_to")} <span className="kpi-num" dir="ltr">{p.budgetContext.pctAfter}%</span> {tr("fin_ofEnvelope")}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { data: dlg, reload: reloadDlg } = useFetch<{ id: string; approverName: string; delegateName: string; fromDate: string; toDate: string; active: boolean }[]>("/delegations");
  const { data: dlgUsers } = useFetch<{ id: string; name: string }[]>("/users");
  const [dlgNew, setDlgNew] = useState<{ delegateId: string; fromDate: string; toDate: string } | null>(null);
  const [dlgErr, setDlgErr] = useState("");
  const saveDlg = async () => {
    if (!dlgNew?.delegateId || !dlgNew.fromDate || !dlgNew.toDate) return;
    try { await api.post("/delegations", dlgNew); setDlgNew(null); setDlgErr(""); reloadDlg(); }
    catch (e) { setDlgErr((e as Error).message); }
  };
  const dropDlg = async (id: string) => {
    try { await api.del(`/delegations/${id}`); reloadDlg(); } catch (e) { setDlgErr((e as Error).message); }
  };
  const { lang, tr } = useI18n();
  const { data, reload } = useFetch<Approval[]>("/approvals");
  const [deciding, setDeciding] = useState<{ ap: Approval; status: "APPROVED" | "REJECTED"; note: string } | null>(null);
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

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>{tr("ap_title")}</SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ap_sub")}</p>
        {!data ? <SkeletonRows rows={3} cols={3} /> : pending.length === 0 ? <Empty text={tr("ap_clear")} /> : (
          <div className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[.04] px-3 py-2.5">
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

      {/* ── the away-switch: delegation finally has a door ── */}
      <Card>
        <SectionTitle action={<button onClick={() => setDlgNew({ delegateId: "", fromDate: new Date().toISOString().slice(0, 10), toDate: "" })} className="btn-ghost text-xs">+ {tr("dlg_add")}</button>}>
          🤝 {tr("dlg_title")}
        </SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("dlg_sub")}</p>
        {dlgErr && <p className="mb-2 text-xs text-clay-600" dir="auto">{dlgErr}</p>}
        <div className="space-y-1">
          {(dlg || []).filter((d) => d.active).map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-ink-700">{d.approverName} ← {d.delegateName}
                <span className="ms-2 kpi-num text-[10px] text-ink-400" dir="ltr">{d.fromDate?.slice(0, 10)} → {d.toDate?.slice(0, 10)}</span>
              </span>
              <button onClick={() => dropDlg(d.id)} className="text-clay-600 hover:underline">{tr("ag_revoke")}</button>
            </div>
          ))}
          {dlg && dlg.filter((d) => d.active).length === 0 && <p className="text-xs text-ink-400">{tr("dlg_none")}</p>}
        </div>
        {dlgNew && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1"><Select value={dlgNew.delegateId} onChange={(v: string) => setDlgNew({ ...dlgNew, delegateId: v })} placeholder={tr("dlg_to")}
              options={(dlgUsers || []).map((u) => ({ value: u.id, label: u.name }))} /></div>
            <input type="date" className="input h-9 w-36" value={dlgNew.fromDate} onChange={(e) => setDlgNew({ ...dlgNew, fromDate: e.target.value })} />
            <input type="date" className="input h-9 w-36" value={dlgNew.toDate} onChange={(e) => setDlgNew({ ...dlgNew, toDate: e.target.value })} />
            <button onClick={saveDlg} className="btn-amber text-xs">{tr("save")}</button>
            <button onClick={() => setDlgNew(null)} className="btn-ghost text-xs">{tr("cancel")}</button>
          </div>
        )}
      </Card>
    </div>
  );
}
