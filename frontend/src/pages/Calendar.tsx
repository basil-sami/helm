import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFetch, Card, Field, Select, Modal, SectionTitle } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { toDateInput } from "../lib/format";

interface Content {
  id: string; title: string; titleAr?: string; channel: string; status: string;
  scheduledAt?: string; notes?: string; campaignId?: string; campaignName?: string; authorId?: string;
  personaId?: string; productId?: string; pillar?: string;
}
interface CampaignRow { id: string; name: string; nameAr?: string; status?: string; startDate?: string; endDate?: string }
interface EventRow { id: string; name: string; nameAr?: string; status?: string; startDate?: string; endDate?: string }
interface UserRow { id: string; name: string }

type Entry = { kind: "content" | "event" | "campStart" | "campEnd"; id: string; label: string; open: () => void };

const STATUSES = ["IDEA", "IN_PROGRESS", "REVIEW", "APPROVED", "PUBLISHED"];
const CHANNELS = ["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"];
const blank: Partial<Content> = { title: "", channel: "SOCIAL", status: "IDEA" };

const WEEKDAYS = {
  ar: ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export default function Calendar() {
  const { lang, tr, el } = useI18n();
  const navigate = useNavigate();
  const { data, loading, reload } = useFetch<Content[]>("/content");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const { data: personasList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/personas");
  const { data: productsList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/products");
  const { data: events } = useFetch<EventRow[]>("/events");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [layers, setLayers] = useState({ content: true, campaigns: true, events: true });
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [editing, setEditing] = useState<Partial<Content> | null>(null);
  const [saving, setSaving] = useState(false);

  const items = data || [];
  const monthLabel = cursor.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "long", year: "numeric" });

  const cells = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: { date: Date | null }[] = [];
    for (let i = 0; i < startPad; i++) arr.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ date: new Date(year, month, d) });
    while (arr.length % 7 !== 0) arr.push({ date: null });
    return arr;
  }, [cursor]);

  const sameDay = (iso: string | undefined, date: Date) => !!iso && new Date(iso).toDateString() === date.toDateString();
  const withinDay = (start?: string, end?: string, date?: Date) => {
    if (!start || !date) return false;
    const d0 = new Date(date); d0.setHours(12);
    const s = new Date(start); s.setHours(0, 0, 0, 0);
    const e = new Date(end || start); e.setHours(23, 59, 59, 999);
    return d0 >= s && d0 <= e;
  };
  const nameOf = (x: { name: string; nameAr?: string }) => (lang === "ar" && x.nameAr ? x.nameAr : x.name);

  // One day, three layers: content items, event spans, campaign start/end markers.
  const entriesOn = (date: Date): Entry[] => {
    const out: Entry[] = [];
    if (layers.content) {
      for (const it of items.filter((c) => sameDay(c.scheduledAt, date))) {
        out.push({
          kind: "content", id: `c-${it.id}`,
          label: lang === "ar" && it.titleAr ? it.titleAr : it.title,
          open: () => setEditing({ ...it, scheduledAt: toDateInput(it.scheduledAt) }),
        });
      }
    }
    if (layers.events) {
      for (const ev of (events || []).filter((e) => withinDay(e.startDate, e.endDate, date))) {
        out.push({ kind: "event", id: `e-${ev.id}`, label: nameOf(ev), open: () => navigate("/events") });
      }
    }
    if (layers.campaigns) {
      for (const c of campaigns || []) {
        if (sameDay(c.startDate, date)) out.push({ kind: "campStart", id: `cs-${c.id}`, label: nameOf(c), open: () => navigate("/campaigns") });
        else if (sameDay(c.endDate, date)) out.push({ kind: "campEnd", id: `ce-${c.id}`, label: nameOf(c), open: () => navigate("/campaigns") });
      }
    }
    return out;
  };

  // Campaigns overlapping the visible month → timeline bars.
  const monthStart = cursor;
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const ganttRows = (campaigns || [])
    .filter((c) => c.startDate && new Date(c.startDate) < monthEnd && new Date(c.endDate || c.startDate) >= monthStart)
    .map((c) => {
      const total = monthEnd.getTime() - monthStart.getTime();
      const s = Math.max(new Date(c.startDate!).getTime(), monthStart.getTime());
      const e = Math.min(new Date(c.endDate || c.startDate!).getTime() + 86400000, monthEnd.getTime());
      return { ...c, left: ((s - monthStart.getTime()) / total) * 100, width: Math.max(2.5, ((e - s) / total) * 100) };
    });
  const GANTT_COLORS: Record<string, string> = { ACTIVE: "#E8A33D", PLANNING: "#3F7191", PAUSED: "#C2603E", COMPLETED: "#5E8B5A" };

  const save = async () => {
    if (!editing?.title) return;
    setSaving(true);
    try {
      const payload = {
        title: editing.title, titleAr: editing.titleAr, channel: editing.channel, status: editing.status,
        scheduledAt: editing.scheduledAt, notes: editing.notes, campaignId: editing.campaignId || null, authorId: editing.authorId || null,
        personaId: editing.personaId || null, productId: editing.productId || null, pillar: editing.pillar || null,
      };
      if (editing.id) await api.patch(`/content/${editing.id}`, payload);
      else await api.post("/content", payload);
      setEditing(null);
      reload();
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => { if (!confirm(tr("confirmDelete"))) return; await api.del(`/content/${id}`); reload(); };

  const today = new Date().toDateString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="btn-ghost px-2.5">‹</button>
          <div className="min-w-40 text-center font-semibold text-ink-800">{monthLabel}</div>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="btn-ghost px-2.5">›</button>
        </div>
        <div className="flex items-center gap-1.5">
          {([
            ["content", "bg-amber-500", tr("nav_calendar")],
            ["campaigns", "bg-steel-500", tr("nav_campaigns")],
            ["events", "bg-violet-500", tr("nav_events")],
          ] as const).map(([k, dot, label]) => (
            <button key={k} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${layers[k] ? "border-paper-300 bg-white text-ink-700" : "border-transparent bg-paper-200/60 text-ink-400"}`}>
              <span className={`h-2 w-2 rounded-full ${dot} ${layers[k] ? "" : "opacity-30"}`} />{label}
            </button>
          ))}
          <button onClick={() => setEditing(blank)} className="btn-amber ms-2">+ {tr("add")}</button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-ink-500">{tr("cal_unifiedHint")}</p>

      <Card className="p-3">
        {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div> : (
          <>
            <div className="grid grid-cols-7 gap-1 border-b border-paper-200 pb-2 text-center text-xs font-medium text-ink-500">
              {WEEKDAYS[lang].map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 pt-1">
              {cells.map((cell, i) => {
                if (!cell.date) return <div key={i} className="min-h-24 rounded-lg bg-paper-100/40" />;
                const dayEntries = entriesOn(cell.date);
                const isToday = cell.date.toDateString() === today;
                const iso = toDateInput(cell.date.toISOString());
                return (
                  <div key={i} className={`min-h-24 rounded-lg border p-1.5 ${isToday ? "border-amber-500/50 bg-amber-50/40" : "border-paper-200 bg-white"}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`kpi-num text-xs ${isToday ? "text-amber-700" : "text-ink-500"}`}>{cell.date.getDate()}</span>
                      <button onClick={() => setEditing({ ...blank, scheduledAt: iso })} className="text-ink-300 hover:text-amber-600">+</button>
                    </div>
                    <div className="space-y-1">
                      {dayEntries.slice(0, 3).map((en) => (
                        <button key={en.id} onClick={en.open} title={en.label}
                          className={`block w-full truncate rounded px-1.5 py-1 text-start text-[11px] transition ${
                            en.kind === "content" ? "bg-paper-100 text-ink-700 hover:bg-amber-50"
                            : en.kind === "event" ? "bg-violet-500/12 text-violet-600 hover:bg-violet-500/20"
                            : "bg-steel-500/12 font-medium text-steel-600 hover:bg-steel-500/20"}`}>
                          {en.kind === "content" && <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
                          {en.kind === "campStart" && <span className="me-0.5">▸</span>}
                          {en.kind === "campEnd" && <span className="me-0.5">◂</span>}
                          {en.label}
                        </button>
                      ))}
                      {dayEntries.length > 3 && <div className="px-1 text-[10px] text-ink-500">+{dayEntries.length - 3} {tr("cal_more")}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {layers.campaigns && (
        <Card>
          <SectionTitle>{tr("cal_timeline")}</SectionTitle>
          {ganttRows.length === 0 ? (
            <p className="text-sm text-ink-500">{tr("cal_noCampaignsMonth")}</p>
          ) : (
            <div className="space-y-2">
              {ganttRows.map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <button onClick={() => navigate("/campaigns")} className="w-36 shrink-0 truncate text-start text-sm text-ink-700 hover:text-amber-700" title={nameOf(c)}>
                    {nameOf(c)}
                  </button>
                  <div className="relative h-6 flex-1 rounded bg-paper-200/70">
                    <button
                      onClick={() => navigate("/campaigns")}
                      className="absolute top-1 h-4 rounded-full transition hover:opacity-80"
                      style={{ insetInlineStart: `${c.left}%`, width: `${c.width}%`, background: GANTT_COLORS[c.status || "PLANNING"] || "#3F7191" }}
                      title={`${nameOf(c)} · ${el(c.status || "PLANNING")}`}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-end text-[11px] text-ink-500">{el(c.status || "PLANNING")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          {editing?.id && <button onClick={() => remove(editing.id!)} className="btn-ghost text-clay-600 me-auto">{tr("delete")}</button>}
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={`${tr("title")} (EN)`}><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={`${tr("title")} (AR)`}><input className="input" value={editing.titleAr || ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} /></Field></div>
            <Field label={tr("channel")}><Select value={editing.channel || "SOCIAL"} onChange={(v) => setEditing({ ...editing, channel: v })} options={CHANNELS.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("status")}><Select value={editing.status || "IDEA"} onChange={(v) => setEditing({ ...editing, status: v })} options={STATUSES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("date")}><input type="date" className="input" value={editing.scheduledAt || ""} onChange={(e) => setEditing({ ...editing, scheduledAt: e.target.value })} /></Field>
            <Field label={tr("author")}><Select value={editing.authorId || ""} onChange={(v) => setEditing({ ...editing, authorId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            <div className="col-span-2"><Field label={tr("campaign")}><Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field></div>
            <Field label={tr("au_persona")}><Select value={editing.personaId || ""} onChange={(v) => setEditing({ ...editing, personaId: v })} placeholder={tr("none")} options={(personasList || []).map((x) => ({ value: x.id, label: lang === "ar" && x.nameAr ? x.nameAr : x.name }))} /></Field>
            <Field label={tr("product")}><Select value={editing.productId || ""} onChange={(v) => setEditing({ ...editing, productId: v })} placeholder={tr("none")} options={(productsList || []).map((x) => ({ value: x.id, label: lang === "ar" && x.nameAr ? x.nameAr : x.name }))} /></Field>
            <div className="col-span-2"><Field label={tr("pillar")}><input className="input" value={editing.pillar || ""} onChange={(e) => setEditing({ ...editing, pillar: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={tr("notes")}><textarea className="input" rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
