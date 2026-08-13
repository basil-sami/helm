import { useState } from "react";
import { Card, SectionTitle, Field, Modal, Empty, SkeletonRows, useFetch } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
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
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
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
    </div>
  );
}
