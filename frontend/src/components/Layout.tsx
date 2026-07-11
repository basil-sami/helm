import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { t } from "../locales/dict";
import { api } from "../lib/api";
import { fmtNum } from "../lib/format";
import CommandPalette from "./CommandPalette";
import NotificationsBell from "./NotificationsBell";
import SecurityModal from "./SecurityModal";

const NAV: { to: string; key: string; icon: string; mod?: string }[] = [
  { to: "/", key: "nav_dashboard", icon: "grid" },
  { to: "/brain", key: "nav_brain", icon: "brain", mod: "brain" },
  { to: "/analytics", key: "nav_analytics", icon: "chart", mod: "analytics" },
  { to: "/planning", key: "nav_planning", icon: "compass", mod: "planning" },
  { to: "/campaigns", key: "nav_campaigns", icon: "target", mod: "campaigns" },
  { to: "/products", key: "nav_products", icon: "box", mod: "campaigns" },
  { to: "/audience", key: "nav_audience", icon: "persona", mod: "campaigns" },
  { to: "/links", key: "nav_links", icon: "link", mod: "campaigns" },
  { to: "/calendar", key: "nav_calendar", icon: "calendar" },
  { to: "/leads", key: "nav_leads", icon: "users", mod: "leads" },
  { to: "/customers", key: "nav_customers", icon: "handshake", mod: "leads" },
  { to: "/events", key: "nav_events", icon: "flag", mod: "events" },
  { to: "/budget", key: "nav_budget", icon: "coins", mod: "budget" },
  { to: "/tasks", key: "nav_tasks", icon: "check", mod: "tasks" },
  { to: "/social", key: "nav_social", icon: "share", mod: "social" },
  { to: "/media", key: "nav_media", icon: "megaphone", mod: "social" },
  { to: "/listening", key: "nav_listening", icon: "pulse", mod: "__listening" },
  { to: "/intel", key: "nav_intel", icon: "radar", mod: "intel" },
];

function Icon({ name }: { name: string }) {
  const common = "h-[18px] w-[18px]";
  switch (name) {
    case "box":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>);
    case "persona":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></svg>);
    case "link":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 14a5 5 0 007.07 0l2.12-2.12a5 5 0 00-7.07-7.07L11 5.93"/><path d="M14 10a5 5 0 00-7.07 0L4.8 12.12a5 5 0 007.07 7.07L13 18.07"/></svg>);
    case "handshake":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10l4-4 5 2 5-2 4 4-3 8H6l-3-8z"/><path d="M12 8v6"/></svg>);
    case "megaphone":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l14-6v14L3 13v-2z"/><path d="M17 8a4 4 0 010 8M7 13v5a2 2 0 004 0v-4"/></svg>);
    case "grid":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>);
    case "target":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>);
    case "calendar":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>);
    case "users":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M20.5 19a5 5 0 0 0-3.5-4.8"/></svg>);
    case "flag":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 21V4M5 4h11l-1.5 3L16 10H5"/></svg>);
    case "coins":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>);
    case "check":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12.5l5 5L20 6"/></svg>);
    case "share":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>);
    case "shield":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>);
    case "radar":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-3.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>);
    case "chart":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5" rx="0.5"/><rect x="12" y="8" width="3" height="8" rx="0.5"/><rect x="17" y="13" width="3" height="3" rx="0.5"/></svg>);
    case "compass":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none"/></svg>);
    case "pulse":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>);
    case "brain":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 4a3 3 0 00-3 3 2.5 2.5 0 00-1 4.7V14a2.5 2.5 0 002.5 2.5H12"/><path d="M12 4a3 3 0 013 3 2.5 2.5 0 011 4.7V14a2.5 2.5 0 01-2.5 2.5H12"/><path d="M12 7v10"/></svg>);
    default:
      return null;
  }
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can, isAdmin } = useAuth();
  const [secOpen, setSecOpen] = useState(false);
  const { lang, tr, toggle, el } = useI18n();
  const loc = useLocation();
  const visible = NAV.filter((i) => {
    if (!i.mod) return true;
    if (i.mod === "__listening") return can("intel", "read") || can("social", "read");
    return can(i.mod, "read");
  });
  const nav = isAdmin
    ? [...visible, { to: "/users", key: "nav_users", icon: "shield" }, { to: "/settings", key: "nav_settings", icon: "grid" }]
    : visible;
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  const preferred = ["/calendar", "/tasks", "/leads", "/listening", "/campaigns"];
  const tabs = [nav[0], ...preferred.map((p) => nav.find((n) => n.to === p)).filter(Boolean).slice(0, 3)] as typeof nav;
  const isActive = (to: string) => (to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to));

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* Command rail */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gradient-to-b from-ink-950 to-[#111726] text-paper shadow-rail">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500 text-lg font-bold text-ink-950">ح</div>
          <div className="leading-tight">
            <div className="font-bold tracking-wide">{tr("appName")}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-paper-200/50">{tr("appTagline")}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {nav.map((item) => {
            const active = item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
            return (
              <NavLink key={item.to} to={item.to} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                <Icon name={item.icon} />
                <span>{tr(item.key)}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/5 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm font-semibold">
              {user?.name?.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{user?.name}</div>
              <div className="truncate text-[11px] text-amber-400">{el(user?.role)}</div>
            </div>
          </div>
          <button onClick={() => setSecOpen(true)} className="mt-1 w-full rounded-lg px-3 py-2 text-start text-sm text-paper-200/70 hover:bg-white/5 hover:text-white">
            🔐 {tr("sec_title")}
          </button>
          <button onClick={logout} className="mt-1 w-full rounded-lg px-3 py-2 text-start text-sm text-paper-200/70 hover:bg-white/5 hover:text-white">
            {tr("signOut")}
          </button>
        </div>
      </aside>

      {/* Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-paper-200 bg-white/70 px-4 backdrop-blur md:px-6">
          <div className="text-sm text-ink-500">
            <span className="font-medium text-ink-800">
              {tr(nav.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.key || "nav_dashboard")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RateIndicator />
            <NotificationsBell />
            <button
              onClick={() => window.dispatchEvent(new Event("helm:command"))}
              className="hidden items-center gap-2 rounded-lg border border-paper-300 bg-white px-2.5 py-1.5 text-xs text-ink-500 hover:bg-paper-100 sm:flex"
              title={tr("cmd_title")}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              <span>{tr("cmd_placeholder")}</span>
              <kbd className="rounded border border-paper-300 px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </button>
            <button
              onClick={toggle}
              className="grid h-9 w-9 place-items-center rounded-lg border border-paper-300 bg-white text-sm font-semibold text-ink-700 hover:bg-paper-100"
              title={lang === "ar" ? "English" : "العربية"}
            >
              {t.langToggle[lang]}
            </button>
            <button onClick={() => setDrawer(true)} aria-label="Menu"
              className="grid h-9 w-9 place-items-center rounded-lg border border-paper-300 bg-white text-ink-700 md:hidden">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-grid">
          <div className="mx-auto max-w-7xl px-4 py-5 pb-24 md:px-6 md:py-6 md:pb-6">{children}</div>
        </main>
      </div>
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-gradient-to-b from-ink-950 to-[#111726] text-paper shadow-rail">
            <div className="flex h-16 items-center gap-3 border-b border-white/5 px-5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500 font-mono font-bold text-ink-950">ح</div>
              <div className="leading-tight">
                <div className="font-bold tracking-wide">{tr("appName")}</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-paper-200/50">{tr("appTagline")}</div>
              </div>
              <button onClick={() => setDrawer(false)} className="ms-auto grid h-8 w-8 place-items-center rounded-lg text-paper-200/70 hover:bg-white/10" aria-label="Close">✕</button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {nav.map((item) => (
                <NavLink key={item.to} to={item.to} className={`nav-link ${isActive(item.to) ? "nav-link-active" : ""}`}>
                  <Icon name={item.icon} />
                  <span>{tr(item.key)}</span>
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-white/5 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
              <div className="flex items-center gap-3 px-2 py-1.5">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm font-semibold">{user?.name?.slice(0, 1)}</div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-medium">{user?.name}</div>
                  <div className="truncate text-[11px] text-amber-400">{el(user?.role)}</div>
                </div>
              </div>
              <button onClick={() => setSecOpen(true)} className="mt-1 w-full rounded-lg px-3 py-2 text-start text-sm text-paper-200/70 hover:bg-white/5 hover:text-white">
            🔐 {tr("sec_title")}
          </button>
          <button onClick={logout} className="mt-1 w-full rounded-lg px-3 py-2 text-start text-sm text-paper-200/70 hover:bg-white/5 hover:text-white">
                {tr("signOut")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-paper-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {tabs.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive(item.to) ? "text-amber-600" : "text-ink-400"}`}>
              <Icon name={item.icon} />
              <span className="max-w-full truncate px-1">{tr(item.key)}</span>
            </NavLink>
          ))}
          <button onClick={() => setDrawer(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-ink-400">
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            <span>{lang === "ar" ? "المزيد" : "More"}</span>
          </button>
        </div>
      </nav>

      <SecurityModal open={secOpen} onClose={() => setSecOpen(false)} />
      <CommandPalette />
    </div>
  );
}

function RateIndicator() {
  const { lang } = useI18n();
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => { api.get<{ usdToSdgRate: number }>("/settings").then((s) => setRate(Number(s.usdToSdgRate))).catch(() => {}); }, []);
  if (!rate) return null;
  return (
    <div className="hidden items-center gap-1.5 rounded-lg bg-paper-200 px-2.5 py-1.5 text-xs text-ink-600 md:flex" title={lang === "ar" ? "سعر الصرف" : "Exchange rate"}>
      <span className="h-1.5 w-1.5 rounded-full bg-moss-500" />
      <span className="font-mono tnum">1$ = {fmtNum(rate, lang)}</span>
    </div>
  );
}
