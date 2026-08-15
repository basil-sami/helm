import { useState } from "react";
import { Card, SectionTitle, Field, Modal, Empty, SkeletonRows, useFetch, StatusPill } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { ImportWizard } from "../components/ImportWizard";
import { fmtDate } from "../lib/format";

// ── CONTACTS — the audience layer with first-class consent ───────────

interface ConsentEntry { channel: string; grantedAt: string; revokedAt?: string; source?: string }
interface Contact { id: string; name: string; phone?: string; email?: string; company?: string;
  tags: string[] | string; consent: ConsentEntry[] | string; leadCompany?: string; customerName?: string; createdAt: string }

const CHANNELS = ["WHATSAPP", "EMAIL", "SMS", "CALL"];
const parse = <T,>(v: T[] | string | undefined, fb: T[]): T[] => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(String(v || "[]")); } catch { return fb; }
};

export default function Contacts() {
  const { data: erasures, reload: reloadEr } = useFetch<{ id: string; subjectEmail?: string; subjectPhone?: string; status: string; requestedByName?: string; createdAt: string;
    inventory?: { total: number; tables: { table: string; rows: number }[] } }[]>("/erasure");
  const [importing, setImporting] = useState(false);
  const [erNew, setErNew] = useState("");
  const [erMsg, setErMsg] = useState("");
  const [erVerify, setErVerify] = useState<{ id: string; note: string } | null>(null);
  const erAct = async (path: string, okMsg?: string) => {
    setErMsg("");
    try { const r = await api.post<{ inventory?: { total: number; tables: { table: string; rows: number }[] }; message?: string }>(path, {});
      setErMsg(okMsg || r.message || (r.inventory ? `${r.inventory.total} — ` + r.inventory.tables.filter((x) => x.rows > 0).map((x) => `${x.table}:${x.rows}`).join(" · ") : "✓"));
      reloadEr();
    } catch (e) { setErMsg((e as Error).message); }
  };
  const erCreate = async () => {
    if (!erNew.includes("@")) return;
    try { await api.post("/erasure", { subjectEmail: erNew }); setErNew(""); setErMsg(""); reloadEr(); }
    catch (e) { setErMsg((e as Error).message); }
  };
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const w = can("leads", "write");
  const { data, reload } = useFetch<Contact[]>("/contacts");
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [q, setQ] = useState("");

  const save = async () => {
    if (!editing) return;
    const payload = { ...editing, tags: String(editing.tags || "").split(",").map((t) => t.trim()).filter(Boolean) };
    if (editing.id) await api.patch(`/contacts/${editing.id}`, payload); else await api.post("/contacts", payload);
    setEditing(null); reload();
  };
  const toggleConsent = async (c: Contact, channel: string, granted: boolean) => {
    await api.post(`/contacts/${c.id}/consent`, { channel, granted });
    reload();
  };
  const list = (data || []).filter((c) =>
    !q || [c.name, c.phone, c.email, c.company].some((v) => (v || "").toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={w && <button onClick={() => setEditing({})} className="btn-amber text-xs">+ {tr("ct_new")}</button>}>
          {tr("ct_title")}
        </SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ct_sub")}</p>
        <input className="input mb-3 max-w-xs" placeholder={tr("search")} value={q} onChange={(e) => setQ(e.target.value)} />
        {!data ? <SkeletonRows rows={4} cols={4} /> : list.length === 0 ? <Empty text={tr("ct_empty")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink-400">
                <th className="pb-2 text-start">{tr("name")}</th>
                <th className="pb-2 text-start">{tr("ct_reach")}</th>
                <th className="pb-2 text-start">{tr("ct_consent")}</th>
                <th className="pb-2 text-start">{tr("ct_linked")}</th>
              </tr></thead>
              <tbody>
                {list.map((c) => {
                  const consent = parse<ConsentEntry>(c.consent, []);
                  const tags = parse<string>(c.tags, []);
                  return (
                    <tr key={c.id} className="border-t border-paper-200 align-top">
                      <td className="py-2.5 pe-3">
                        <button onClick={() => w && setEditing({ ...c, tags: tags.join(", ") })} className="text-start font-medium text-ink-800 hover:underline">{c.name}</button>
                        <div className="text-xs text-ink-400">{c.company || "—"}{tags.length > 0 && <> · {tags.join(" · ")}</>}</div>
                      </td>
                      <td className="py-2.5 pe-3 text-xs text-ink-600" dir="ltr">{c.phone || ""}{c.phone && c.email ? " · " : ""}{c.email || ""}</td>
                      <td className="py-2.5 pe-3">
                        <div className="flex flex-wrap gap-1">
                          {CHANNELS.map((ch) => {
                            const active = consent.find((e) => e.channel === ch && !e.revokedAt);
                            const revoked = !active && consent.some((e) => e.channel === ch);
                            return (
                              <button key={ch} disabled={!w} title={active ? `${tr("ct_since")} ${fmtDate(active.grantedAt, lang)}${active.source ? ` · ${active.source}` : ""}` : ""}
                                onClick={() => toggleConsent(c, ch, !active)}
                                className={`pill text-[10px] ${active ? "bg-moss-500/12 text-moss-600" : revoked ? "bg-clay-500/10 text-clay-600 line-through" : "bg-paper-200 text-ink-400"}`}>
                                {el(ch)}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 text-xs text-ink-500">{c.customerName || c.leadCompany || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("ct_new")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={() => setImporting(true)} className="btn-ghost text-xs">⬆ {tr("imp_btn")}</button>
          <button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label={tr("name")}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("phone")}><input className="input" dir="ltr" value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label={tr("email")}><input className="input" dir="ltr" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            </div>
            <Field label={tr("company")}><input className="input" value={editing.company || ""} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field>
            <Field label={tr("ct_tags")}><input className="input" dir="ltr" placeholder="distributor, newsletter" value={String(editing.tags || "")} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} /></Field>
            <p className="text-xs text-ink-400">{tr("ct_consentHint")}</p>
          </div>
        )}
      </Modal>

      {/* ── SEC·C finally gets its door: data-subject erasure ── */}
      <Card>
        <SectionTitle>🧹 {tr("er_title")}</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-ink-500">{tr("er_sub")}</p>
        {erMsg && <p className="mb-2 rounded-lg bg-paper-100 px-2.5 py-1.5 text-xs text-ink-700" dir="auto">{erMsg}</p>}
        <div className="mb-3 flex gap-2">
          <input className="input h-9 flex-1" dir="ltr" placeholder="subject@email…" value={erNew} onChange={(e) => setErNew(e.target.value)} />
          <button onClick={erCreate} className="btn-amber text-xs">+ {tr("er_new")}</button>
        </div>
        <div className="space-y-1.5">
          {(erasures || []).slice(0, 12).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5 text-xs">
              <span className="min-w-0">
                <span className="truncate font-medium text-ink-800" dir="ltr">{r.subjectEmail || r.subjectPhone}</span>
                <span className="ms-2"><StatusPill value={r.status} /></span>
              </span>
              <span className="flex shrink-0 gap-1">
                {r.status === "RECEIVED" && <>
                  <button onClick={() => erAct(`/erasure/${r.id}/verify/send`, tr("er_sent"))} className="rounded-lg bg-paper-100 px-2 py-1 text-[11px] text-ink-700 hover:bg-paper-200">✉ {tr("er_verifySend")}</button>
                  <button onClick={() => setErVerify({ id: r.id, note: "" })} className="rounded-lg bg-paper-100 px-2 py-1 text-[11px] text-ink-700 hover:bg-paper-200">✓ {tr("er_verifyManual")}</button>
                </>}
                {r.status === "VERIFIED" && <button onClick={() => erAct(`/erasure/${r.id}/discover`)} className="rounded-lg bg-paper-100 px-2 py-1 text-[11px] text-ink-700 hover:bg-paper-200">🔍 {tr("er_discover")}</button>}
                {r.status === "DISCOVERED" && <button onClick={() => erAct(`/erasure/${r.id}/submit`, tr("er_submitted"))} className="rounded-lg bg-clay-500/10 px-2 py-1 text-[11px] font-medium text-clay-700 hover:bg-clay-500/20">🧹 {tr("er_submit")}</button>}
              </span>
            </div>
          ))}
          {erasures && erasures.length === 0 && <p className="text-xs text-ink-400">{tr("er_none")}</p>}
        </div>
        {erVerify && (
          <div className="mt-2 flex gap-2">
            <input className="input h-9 flex-1 text-xs" dir="auto" placeholder={tr("er_howVerified")}
              value={erVerify.note} onChange={(e) => setErVerify({ ...erVerify, note: e.target.value })} />
            <button onClick={async () => { if (!erVerify.note) return;
              try { await api.post(`/erasure/${erVerify.id}/verify/manual`, { evidence: erVerify.note }); setErVerify(null); setErMsg(tr("er_verified")); reloadEr(); }
              catch (e) { setErMsg((e as Error).message); } }}
              className="btn-amber text-xs">✓</button>
            <button onClick={() => setErVerify(null)} className="btn-ghost text-xs">{tr("cancel")}</button>
          </div>
        )}
      </Card>

      {importing && <ImportWizard entity="contacts" onClose={() => setImporting(false)}
        onDone={() => { setImporting(false); reload(); }} />}
    </div>
  );
}
