import { ReactNode, useState, useMemo } from "react";
import { useI18n } from "../context/I18nContext";
import { SkeletonRows, Empty } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
  align?: "start" | "end";
}

export interface BulkAction<T> {
  label: string;
  tone?: "default" | "danger";
  onRun: (rows: T[]) => void | Promise<void>;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyText,
  bulkActions,
  rowActions,
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyText?: string;
  bulkActions?: BulkAction<T>[];
  rowActions?: (row: T) => ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const { tr } = useI18n();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort || null);
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = (row: T) => (col.sortValue ? col.sortValue(row) : ((row as Record<string, unknown>)[col.key] as string | number) ?? "");
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  const allOnPage = sorted.map(rowKey);
  const allSelected = allOnPage.length > 0 && allOnPage.every((k) => selected.has(k));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allOnPage));
  const toggleOne = (k: string) =>
    setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const selectedRows = sorted.filter((r) => selected.has(rowKey(r)));
  const pad = compact ? "px-3 py-1.5" : "px-4 py-3";

  return (
    <div className="card overflow-hidden p-0">
      {/* toolbar */}
      <div className="flex items-center justify-between border-b border-paper-200 px-3 py-2">
        <span className="text-xs text-ink-500">{sorted.length} {tr("rows")}</span>
        <button
          onClick={() => setCompact((c) => !c)}
          className="rounded-lg border border-paper-300 px-2.5 py-1 text-xs text-ink-600 hover:bg-paper-100"
        >
          {compact ? tr("density_comfortable") : tr("density_compact")}
        </button>
      </div>

      {loading ? (
        <SkeletonRows rows={6} cols={columns.length} />
      ) : sorted.length === 0 ? (
        <Empty text={emptyText || tr("noData")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
                {bulkActions && (
                  <th className={`${pad} w-10`}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={tr("select_all")} className="accent-amber-500" />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} className={`${pad} font-medium ${c.numeric || c.align === "end" ? "text-end" : "text-start"}`}>
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-ink-700">
                      {c.header}
                      <span className="text-[9px]">{sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                  </th>
                ))}
                {rowActions && <th className={pad} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200">
              {sorted.map((row) => {
                const k = rowKey(row);
                const sel = selected.has(k);
                return (
                  <tr key={k} className={`transition-colors hover:bg-paper-100/60 ${sel ? "bg-amber-500/[0.05]" : ""}`}>
                    {bulkActions && (
                      <td className={pad}>
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(k)} aria-label="Select row" className="accent-amber-500" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={`${pad} ${c.numeric ? "text-end" : c.align === "end" ? "text-end" : "text-start"} ${c.numeric ? "tnum" : ""}`}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                      </td>
                    ))}
                    {rowActions && <td className={`${pad} text-end`}>{rowActions(row)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* bulk action bar */}
      {bulkActions && selected.size > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between border-t border-paper-200 bg-ink-900 px-4 py-2.5 text-paper animate-scale-in">
          <span className="text-sm">{selected.size} {tr("selected")}</span>
          <div className="flex items-center gap-2">
            {bulkActions.map((a) => (
              <button
                key={a.label}
                onClick={async () => { await a.onRun(selectedRows); setSelected(new Set()); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${a.tone === "danger" ? "bg-clay-500 text-white hover:bg-clay-600" : "bg-white/10 hover:bg-white/20"}`}
              >
                {a.label}
              </button>
            ))}
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-sm text-paper-200/70 hover:text-white">
              {tr("clear")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
