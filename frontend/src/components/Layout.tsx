import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { t } from "../locales/dict";
import { api } from "../lib/api";
import { fmtNum } from "../lib/format";
import { useBranding } from "../context/BrandingContext";
import PulseMark, { EcgGlyph } from "./PulseMark";
import CommandPalette from "./CommandPalette";
import NotificationsBell from "./NotificationsBell";
import SecurityModal from "./SecurityModal";

type NavItem = { to: string; key: string; icon: string; mod?: string; flag?: string };
// W4·NAV — seven groups, nothing lost, one thing found: /report had no
// menu entry at all until this registry. Filtering rules are unchanged
// (module flags + permissions); a group whose items are all hidden
// disappears whole.
const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  { key: "navg_day", items: [
    { to: "/", key: "nav_dashboard", icon: "grid" },
    { to: "/morning", key: "nav_morning", icon: "sun" },
    { to: "/tasks", key: "nav_tasks", icon: "check", mod: "tasks" },
    { to: "/approvals", key: "nav_approvals", icon: "stamp" },
    { to: "/operations", key: "nav_operations", icon: "zap", mod: "__operations" },
    { to: "/inbox", key: "nav_inbox", icon: "tray", mod: "social", flag: "social" },
  ]},
  { key: "navg_plan", items: [
    { to: "/planning", key: "nav_planning", icon: "compass", mod: "planning", flag: "planning" },
    { to: "/growth", key: "nav_growth", icon: "sprout", mod: "planning", flag: "planning" },
    { to: "/campaigns", key: "nav_campaigns", icon: "target", mod: "campaigns" },
    { to: "/calendar", key: "nav_calendar", icon: "calendar" },
    { to: "/events", key: "nav_events", icon: "flag", mod: "events", flag: "events" },
    { to: "/budget", key: "nav_budget", icon: "coins", mod: "budget" },
    { to: "/media-plans", key: "nav_mediaplans", icon: "qr", mod: "media", flag: "media" },
    { to: "/playbooks", key: "nav_playbooks", icon: "scroll", mod: "brain", flag: "brain" },
    { to: "/audience", key: "nav_audience", icon: "persona", mod: "campaigns" },
    { to: "/products", key: "nav_products", icon: "box", mod: "campaigns" },
  ]},
  { key: "navg_create", items: [
    { to: "/publish", key: "nav_publish", icon: "send", mod: "publish", flag: "publish" },
    { to: "/studio", key: "nav_studio", icon: "palette", mod: "studio", flag: "studio" },
    { to: "/library", key: "nav_library", icon: "folder", mod: "content" },
    { to: "/social", key: "nav_social", icon: "share", mod: "social", flag: "social" },
    { to: "/links", key: "nav_links", icon: "link", mod: "campaigns" },
  ]},
  { key: "navg_capture", items: [
    { to: "/forms", key: "nav_forms", icon: "form", mod: "automate", flag: "automate" },
    { to: "/pages", key: "nav_pages", icon: "layout", mod: "automate", flag: "automate" },
    { to: "/surveys", key: "nav_surveys", icon: "poll", mod: "research", flag: "research" },
    { to: "/automate", key: "nav_automate", icon: "zap", mod: "automate", flag: "automate" },
    { to: "/leads", key: "nav_leads", icon: "users", mod: "leads" },
    { to: "/customers", key: "nav_customers", icon: "handshake", mod: "leads" },
    { to: "/contacts", key: "nav_contacts", icon: "book", mod: "leads" },
  ]},
  { key: "navg_insight", items: [
    { to: "/analytics", key: "nav_analytics", icon: "chart", mod: "analytics" },
    { to: "/report", key: "nav_report", icon: "doc", mod: "analytics" },
    { to: "/web", key: "nav_web", icon: "globe", mod: "intel", flag: "intel" },
    { to: "/listening", key: "nav_listening", icon: "pulse", mod: "__listening", flag: "listening" },
    { to: "/listening-control", key: "nav_listening_control", icon: "pulse-line", mod: "intel", flag: "listening" },
    { to: "/intel", key: "nav_intel", icon: "radar", mod: "intel", flag: "intel" },
    { to: "/brain", key: "nav_brain", icon: "brain", mod: "brain", flag: "brain" },
  ]},
  { key: "navg_partners", items: [
    { to: "/agency", key: "nav_agency", icon: "briefcase", mod: "agency", flag: "agency" },
    { to: "/media", key: "nav_media", icon: "megaphone", mod: "social", flag: "media" },
    { to: "/reach", key: "nav_reach", icon: "wave", mod: "reach", flag: "reach" },
  ]},
];
// Kept for the mobile tab bar and any flat consumers.
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function Icon({ name }: { name: string }) {
  const common = "h-[18px] w-[18px]";
  switch (name) {
    case "wave":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12h3l2-7 4 14 3-10 2 5 2-2h4"/></svg>);
    case "zap":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>);
    case "send":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7z"/></svg>);
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
    case "pulse-line":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 3.5 14 3-9 2 2h5"/></svg>);
    case "folder":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><circle cx="9.5" cy="12.5" r="1.5"/><path d="M4 18l4.5-4 3 2.5L15 13l5 5"/></svg>);
    case "sun":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>);
    case "sprout":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 4-3 7-8 7z"/><path d="M12 13c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z"/></svg>);
    case "scroll":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4z"/><path d="M6 4a2 2 0 1 0 0 4h2"/><path d="M11 9h5M11 13h5"/></svg>);
    case "tray":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v14H4z"/><path d="M4 13h5l1.5 2.5h3L15 13h5"/></svg>);
    case "qr":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2v2M14 21h2"/></svg>);
    case "globe":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>);
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
    case "doc":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4M9 12h6M9 16h6"/></svg>);
    case "shield":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>);
    case "book":
      return <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 7h8M8 11h8" />;
    case "form":
      return <path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5h8M8 12h8M8 16h4" />;
    case "layout":
      return <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm0 5h16M10 10v10" />;
    case "poll":
      return <path d="M6 20V10M12 20V4M18 20v-6" />;
    case "radar":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-3.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>);
    case "palette":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-.7-.3-1.1-.3-1.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 004-4c0-5-4-9-9-9z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor"/></svg>);
    case "briefcase":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5"/><path d="M3.5 12.5h17"/></svg>);
    case "stamp":
      return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 20h14"/><path d="M6.5 16.5h11a1 1 0 001-1v-1a2 2 0 00-2-2h-2.6c-.6 0-1-.5-.9-1.1l.6-3.4a2.6 2.6 0 10-5.2 0l.6 3.4c.1.6-.3 1.1-.9 1.1H7.5a2 2 0 00-2 2v1a1 1 0 001 1z"/></svg>);
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
  const { branding, moduleOn } = useBranding();
  const [secOpen, setSecOpen] = useState(false);
  const { lang, tr, toggle, el } = useI18n();
  const loc = useLocation();
  const orgLabel = (lang === "ar" ? branding.orgNameAr || branding.orgName : branding.orgName) || tr("appName");
  const itemVisible = (i: NavItem) => {
    if (i.flag && !moduleOn(i.flag)) return false; // client's plan hides the territory
    if (!i.mod) return true;
    if (i.mod === "__listening") return can("intel", "read") || can("social", "read");
    if (i.mod === "__operations") return can("leads", "read") || can("campaigns", "read") || can("content", "read");
    if (i.mod === "__governance") return isAdmin || can("leads", "read");
    return can(i.mod, "read");
  };
  const groups = NAV_GROUPS
    .map((g) => ({ key: g.key, items: g.items.filter(itemVisible) }))
    .filter((g) => g.items.length > 0);
  if (isAdmin) {
    groups.push({ key: "navg_admin", items: [
      { to: "/users", key: "nav_users", icon: "shield" },
      { to: "/system", key: "nav_system", icon: "pulse-line" },
      { to: "/settings", key: "nav_settings", icon: "grid" },
      { to: "/governance", key: "nav_governance", icon: "shield", mod: "__governance" },
    ]});
  }
  const nav = groups.flatMap((g) => g.items);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  const preferred = ["/calendar", "/tasks", "/leads", "/listening", "/campaigns"];
  const tabs = [nav[0], ...preferred.map((p) => nav.find((n) => n.to === p)).filter(Boolean).slice(0, 3)] as typeof nav;
  const isActive = (to: string) => (to === "/" ? loc.pathname === "/" : loc.pathname === to || loc.pathname.startsWith(`${to}/`));

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* Command rail */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gradient-to-b from-ink-950 to-[#111726] text-paper shadow-rail">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/5">
          <PulseMark size={36} logoUrl={branding.logoUrl} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-bold tracking-wide">{orgLabel}</div>
            <div className="truncate text-[10px] uppercase tracking-[0.18em] text-paper-200/50">{tr("appTagline")}</div>
          </div>
        </div>

<nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-paper-200/40">
                {tr(g.key)}
              </div>
              <div className="space-y-1">
                {g.items.map((item) => {
                  const active = item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
                  return (
                    <NavLink key={item.to} to={item.to} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                      <Icon name={item.icon} />
                      <span>{tr(item.key)}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] tracking-wide text-paper-200/40">
            <EcgGlyph className="h-3 w-3 text-amber-500/70" strokeWidth={2.4} />
            <span>{tr("poweredBy")}</span>
          </div>
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
              {tr(nav.find((n) => isActive(n.to))?.key || "nav_dashboard")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RateIndicator />
            <NotificationsBell />
            <button
              onClick={() => window.dispatchEvent(new Event("pulse:command"))}
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
              <PulseMark size={36} logoUrl={branding.logoUrl} />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-bold tracking-wide">{orgLabel}</div>
                <div className="truncate text-[10px] uppercase tracking-[0.18em] text-paper-200/50">{tr("appTagline")}</div>
              </div>
              <button onClick={() => setDrawer(false)} className="ms-auto grid h-8 w-8 place-items-center rounded-lg text-paper-200/70 hover:bg-white/10" aria-label="Close">✕</button>
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-paper-200/40">
                    {tr(g.key)}
                  </div>
                  <div className="space-y-1">
                    {g.items.map((item) => (
                      <NavLink key={item.to} to={item.to} className={`nav-link ${isActive(item.to) ? "nav-link-active" : ""}`}>
                        <Icon name={item.icon} />
                        <span>{tr(item.key)}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
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
