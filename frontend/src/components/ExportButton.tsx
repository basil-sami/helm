import { useState } from "react";
import { download } from "../lib/api";
import { useI18n } from "../context/I18nContext";

export default function ExportButton({ resource }: { resource: string }) {
  const { tr } = useI18n();
  const [busy, setBusy] = useState(false);

  const go = async (format: "csv" | "json") => {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await download(`/export/${resource}?format=${format}`, `helm-${resource}-${stamp}.${format}`);
    } catch {
      /* surfaced by network layer */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-paper-300 bg-white">
      <button onClick={() => go("csv")} disabled={busy} className="px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 disabled:opacity-50">
        ↓ {tr("exportCsv")}
      </button>
      <button onClick={() => go("json")} disabled={busy} className="border-s border-paper-300 px-2.5 py-2 text-xs text-ink-500 hover:bg-paper-100 disabled:opacity-50">
        JSON
      </button>
    </div>
  );
}
