import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionTitle, Field, Modal, StatusPill, Empty, SkeletonRows, useFetch } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ── APPROVALS — one inbox for every sign-off in Pulse ────────────────

interface Approval { id: string; entity: string; entityId: string; stage: string; status: string; note?: string;
  requesterName?: string; approverName?: string; createdAt: string; decidedAt?: string }

const ENTITY_LINK: Record<string, string> = { invoices: "/agency", deliverables: "/agency", asset_versions: "/studio" };

export default function Approvals() {
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
