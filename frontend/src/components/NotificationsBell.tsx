import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { fmtDate } from "../lib/format";

interface Notif {
  id: string;
  type: string;
  meta?: { title?: string; company?: string; count?: number; value?: number; baseline?: number; platform?: string; handle?: string } | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export default function NotificationsBell() {
  const { lang, tr } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    api.get<{ unread: number; items: Notif[] }>("/notifications?limit=15")
      .then((r) => { setUnread(r.unread); setItems(r.items); })
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const label = (n: Notif) => {
    const m = n.meta || {};
    switch (n.type) {
      case "TASK_ASSIGNED": return `${tr("n_TASK_ASSIGNED")}: ${m.title || ""}`;
      case "TASKS_ASSIGNED": return `${m.count || ""} ${tr("n_TASKS_ASSIGNED")}`;
      case "LEAD_CAPTURED": return `${tr("n_LEAD_CAPTURED")}: ${m.company || ""}`;
      case "ALERT_MENTION_SPIKE": return `${tr("li_alert_spike")}: ${m.value} ${tr("li_vsBaseline")} ~${m.baseline}`;
      case "ALERT_NEGATIVE_SHIFT": return `${tr("li_alert_neg")}: ${m.value}%`;
      case "ALERT_FOLLOWER_DROP": return `${tr("li_alert_drop")}: ${m.value} — ${m.platform || ""} @${m.handle || ""}`;
      case "ALERT_LOW_ENGAGEMENT": return `${tr("li_alert_lowEng")}: ${m.value}% — ${m.platform || ""}`;
      default: return n.type;
    }
  };

  const openItem = async (n: Notif) => {
    setOpen(false);
    if (!n.readAt) { api.patch(`/notifications/${n.id}/read`, {}).catch(() => {}); setUnread((u) => Math.max(0, u - 1)); }
    if (n.link) navigate(n.link);
  };

  const markAll = () => api.patch("/notifications/read-all", {}).then(() => { setUnread(0); load(); }).catch(() => {});

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(!open); if (!open) load(); }} aria-label={tr("notif_title")}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-paper-300 bg-white text-ink-600 hover:bg-paper-100">
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 20a2 2 0 01-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-ink-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-11 z-50 w-80 max-w-[88vw] overflow-hidden rounded-xl border border-paper-200 bg-white shadow-overlay">
          <div className="flex items-center justify-between border-b border-paper-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-ink-800">{tr("notif_title")}</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-amber-700 hover:underline">{tr("notif_markAll")}</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-400">{tr("notif_empty")}</p>
            ) : items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)}
                className={`block w-full border-b border-paper-100 px-4 py-2.5 text-start hover:bg-paper-100/70 ${n.readAt ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink-700">{label(n)}</div>
                    <div className="text-[11px] text-ink-400">{fmtDate(n.createdAt, lang)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
