import { useState } from "react";
import { useFetch, Card, SectionTitle, Modal } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";

// ═══ THEMES (Wave 3·E) ═══════════════════════════════════════════════
// "Sentiment is −0.2" is not actionable. "Delivery delays, price rises,
// one product defect" is. This is that difference, on screen.

interface Theme {
  id: string; label: string; labelAr?: string; summary?: string; topicLabel?: string;
  sentiment: number | null; signalCount: number; priorCount: number;
  emerging: boolean; status: string; createdAt: string;
  signals?: { id: string; quote: string }[];
}
interface Agreement { ruled: number; agreed: number; pct: number | null }

export function Themes({ topicId, canManage }: { topicId?: string | null; canManage: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Theme[]>(topicId ? `/osint/themes?topicId=${topicId}` : "/osint/themes", [topicId || ""]);
  const agree = useFetch<Agreement>("/osint/agreement");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Theme | null>(null);
  const rows = (data || []).filter((t) => t.status !== "DISMISSED");

  const find = async () => {
    if (!topicId) return;
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; themes?: Theme[]; reason?: string }>(`/osint/topics/${topicId}/themes`, { days: 30 });
      toast.push(r.ok ? `${r.themes?.length ?? 0} ${tr("th_found")}` : (r.reason || tr("th_none")), r.ok ? "success" : "info");
      reload();
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  const decide = async (id: string, status: "ACCEPTED" | "DISMISSED") => {
    try { await api.post(`/osint/themes/${id}/decide`, { status }); setOpen(null); reload(); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  const tone = (s: number | null) =>
    s == null ? "bg-ink-300" : s > 0.2 ? "bg-moss-500" : s < -0.2 ? "bg-clay-500" : "bg-ink-400";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🧵 {tr("th_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("th_sub")}</p>
        </div>
        {canManage && topicId && (
          <button onClick={find} disabled={busy} className="btn-ghost text-xs">
            {busy ? "…" : `✦ ${tr("th_find")}`}
          </button>
        )}
      </div>

      {!rows.length ? (
        <p className="mt-2 text-sm text-ink-400">{tr("th_empty")}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((t) => (
            <button key={t.id} onClick={() => setOpen(t)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-start hover:bg-paper-100">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone(t.sentiment)}`} />
                <span className="truncate text-sm text-ink-800">{lang === "ar" && t.labelAr ? t.labelAr : t.label}</span>
                {t.emerging && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    ↑ {tr("th_emerging")}
                  </span>
                )}
                {t.status === "DRAFT" && <span className="shrink-0 text-[10px] text-ink-400">{tr("th_draft")}</span>}
              </span>
              <span className="kpi-num shrink-0 text-xs font-bold text-ink-900" dir="ltr">{t.signalCount}</span>
            </button>
          ))}
        </div>
      )}

      {agree.data?.pct != null && (
        <p className="mt-3 border-t border-paper-200 pt-2 text-[10px] text-ink-400">
          {tr("th_agreement")}: <span className="kpi-num text-ink-600" dir="ltr">{agree.data.pct}%</span>{" "}
          ({agree.data.agreed}/{agree.data.ruled}) — {tr("th_agreeHint")}
        </p>
      )}

      {open && (
        <Modal open title={lang === "ar" && open.labelAr ? open.labelAr : open.label} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-ink-600">
              <span>{tr("th_volume")}: <span className="kpi-num font-bold text-ink-900" dir="ltr">{open.signalCount}</span></span>
              {open.priorCount > 0 && <span>{tr("th_prior")}: <span className="kpi-num" dir="ltr">{open.priorCount}</span></span>}
              {open.emerging && <span className="text-amber-700">↑ {tr("th_emergingHint")}</span>}
            </div>
            {!!open.signals?.length && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("th_from")}</div>
                <ul className="mt-1 space-y-1">
                  {open.signals.map((s) => (
                    <li key={s.id} className="text-[11px] leading-relaxed text-ink-700">· {s.quote}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-ink-400">{tr("th_note")}</p>
            {canManage && open.status === "DRAFT" && (
              <div className="flex gap-2">
                <button onClick={() => decide(open.id, "ACCEPTED")} className="btn-amber flex-1">✓ {tr("th_accept")}</button>
                <button onClick={() => decide(open.id, "DISMISSED")} className="btn-ghost flex-1">✕ {tr("th_dismiss")}</button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </Card>
  );
}
