import { useState } from "react";
import { useFetch, Card, SectionTitle, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";

// ═══ SYSTEM (Wave 3·A) ═══════════════════════════════════════════════
// The screen that answers "is it healthy, and what broke?" — so nobody
// needs shell access to the host to find out.

interface Health {
  ok: boolean; at: string;
  checks: Record<string, { ok: boolean; [k: string]: unknown }>;
}
interface Group {
  fingerprint: string; level: string; route?: string; method?: string;
  message: string; count: number; lastSeen: string; firstSeen: string;
}
interface Occurrence {
  at: string; level: string; route?: string; method?: string; status?: number;
  message: string; stack?: string; requestId?: string; userName?: string; payloadDigest?: string;
}
interface Activity {
  integrations: { platform: string; kind: string; status: string; detail?: string; at: string }[];
  mail: { to: string; subject?: string; status: string; error?: string; at: string }[];
  digests: { channel: string; status: string; at: string }[];
}

const ago = (iso: string, tr: (k: string) => string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return tr("sy_now");
  if (h < 24) return `${h}${tr("sy_h")}`;
  return `${Math.round(h / 24)}${tr("sy_d")}`;
};

export default function System() {
  const { tr } = useI18n();
  const health = useFetch<Health>("/system/health");
  const errors = useFetch<{ retainDays: number; groups: Group[] }>("/system/errors");
  const activity = useFetch<Activity>("/system/activity");
  const [open, setOpen] = useState<Group | null>(null);
  const [rows, setRows] = useState<Occurrence[] | null>(null);
  // SEC·D — evidence on demand: chain verification + live access review.
  const [chain, setChain] = useState<{ ok: boolean; checked: number; legacyRows: number; firstBreakSeq: number | null } | null>(null);
  const [chainErr, setChainErr] = useState("");
  const review = useFetch<{
    dormantAfterDays: number;
    summary: { total: number; active: number; admins: number; dormant: number };
    users: { id: string; name: string; role: string; active: boolean; isAdmin: boolean; lastLoginAt: string | null; dormant: boolean }[];
  }>("/security/access-review");

  const verifyChain = async () => {
    setChainErr(""); setChain(null);
    try { setChain(await api.get("/security/audit-verify")); }
    catch (e) { setChainErr((e as Error).message); }
  };

  const expand = async (g: Group) => {
    setOpen(g); setRows(null);
    setRows(await api.get<Occurrence[]>(`/system/errors/${g.fingerprint}`));
  };

  const dot = (ok: boolean) => (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-moss-500" : "bg-clay-500"}`} />
  );

  const detail = (k: string, v: Record<string, unknown>) => {
    if (k === "dailyPulse") return v.lastRun ? `${v.lastRun} (${v.ageDays}${tr("sy_d")})` : tr("sy_never");
    if (k === "connectors") return `${v.failures24h} ${tr("sy_fails")}`;
    if (k === "errors") return `${v.last24h} ${tr("sy_faults")}`;
    if (k === "storage") return `${v.driver} · ${v.files} ${tr("lib_files")}`;
    if (k === "mail") return `${v.failures24h} ${tr("sy_fails")}`;
    if (k === "publishTick") return v.hoursAgo != null ? `${v.hoursAgo}${tr("sy_h")}` : tr("sy_never");
    return v.ok ? tr("sy_ok") : tr("sy_bad");
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-ink-900">{tr("sy_title")}</h1>
        <p className="text-sm text-ink-500">{tr("sy_sub")}</p>
      </div>

      {/* ── health ── */}
      {!health.data ? <SkeletonCards count={1} /> : (
        <Card className={health.data.ok ? "" : "border-clay-500/40"}>
          <SectionTitle>
            {health.data.ok ? `✓ ${tr("sy_healthy")}` : `⚠ ${tr("sy_unhealthy")}`}
          </SectionTitle>
          <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {Object.entries(health.data.checks).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-ink-700">{dot(v.ok)} {tr(`sy_c_${k}`)}</span>
                <span className="kpi-num truncate text-ink-500" dir="ltr">{detail(k, v)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── faults, grouped ── */}
      <Card>
        <SectionTitle>{tr("sy_errors")}</SectionTitle>
        <p className="-mt-1 mb-2 text-sm text-ink-500">
          {tr("sy_errSub")} {errors.data ? `· ${tr("sy_retain")} ${errors.data.retainDays}${tr("sy_d")}` : ""}
        </p>
        {!errors.data ? <p className="text-sm text-ink-400">…</p>
          : !errors.data.groups.length ? <p className="text-sm text-ink-400">{tr("sy_noErrors")}</p> : (
            <div className="space-y-1">
              {errors.data.groups.map((g) => (
                <button key={g.fingerprint + g.route} onClick={() => expand(g)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-paper-100">
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-ink-800">{g.message}</span>
                    <span className="kpi-num block truncate text-[10px] text-ink-400" dir="ltr">
                      {g.level === "CLIENT" ? "🌐" : "🖥"} {g.method} {g.route}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px]" dir="ltr">
                    <span className="kpi-num rounded-full bg-clay-100 px-1.5 py-0.5 font-bold text-clay-700">×{g.count}</span>
                    <span className="text-ink-400">{ago(g.lastSeen, tr)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
      </Card>

      {/* ── the gathered feeds ── */}
      {activity.data && (
        <Card>
          <SectionTitle>{tr("sy_activity")}</SectionTitle>
          <div className="mt-2 grid gap-4 md:grid-cols-3">
            {([
              ["sy_a_int", activity.data.integrations.map((r) => ({ ok: r.status === "OK", label: `${r.platform} · ${r.kind}`, at: r.at }))],
              ["sy_a_mail", activity.data.mail.map((r) => ({ ok: r.status !== "FAILED", label: r.subject || r.to, at: r.at }))],
              ["sy_a_digest", activity.data.digests.map((r) => ({ ok: r.status !== "FAILED", label: r.channel, at: r.at }))],
            ] as const).map(([key, list]) => (
              <div key={key}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr(key)}</div>
                {!list.length ? <p className="mt-1 text-[11px] text-ink-400">{tr("cn_noRuns")}</p> : (
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 8).map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5">{dot(r.ok)}
                          <span className="truncate text-ink-600" dir="ltr">{r.label}</span></span>
                        <span className="shrink-0 text-[10px] text-ink-400" dir="ltr">{ago(r.at, tr)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {open && (
        <Modal open title={open.message} onClose={() => setOpen(null)}>
          <div className="space-y-2">
            <div className="kpi-num text-[11px] text-ink-500" dir="ltr">{open.method} {open.route}</div>
            {!rows ? <p className="text-sm text-ink-400">…</p> : rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-paper-200 p-2.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-500" dir="ltr">
                  <span>{String(r.at).slice(0, 16).replace("T", " ")}</span>
                  {r.requestId && <code className="kpi-num text-[10px]">{r.requestId}</code>}
                </div>
                {r.userName && <div className="text-[11px] text-ink-600">{r.userName}</div>}
                {r.payloadDigest && (
                  <div className="kpi-num mt-1 truncate text-[10px] text-ink-400" dir="ltr" title={tr("sy_digestHint")}>
                    {r.payloadDigest}
                  </div>
                )}
                {r.stack && (
                  <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-paper-100 p-2 text-[10px] leading-relaxed text-ink-600" dir="ltr">
                    {r.stack.split("\n").slice(0, 8).join("\n")}
                  </pre>
                )}
              </div>
            ))}
            <p className="text-[10px] text-ink-400">{tr("sy_digestHint")}</p>
          </div>
        </Modal>
      )}
      {/* ── SEC·D — SOC 2 evidence on demand ── */}
      <Card>
        <SectionTitle action={
          <button onClick={verifyChain} className="btn-ghost text-xs">🔗 {tr("sec_verify")}</button>
        }>🛡 {tr("sec_title")}</SectionTitle>
        {chainErr && <p className="text-xs text-clay-600">{chainErr}</p>}
        {chain && (
          <p className={`text-sm ${chain.ok ? "text-moss-700" : "font-semibold text-clay-600"}`} dir="auto">
            {chain.ok ? `✓ ${tr("sec_intact")}` : `✕ ${tr("sec_break")} #${chain.firstBreakSeq}`}
            <span className="ms-2 text-[11px] text-ink-500" dir="ltr">
              {chain.checked} {tr("sec_rows")}{chain.legacyRows > 0 ? ` · ${chain.legacyRows} ${tr("sec_legacy")}` : ""}
            </span>
          </p>
        )}
        {review.data && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-3 text-[11px] text-ink-500" dir="ltr">
              <span>{review.data.summary.active}/{review.data.summary.total} {tr("sec_active")}</span>
              <span>{review.data.summary.admins} {tr("sec_admins")}</span>
              <span className={review.data.summary.dormant > 0 ? "font-medium text-amber-700" : ""}>
                {review.data.summary.dormant} {tr("sec_dormant")} ({review.data.dormantAfterDays}d)
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {review.data.users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${u.active ? "bg-moss-500" : "bg-ink-300"}`} />
                    <span className="truncate text-ink-700">{u.name}</span>
                    <span className="text-[10px] text-ink-400" dir="ltr">{u.role}</span>
                    {u.isAdmin && <span className="rounded-full bg-ink-900 px-1.5 py-0.5 text-[9px] font-bold text-paper-50">ADMIN</span>}
                    {u.dormant && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">{tr("sec_dormantBadge")}</span>}
                  </span>
                  <span className="kpi-num text-[10px] text-ink-400" dir="ltr">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 10) : tr("sec_neverLogin")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
