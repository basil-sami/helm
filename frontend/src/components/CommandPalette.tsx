import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { t } from "../locales/dict";

interface Cmd { id: string; label: string; hint: string; run: () => void; keywords?: string }

export default function CommandPalette() {
  const navigate = useNavigate();
  const { lang, tr, toggle } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const go = (path: string) => () => { navigate(path); setOpen(false); };
    const nav: Cmd[] = [
      { id: "dash", label: tr("nav_dashboard"), hint: "/", run: go("/"), keywords: "command center home" },
      { id: "brain", label: tr("nav_brain"), hint: "/brain", run: go("/brain"), keywords: "ai cmo adviser brief consult" },
      { id: "analytics", label: tr("nav_analytics"), hint: "/analytics", run: go("/analytics"), keywords: "kpi metrics funnel" },
      { id: "planning", label: tr("nav_planning"), hint: "/planning", run: go("/planning"), keywords: "objectives okr strategy" },
      { id: "camp", label: tr("nav_campaigns"), hint: "/campaigns", run: go("/campaigns") },
      { id: "cal", label: tr("nav_calendar"), hint: "/calendar", run: go("/calendar"), keywords: "content" },
      { id: "leads", label: tr("nav_leads"), hint: "/leads", run: go("/leads"), keywords: "pipeline" },
      { id: "events", label: tr("nav_events"), hint: "/events", run: go("/events"), keywords: "btl" },
      { id: "budget", label: tr("nav_budget"), hint: "/budget", run: go("/budget"), keywords: "money spend" },
      { id: "tasks", label: tr("nav_tasks"), hint: "/tasks", run: go("/tasks") },
      { id: "social", label: tr("nav_social"), hint: "/social", run: go("/social") },
      { id: "listening", label: tr("nav_listening"), hint: "/listening", run: go("/listening"), keywords: "monitoring sov mentions" },
      { id: "intel", label: tr("nav_intel"), hint: "/intel", run: go("/intel"), keywords: "osint market" },
    ];
    if (user?.role === "HEAD") {
      nav.push({ id: "users", label: tr("nav_users"), hint: "/users", run: go("/users") });
      nav.push({ id: "settings", label: tr("nav_settings"), hint: "/settings", run: go("/settings") });
    }
    nav.push({ id: "lang", label: lang === "ar" ? "English" : "العربية", hint: "⇄", run: () => { toggle(); setOpen(false); }, keywords: "language لغة" });
    return nav;
  }, [navigate, tr, lang, user, toggle]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + " " + (c.keywords || "") + " " + c.hint).toLowerCase().includes(s));
  }, [q, commands]);

  // Global open: Cmd/Ctrl+K, or a window event from the topbar button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onEvt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("helm:command", onEvt as EventListener);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("helm:command", onEvt as EventListener); };
  }, []);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); results[active]?.run(); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={tr("cmd_title")}>
      <div className="absolute inset-0 bg-ink-950/55 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
      <div className="card relative z-10 w-full max-w-lg overflow-hidden p-0 shadow-overlay animate-scale-in" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 border-b border-paper-200 px-4">
          <svg className="h-4 w-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("cmd_placeholder")}
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-500"
          />
          <kbd className="rounded border border-paper-300 px-1.5 py-0.5 text-[10px] text-ink-500">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-500">{tr("noData")}</li>}
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => c.run()}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start text-sm ${i === active ? "bg-amber-500/12 text-amber-700" : "text-ink-700 hover:bg-paper-100"}`}
              >
                <span className="font-medium">{c.label}</span>
                <span className="font-mono text-[11px] text-ink-400" dir="ltr">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-paper-200 px-4 py-2 text-[11px] text-ink-500">
          <span>↑↓ {tr("cmd_navigate")} · ⏎ {tr("cmd_open")}</span>
          <span className="font-mono">{t.langToggle[lang] === "EN" ? "⌘K" : "⌘K"}</span>
        </div>
      </div>
    </div>
  );
}
