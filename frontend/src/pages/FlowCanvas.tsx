import { useState } from "react";
import { Modal } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";

// ═══ FLOW CANVAS (Wave 3·B) ══════════════════════════════════════════
// A drawing surface over the workflow engine that already exists. Every
// node here serialises straight back into `workflows.actions` — the same
// jsonb the runner has always read. There is no second execution path,
// and there must never be one: the flow you draw is the flow that runs.

export type Node =
  | { type: "IF"; cond: { field: string; op: string; value?: string }; then: Node[]; else: Node[] }
  | { type: string; [k: string]: unknown };

export interface Library { events: string[]; actions: string[]; branchOps: string[]; branchFields: string[] }
interface DryLog { action: string; ok: boolean; branch?: string; detail: string; dryRun?: boolean }

const GLYPH: Record<string, string> = {
  ASSIGN_OWNER: "👤", ADD_TAG: "🏷", CREATE_TASK: "✓", START_PROCESS: "▦",
  NOTIFY: "🔔", SEND_WA_DRAFT: "💬", IF: "◆",
};

/** One node's own summary, in the reader's language — not a JSON dump. */
function summarise(n: Node, tr: (k: string) => string): string {
  const a = n as Record<string, unknown>;
  switch (n.type) {
    case "ASSIGN_OWNER": return `${tr("fb_s_assign")}`;
    case "ADD_TAG": return `${tr("fb_s_tag")}: ${a.tag || "—"}`;
    case "CREATE_TASK": return `${tr("fb_s_task")}: ${a.title || "—"}`;
    case "NOTIFY": return `${tr("fb_s_notify")}: ${a.message || "—"}`;
    case "START_PROCESS": return tr("fb_s_process");
    case "SEND_WA_DRAFT": return tr("fb_s_wa");
    default: return n.type;
  }
}

// ── immutable edits into a nested tree, addressed by path ────────────
const atPath = (nodes: Node[], path: number[]): Node[] => {
  if (!path.length) return nodes;
  const [head, branch, ...rest] = path;
  const node = nodes[head] as { then: Node[]; else: Node[] };
  return atPath(branch === 0 ? node.then : node.else, rest);
};

function editTree(nodes: Node[], path: number[], fn: (list: Node[]) => Node[]): Node[] {
  if (!path.length) return fn(nodes);
  const [head, branch, ...rest] = path;
  return nodes.map((n, i) => {
    if (i !== head || n.type !== "IF") return n;
    const b = n as Extract<Node, { type: "IF" }>;
    return branch === 0
      ? { ...b, then: editTree(b.then, rest, fn) }
      : { ...b, else: editTree(b.else, rest, fn) };
  });
}

export default function FlowCanvas({
  value, onChange, library, leadId,
}: {
  value: Node[]; onChange: (n: Node[]) => void; library: Library | null; leadId?: string;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const [adding, setAdding] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<{ path: number[]; index: number; node: Node } | null>(null);
  const [dry, setDry] = useState<{ log: DryLog[]; lead: { company?: string } } | null>(null);
  const [running, setRunning] = useState(false);

  const add = (path: number[], node: Node) => {
    onChange(editTree(value, path, (list) => [...list, node]));
    setAdding(null);
  };
  const removeAt = (path: number[], i: number) =>
    onChange(editTree(value, path, (list) => list.filter((_, j) => j !== i)));
  const replaceAt = (path: number[], i: number, node: Node) =>
    onChange(editTree(value, path, (list) => list.map((n, j) => (j === i ? node : n))));

  const tryIt = async () => {
    setRunning(true);
    try {
      setDry(await api.post("/workflows/dry-run", { actions: value, leadId }));
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setRunning(false); }
  };

  // ── one rail of nodes, recursively ──
  const Rail = ({ nodes, path }: { nodes: Node[]; path: number[] }) => (
    <div className="space-y-1.5">
      {nodes.map((n, i) =>
        n.type === "IF" ? (
          <div key={i} className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs font-semibold text-amber-800">
                ◆ {tr("fb_if")} <span className="kpi-num font-normal" dir="ltr">
                  {(n as { cond: { field: string; op: string; value?: string } }).cond.field}{" "}
                  {tr(`fb_op_${(n as { cond: { op: string } }).cond.op}`)}{" "}
                  {(n as { cond: { value?: string } }).cond.value ?? ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button onClick={() => setEditing({ path, index: i, node: n })} className="text-[11px] text-ink-500 hover:underline">✎</button>
                <button onClick={() => removeAt(path, i)} className="text-[11px] text-clay-600 hover:underline">✕</button>
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([["then", 0], ["else", 1]] as const).map(([side, b]) => (
                <div key={side} className={`rounded-xl border p-2 ${side === "then" ? "border-moss-300 bg-moss-50/40" : "border-paper-300 bg-paper-100/60"}`}>
                  <div className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${side === "then" ? "text-moss-700" : "text-ink-400"}`}>
                    {tr(side === "then" ? "fb_then" : "fb_else")}
                  </div>
                  <Rail nodes={(n as Record<string, Node[]>)[side] || []} path={[...path, i, b]} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-paper-200 bg-white px-3 py-2 shadow-soft">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-sm">{GLYPH[n.type] || "▸"}</span>
              <span className="truncate text-xs text-ink-800">{summarise(n, tr)}</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <button onClick={() => setEditing({ path, index: i, node: n })} className="text-[11px] text-ink-500 hover:underline">✎</button>
              <button onClick={() => removeAt(path, i)} className="text-[11px] text-clay-600 hover:underline">✕</button>
            </span>
          </div>
        )
      )}
      <button onClick={() => setAdding(path)}
        className="w-full rounded-xl border border-dashed border-paper-300 py-1.5 text-[11px] text-ink-400 transition hover:border-amber-500/60 hover:text-amber-700">
        + {tr("fb_add")}
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-paper-100 p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {tr("fb_start")}
        </div>
        <Rail nodes={value} path={[]} />
      </div>

      {/* try it against something real, before trusting it at 3am */}
      <div className="flex items-center gap-2">
        <button onClick={tryIt} disabled={running || !value.length} className="btn-ghost text-xs">
          {running ? tr("fb_trying") : `▷ ${tr("fb_try")}`}
        </button>
        <span className="text-[10px] text-ink-400">{tr("fb_tryHint")}</span>
      </div>

      {dry && (
        <div className="rounded-2xl border border-paper-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
            {tr("fb_dryOn")} <span className="text-ink-700">{dry.lead?.company}</span>
          </div>
          <ol className="mt-1.5 space-y-1">
            {dry.log.map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]">
                <span className="shrink-0">{l.action === "IF" ? "◆" : l.ok ? "→" : "⚠"}</span>
                <span className={l.ok ? "text-ink-700" : "text-clay-700"} dir="auto">
                  {l.action === "IF"
                    ? <span className="text-amber-700">{tr(l.branch === "then" ? "fb_tookThen" : "fb_tookElse")} — <span className="kpi-num" dir="ltr">{l.detail}</span></span>
                    : l.detail}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1.5 text-[10px] text-ink-400">{tr("fb_dryNote")}</p>
        </div>
      )}

      {/* palette — generated from the engine's registry, never hardcoded */}
      {adding && library && (
        <Modal open title={tr("fb_add")} onClose={() => setAdding(null)}>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => add(adding, {
              type: "IF", cond: { field: library.branchFields[0], op: "eq", value: "" }, then: [], else: [],
            })} className="col-span-2 rounded-xl border-2 border-amber-500/40 bg-amber-500/5 px-3 py-2 text-start">
              <div className="text-sm font-semibold text-amber-800">◆ {tr("fb_if")}</div>
              <div className="text-[11px] text-ink-500">{tr("fb_ifHint")}</div>
            </button>
            {library.actions.map((t) => (
              <button key={t} onClick={() => add(adding, { type: t } as Node)}
                className="rounded-xl border border-paper-200 px-3 py-2 text-start hover:border-amber-500/50">
                <div className="text-sm">{GLYPH[t] || "▸"} <span className="text-xs text-ink-800">{tr(`au_a_${t}`)}</span></div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editing && library && (
        <NodeEditor node={editing.node} library={library} onClose={() => setEditing(null)}
          onSave={(n) => { replaceAt(editing.path, editing.index, n); setEditing(null); }} />
      )}
    </div>
  );
}

// ── editing one node's parameters ────────────────────────────────────
function NodeEditor({ node, library, onSave, onClose }: {
  node: Node; library: Library; onSave: (n: Node) => void; onClose: () => void;
}) {
  const { tr } = useI18n();
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...(node as Record<string, unknown>) });
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const cond = (draft.cond || {}) as { field: string; op: string; value?: string };

  return (
    <Modal open title={tr("fb_edit")} onClose={onClose}>
      <div className="space-y-3">
        {node.type === "IF" ? (
          <>
            <select className="input" value={cond.field}
              onChange={(e) => set("cond", { ...cond, field: e.target.value })}>
              {library.branchFields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="input" value={cond.op}
              onChange={(e) => set("cond", { ...cond, op: e.target.value })}>
              {library.branchOps.map((o) => <option key={o} value={o}>{tr(`fb_op_${o}`)}</option>)}
            </select>
            {cond.op !== "notnull" && (
              <input className="input" placeholder={tr("fb_value")} value={cond.value ?? ""}
                onChange={(e) => set("cond", { ...cond, value: e.target.value })} />
            )}
          </>
        ) : (
          <>
            {node.type === "ADD_TAG" && (
              <input className="input" placeholder={tr("fb_s_tag")} value={String(draft.tag ?? "")} onChange={(e) => set("tag", e.target.value)} />
            )}
            {node.type === "CREATE_TASK" && (
              <>
                <input className="input" placeholder={tr("fb_s_task")} value={String(draft.title ?? "")} onChange={(e) => set("title", e.target.value)} />
                <input className="input" type="number" placeholder={tr("fb_due")} value={String(draft.dueInDays ?? "")} onChange={(e) => set("dueInDays", Number(e.target.value))} />
              </>
            )}
            {node.type === "NOTIFY" && (
              <input className="input" placeholder={tr("fb_s_notify")} value={String(draft.message ?? "")} onChange={(e) => set("message", e.target.value)} />
            )}
            {node.type === "ASSIGN_OWNER" && (
              <input className="input" dir="ltr" placeholder="userId" value={String(draft.userId ?? "")} onChange={(e) => set("userId", e.target.value)} />
            )}
          </>
        )}
        <button onClick={() => onSave(draft as Node)} className="btn-amber w-full">{tr("save")}</button>
      </div>
    </Modal>
  );
}
