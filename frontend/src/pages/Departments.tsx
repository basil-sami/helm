import { useState } from "react";
import { useFetch, Card, SectionTitle, Field, Modal } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ DEPARTMENTS (Wave 3·H) ══════════════════════════════════════════
// A department is a slice, not a separate Pulse. The roll-up is the
// reason it exists: heads see their own, the GM sees them together.

interface Dept {
  id: string; name: string; nameAr?: string; code?: string; headName?: string;
  members: number; active: boolean;
}
interface Roll {
  scoped: boolean;
  departments: { id: string; name: string; nameAr?: string; leads: number; won: number;
                 campaigns: number; openTasks: number; spentUsd: number }[];
  unassigned: { leads: number; campaigns: number } | null;
}

export function DepartmentRollup() {
  const { tr, lang } = useI18n();
  const { data } = useFetch<Roll>("/departments/rollup");
  if (!data?.departments?.length) return null;

  const max = Math.max(1, ...data.departments.map((d) => d.leads));
  return (
    <Card>
      <SectionTitle>🏛 {data.scoped ? tr("dp_mine") : tr("dp_rollup")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{data.scoped ? tr("dp_mineSub") : tr("dp_rollupSub")}</p>
      <div className="space-y-2.5">
        {data.departments.map((d) => (
          <div key={d.id}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink-800">{lang === "ar" && d.nameAr ? d.nameAr : d.name}</span>
              <span className="kpi-num shrink-0 text-[11px] text-ink-500" dir="ltr">
                {d.leads} · {d.won}✓ · {d.openTasks}⏳ · ${Math.round(d.spentUsd)}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${(d.leads / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      {data.unassigned && (data.unassigned.leads > 0 || data.unassigned.campaigns > 0) && (
        <p className="mt-2 text-[11px] text-ink-400">
          {tr("dp_unassigned")}: <span className="kpi-num" dir="ltr">{data.unassigned.leads}</span> {tr("dp_leads")}
          {data.unassigned.campaigns > 0 && <> · <span className="kpi-num" dir="ltr">{data.unassigned.campaigns}</span> {tr("dp_campaigns")}</>}
        </p>
      )}
    </Card>
  );
}

export default function Departments() {
  const { tr, lang } = useI18n();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch<Dept[]>("/departments");
  const [adding, setAdding] = useState<{ name: string; nameAr: string; code: string } | null>(null);
  if (!data) return null;

  const save = async () => {
    if (!adding?.name) return;
    try { await api.post("/departments", adding); setAdding(null); reload(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>{tr("dp_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("dp_sub")}</p>
        </div>
        {isAdmin && (
          <button onClick={() => setAdding({ name: "", nameAr: "", code: "" })} className="btn-ghost text-xs">
            + {tr("dp_add")}
          </button>
        )}
      </div>

      {!data.length ? (
        <p className="mt-2 text-sm text-ink-400">{tr("dp_none")}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {data.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-paper-100">
              <span className="min-w-0">
                <span className="truncate text-sm text-ink-800">{lang === "ar" && d.nameAr ? d.nameAr : d.name}</span>
                {d.headName && <span className="block text-[11px] text-ink-400">{d.headName}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] text-ink-400" dir="ltr">
                {d.code && <span className="kpi-num rounded bg-paper-200 px-1.5 py-0.5">{d.code}</span>}
                <span>{d.members} {tr("dp_members")}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-ink-400">{tr("dp_note")}</p>

      {adding && (
        <Modal open title={tr("dp_add")} onClose={() => setAdding(null)}>
          <div className="space-y-3">
            <Field label={tr("dp_name")}>
              <input className="input" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} dir="ltr" />
            </Field>
            <Field label={tr("dp_nameAr")}>
              <input className="input" value={adding.nameAr} onChange={(e) => setAdding({ ...adding, nameAr: e.target.value })} dir="rtl" />
            </Field>
            <Field label={tr("dp_code")}>
              <input className="input" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value.toUpperCase() })} dir="ltr" />
            </Field>
            <button onClick={save} className="btn-amber w-full" disabled={!adding.name}>{tr("save")}</button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
