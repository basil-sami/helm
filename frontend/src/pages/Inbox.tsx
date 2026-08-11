import { useState } from "react";
import { useFetch, Card, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { Link } from "react-router-dom";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

// ═══ INBOX v1 — الوارد الاجتماعي: capture → triage → lead ═══════════

interface Item { id: string; platform: string; kind: string; author?: string; text?: string; url?: string; status: string; leadId?: string; via?: string; receivedAt: string }

const PLATFORMS = ["IG", "FB", "TIKTOK", "X", "WA", "OTHER"];
const P_ICON: Record<string, string> = { IG: "📸", FB: "📘", TIKTOK: "🎵", X: "𝕏", WA: "💬", OTHER: "🌐" };
const S_TONE: Record<string, string> = {
  OPEN: "bg-amber-500/15 text-amber-700", REPLIED: "bg-paper-200 text-ink-600",
  CONVERTED: "bg-moss-100 text-moss-700", ARCHIVED: "bg-paper-200 text-ink-400",
};

export default function Inbox() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("social");
  const { data, loading, reload } = useFetch<Item[]>("/inbox");
  const [filter, setFilter] = useState("OPEN");
  const [addM, setAddM] = useState(false);
  const [reply, setReply] = useState<Item | null>(null);
  const [win, setWin] = useState<{ open: boolean; hoursSince: number } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [tplId, setTplId] = useState("");
  const templates = useFetch<{ id: string; name: string; waTemplateName?: string }[]>("/wa-templates");
  const [form, setForm] = useState({ platform: "IG", kind: "DM", author: "", text: "", url: "" });

  const rows = (data || []).filter((i) => filter === "ALL" || i.status === filter);
  const openCount = (data || []).filter((i) => i.status === "OPEN").length;

  const setStatus = async (id: string, status: string) => {
    await api.patch(`/inbox/${id}`, { status }); reload();
  };
  const openReply = async (i: Item) => {
    setReply(i); setWin(null); setReplyText(""); setTplId("");
    try { setWin(await api.get(`/inbox/${i.id}/window`)); } catch { setWin({ open: false, hoursSince: 99 }); }
  };

  const sendReply = async () => {
    if (!reply) return;
    try {
      await api.post(`/inbox/${reply.id}/reply`, tplId ? { templateId: tplId } : { text: replyText });
      setReply(null); reload(); toast.push(tr("ix_replySent"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const convert = async (i: Item) => {
    try {
      const r = await api.post<{ leadId: string }>(`/inbox/${i.id}/convert`, {});
      reload(); toast.push(tr("ix_converted"), "success");
      void r;
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("ix_title")}
            {openCount > 0 && <span className="kpi-num ms-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700" dir="ltr">{openCount}</span>}
          </h1>
          <p className="text-sm text-ink-500">{tr("ix_sub")}</p>
        </div>
        {w && <button onClick={() => { setForm({ platform: "IG", kind: "DM", author: "", text: "", url: "" }); setAddM(true); }} className="btn-amber">+ {tr("ix_capture")}</button>}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {["OPEN", "REPLIED", "CONVERTED", "ARCHIVED", "ALL"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 font-medium transition ${filter === s ? "tab-active" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
            {s === "ALL" ? tr("ix_all") : tr(`ix_s_${s}`)}
          </button>
        ))}
      </div>

      {loading ? <SkeletonCards count={3} /> : !rows.length ? (
        <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("ix_none")}</p><p className="mt-1 text-xs text-ink-400">{tr("ix_noneHint")}</p></Card>
      ) : (
        <Card className="divide-y divide-paper-200 p-0">
          {rows.map((i) => (
            <div key={i.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span>{P_ICON[i.platform] || "🌐"}</span>
                    <span className="font-medium text-ink-900" dir="ltr">{i.author || "—"}</span>
                    <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-500">{tr(`ix_k_${i.kind}`)}</span>
                    {i.via === "API" && <span className="rounded-full bg-moss-100 px-1.5 py-0.5 text-[10px] font-bold text-moss-700">API</span>}
                    <span className="text-[10px] text-ink-400">{ago(i.receivedAt)}</span>
                  </div>
                  {i.text && <p className="mt-1 text-sm leading-relaxed text-ink-700">{i.text}</p>}
                  {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="kpi-num mt-0.5 inline-block text-[11px] text-amber-700 hover:underline" dir="ltr">🔗 {tr("ix_open")}</a>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${S_TONE[i.status]}`}>{tr(`ix_s_${i.status}`)}</span>
              </div>
              {w && i.status !== "CONVERTED" && (
                <div className="mt-2 flex gap-2 text-[11px]">
                  {i.platform === "WA" && <button onClick={() => openReply(i)} className="rounded-lg bg-moss-100 px-2.5 py-1 font-medium text-moss-700">↩ {tr("ix_reply")}</button>}
                  {i.status === "OPEN" && <button onClick={() => setStatus(i.id, "REPLIED")} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">💬 {tr("ix_markReplied")}</button>}
                  <button onClick={() => convert(i)} className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-medium text-amber-700">⚡ {tr("ix_toLead")}</button>
                  {i.status !== "ARCHIVED" && <button onClick={() => setStatus(i.id, "ARCHIVED")} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-500 hover:bg-paper-300">{tr("ix_archive")}</button>}
                </div>
              )}
              {i.status === "CONVERTED" && i.leadId && (
                <Link to="/leads" className="mt-2 inline-block text-[11px] font-medium text-moss-700 hover:underline">→ {tr("ix_viewLead")}</Link>
              )}
            </div>
          ))}
        </Card>
      )}

      {reply && (
        <Modal open title={`↩ ${reply.author || tr("ix_reply")}`} onClose={() => setReply(null)}>
          <div className="space-y-3">
            {!win ? <p className="text-sm text-ink-400">…</p> : win.open ? (
              <>
                <div className="rounded-xl bg-moss-100 px-3 py-2 text-xs text-moss-700">{tr("ix_winOpen")}</div>
                <textarea className="input min-h-24" placeholder={tr("ix_replyText")} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
              </>
            ) : (
              <>
                <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-700">{tr("ix_winClosed")}</div>
                <select className="input" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                  <option value="">{tr("ix_pickTemplate")}</option>
                  {(templates.data || []).filter((t) => t.waTemplateName).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="text-[11px] text-ink-400">{tr("ix_tplHint")}</p>
              </>
            )}
            <button onClick={sendReply} className="btn-amber w-full" disabled={win ? (win.open ? !replyText : !tplId) : true}>
              {tr("ix_send")}
            </button>
          </div>
        </Modal>
      )}

      {addM && (
        <Modal open title={tr("ix_capture")} onClose={() => setAddM(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{P_ICON[p]} {p}</option>)}
              </select>
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {["DM", "COMMENT", "MENTION"].map((k) => <option key={k} value={k}>{tr(`ix_k_${k}`)}</option>)}
              </select>
            </div>
            <input className="input" placeholder="@username" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} dir="ltr" />
            <textarea className="input min-h-24" placeholder={tr("ix_text")} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            <input className="input" placeholder={tr("ix_url")} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} dir="ltr" />
            <button className="btn-amber w-full" disabled={!form.author && !form.text}
              onClick={async () => {
                try { await api.post("/inbox", form); setAddM(false); reload(); toast.push(tr("saved"), "success"); }
                catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("save")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
