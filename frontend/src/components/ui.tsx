import { ReactNode, useEffect, useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { fmtMoney } from "../lib/format";

// ── Data hook ────────────────────────────────────────────────────────
export function useFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

// ── Card ─────────────────────────────────────────────────────────────
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-ink-700 tracking-wide uppercase">{children}</h2>
      {action}
    </div>
  );
}

// ── Status pill with semantic colour ─────────────────────────────────
const TONE: Record<string, string> = {
  POS: "bg-moss-500/12 text-moss-600",
  NEG: "bg-clay-500/12 text-clay-600",
  NEU: "bg-ink-500/10 text-ink-500",
  ACTIVE: "bg-moss-500/12 text-moss-600",
  RUNNING: "bg-moss-500/12 text-moss-600",
  CONFIRMED: "bg-moss-500/12 text-moss-600",
  APPROVED: "bg-moss-500/12 text-moss-600",
  PUBLISHED: "bg-moss-500/12 text-moss-600",
  WON: "bg-moss-500/15 text-moss-600",
  DONE: "bg-ink-500/10 text-ink-500",
  COMPLETED: "bg-ink-500/10 text-ink-500",
  PLANNING: "bg-steel-500/12 text-steel-600",
  PLANNED: "bg-steel-500/12 text-steel-600",
  NEW: "bg-steel-500/12 text-steel-600",
  QUALIFIED: "bg-steel-500/12 text-steel-600",
  REVIEW: "bg-amber-500/15 text-amber-700",
  IN_PROGRESS: "bg-amber-500/15 text-amber-700",
  DOING: "bg-amber-500/15 text-amber-700",
  PROPOSAL: "bg-amber-500/15 text-amber-700",
  NEGOTIATION: "bg-amber-500/15 text-amber-700",
  PAUSED: "bg-clay-500/12 text-clay-600",
  LOST: "bg-clay-500/12 text-clay-600",
  CANCELLED: "bg-clay-500/12 text-clay-600",
  HIGH: "bg-clay-500/12 text-clay-600",
  MEDIUM: "bg-amber-500/15 text-amber-700",
  LOW: "bg-ink-500/10 text-ink-500",
  IDEA: "bg-ink-500/10 text-ink-500",
  TODO: "bg-ink-500/10 text-ink-500",
};

export function StatusPill({ value }: { value?: string | null }) {
  const { el } = useI18n();
  if (!value) return null;
  return <span className={`pill ${TONE[value] || "bg-ink-500/10 text-ink-500"}`}>{el(value)}</span>;
}

// ── Form field wrappers ──────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Modal (accessible: focus trap, Escape, restore focus, ARIA) ──────
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        );
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    }, 30);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink-950/55 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div ref={panelRef} className="card relative z-10 w-full max-w-lg overflow-hidden rounded-b-none p-0 shadow-overlay animate-scale-in sm:rounded-b-xl2">
        <div className="flex items-center justify-between border-b border-paper-200 px-5 py-3.5">
          <h3 className="font-semibold text-ink-800">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-paper-100 hover:text-ink-800 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="max-h-[72dvh] space-y-4 overflow-y-auto p-4 sm:max-h-[70vh] sm:p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-paper-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-5 sm:py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

// ── Skeleton loaders ─────────────────────────────────────────────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-5 ${c === 0 ? "flex-[2]" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

// ── Money (currency-aware, tabular figures, dual display) ────────────
export function Money({ usd, sdg, size = "md" }: { usd: number; sdg?: number; size?: "sm" | "md" | "lg" }) {
  const { lang } = useI18n();
  const big = size === "lg" ? "text-h2" : size === "sm" ? "text-xs" : "text-sm";
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={`kpi-num ${big} text-ink-800`}>{fmtMoney(usd, "USD", lang)}</span>
      {sdg !== undefined && <span className="text-xs text-ink-500">{fmtMoney(sdg, "SDG", lang)}</span>}
    </span>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
export function Empty({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-sm text-ink-500">
      <div className="mx-auto mb-2 h-8 w-8 rounded-full border-2 border-dashed border-paper-300" />
      {text}
    </div>
  );
}
