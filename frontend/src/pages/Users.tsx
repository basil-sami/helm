import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, Empty, SectionTitle } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

interface UserRow {
  id: string; name: string; email: string; role: string;
  titleAr?: string; active: boolean; createdAt?: string;
}
interface RoleRow {
  id: string; key: string; label: string; labelAr?: string | null;
  permissions: { admin?: boolean; [k: string]: string | boolean | undefined };
  builtin: boolean; userCount: number;
}

type Editing = Partial<UserRow> & { password?: string };
const blank: Editing = { name: "", email: "", role: "DIGITAL", password: "" };

type PermLevel = "none" | "read" | "write";
type RoleEditing = {
  id?: string; key: string; label: string; labelAr: string;
  admin: boolean; perms: Record<string, PermLevel>;
};

// module key → nav label key (content lives on the calendar page)
const MODULES: { key: string; nav: string }[] = [
  { key: "campaigns", nav: "nav_campaigns" }, { key: "content", nav: "nav_calendar" },
  { key: "leads", nav: "nav_leads" }, { key: "events", nav: "nav_events" },
  { key: "budget", nav: "nav_budget" }, { key: "tasks", nav: "nav_tasks" },
  { key: "social", nav: "nav_social" }, { key: "intel", nav: "nav_intel" },
  { key: "planning", nav: "nav_planning" }, { key: "analytics", nav: "nav_analytics" },
  { key: "brain", nav: "nav_brain" },
];
const allRead = () => Object.fromEntries(MODULES.map((m) => [m.key, "read"])) as Record<string, PermLevel>;

export default function Users() {
  const { lang, tr, el } = useI18n();
  const { user, isAdmin } = useAuth();
  const { data, loading, reload } = useFetch<UserRow[]>("/users");
  const { data: roles, reload: reloadRoles } = useFetch<RoleRow[]>("/roles");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [roleEdit, setRoleEdit] = useState<RoleEditing | null>(null);
  const [roleError, setRoleError] = useState("");

  if (!isAdmin) {
    return <Card><p className="py-12 text-center text-ink-500">{tr("usr_headOnly")}</p></Card>;
  }

  const users = data || [];
  const roleList = roles || [];
  const roleLabel = (key: string) => {
    const r = roleList.find((x) => x.key === key);
    if (!r) return el(key);
    return lang === "ar" && r.labelAr ? r.labelAr : r.label;
  };

  const save = async () => {
    if (!editing?.name || !editing?.email) return;
    setSaving(true);
    setError("");
    try {
      if (editing.id) {
        const payload: Record<string, unknown> = {
          name: editing.name, role: editing.role, titleAr: editing.titleAr, active: editing.active,
        };
        if (editing.password) payload.password = editing.password;
        await api.patch(`/users/${editing.id}`, payload);
      } else {
        await api.post("/users", {
          name: editing.name, email: editing.email, role: editing.role,
          titleAr: editing.titleAr, password: editing.password,
        });
      }
      setEditing(null);
      reload();
      reloadRoles(); // userCount changed
    } catch (e) {
      const msg = (e as { status?: number })?.status === 409 ? tr("usr_emailInUse") : tr("loginError");
      setError(msg);
    } finally { setSaving(false); }
  };

  const toggleActive = async (u: UserRow) => {
    if (u.active) await api.del(`/users/${u.id}`);
    else await api.patch(`/users/${u.id}`, { active: true });
    reload();
  };

  // ── Roles manager ────────────────────────────────────────────────
  const openNewRole = () => {
    setRoleError("");
    setRoleEdit({ key: "", label: "", labelAr: "", admin: false, perms: allRead() });
  };
  const openEditRole = (r: RoleRow) => {
    setRoleError("");
    const perms = allRead();
    for (const m of MODULES) {
      const v = r.permissions?.[m.key];
      if (v === "none" || v === "read" || v === "write") perms[m.key] = v;
    }
    setRoleEdit({ id: r.id, key: r.key, label: r.label, labelAr: r.labelAr || "", admin: !!r.permissions?.admin, perms });
  };

  const saveRole = async () => {
    if (!roleEdit?.label) return;
    setSaving(true);
    setRoleError("");
    try {
      const permissions = { admin: roleEdit.admin, ...roleEdit.perms };
      if (roleEdit.id) {
        await api.patch(`/roles/${roleEdit.id}`, { label: roleEdit.label, labelAr: roleEdit.labelAr, permissions });
      } else {
        await api.post("/roles", { key: roleEdit.key.trim().toUpperCase(), label: roleEdit.label, labelAr: roleEdit.labelAr, permissions });
      }
      setRoleEdit(null);
      reloadRoles();
    } catch (e) {
      const st = (e as { status?: number })?.status;
      setRoleError(st === 409 ? (lang === "ar" ? "المعرّف مستخدم من قبل" : "Key already exists") : tr("saveError"));
    } finally { setSaving(false); }
  };

  const deleteRole = async (r: RoleRow) => {
    if (!confirm(tr("confirmDelete"))) return;
    try {
      await api.del(`/roles/${r.id}`);
      reloadRoles();
    } catch {
      alert(lang === "ar" ? `الدور معيّن لـ ${r.userCount} مستخدم — انقل المستخدمين أولاً` : `Role is assigned to ${r.userCount} user(s) — reassign them first`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("usr_title")}</h1>
          <p className="text-sm text-ink-500">{users.filter((u) => u.active).length} {lang === "ar" ? "نشط" : "active"}</p>
        </div>
        <button onClick={() => { setError(""); setEditing(blank); }} className="btn-amber">+ {tr("usr_add")}</button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div>
          : users.length === 0 ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3 text-start font-medium">{tr("name")}</th>
                <th className="px-4 py-3 text-start font-medium">{tr("email")}</th>
                <th className="px-4 py-3 text-start font-medium">{tr("usr_role")}</th>
                <th className="px-4 py-3 text-start font-medium">{tr("status")}</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody className="divide-y divide-paper-200">
                {users.map((u) => (
                  <tr key={u.id} className={`hover:bg-paper-100/60 ${!u.active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-800">{u.name}{u.id === user?.id && <span className="ms-2 text-xs text-amber-600">({lang === "ar" ? "أنت" : "you"})</span>}</div>
                      {u.titleAr && <div className="text-xs text-ink-500">{u.titleAr}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600" dir="ltr">{u.email}</td>
                    <td className="px-4 py-3"><span className="pill bg-steel-500/12 text-steel-600">{roleLabel(u.role)}</span></td>
                    <td className="px-4 py-3">
                      <span className={`pill ${u.active ? "bg-moss-500/15 text-moss-700" : "bg-paper-200 text-ink-500"}`}>
                        {u.active ? tr("usr_active") : tr("usr_inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button onClick={() => { setError(""); setEditing({ ...u, password: "" }); }} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
                      {u.id !== user?.id && (
                        <button onClick={() => toggleActive(u)} className="ms-3 text-xs text-clay-600 hover:underline">
                          {u.active ? tr("usr_deactivate") : tr("usr_activate")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Roles & permissions ── */}
      <div className="flex items-end justify-between">
        <div>
          <SectionTitle>{tr("roles_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("roles_subtitle")}</p>
        </div>
        <button onClick={openNewRole} className="btn-ghost">+ {tr("roles_add")}</button>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-paper-200">
          {roleList.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-800">{lang === "ar" && r.labelAr ? r.labelAr : r.label}</span>
                  <span className="font-mono text-[11px] text-ink-400">{r.key}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                  <span className={`pill ${r.builtin ? "bg-paper-200 text-ink-500" : "bg-amber-500/15 text-amber-700"}`}>
                    {r.builtin ? tr("roles_builtin") : tr("roles_custom")}
                  </span>
                  {r.permissions?.admin && <span className="pill bg-clay-500/12 text-clay-600">Admin</span>}
                  <span className="kpi-num">{r.userCount}</span> {tr("roles_usersCount")}
                </div>
              </div>
              {r.builtin ? (
                <span className="text-xs text-ink-400">{tr("roles_locked")}</span>
              ) : (
                <div className="flex items-center gap-3">
                  <button onClick={() => openEditRole(r)} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
                  <button onClick={() => deleteRole(r)} className="text-xs text-clay-600 hover:underline">{tr("delete")}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* User modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("usr_add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="space-y-3">
            {error && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{error}</div>}
            <Field label={tr("name")}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label={tr("email")}>
              <input className="input" dir="ltr" type="email" value={editing.email || ""} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label={tr("usr_titleAr")}><input className="input" value={editing.titleAr || ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} /></Field>
            <Field label={tr("usr_role")}>
              <Select value={editing.role || "DIGITAL"} onChange={(v) => setEditing({ ...editing, role: v })}
                options={roleList.map((r) => ({ value: r.key, label: lang === "ar" && r.labelAr ? r.labelAr : r.label }))} />
            </Field>
            <p className="-mt-2 text-xs text-ink-400">{tr("role_helper")}</p>
            <Field label={editing.id ? tr("usr_passwordReset") : tr("usr_password")}>
              <input className="input" dir="ltr" type="password" value={editing.password || ""}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Role modal */}
      <Modal open={!!roleEdit} onClose={() => setRoleEdit(null)} title={roleEdit?.id ? tr("edit") : tr("roles_add")}
        footer={<>
          <button onClick={() => setRoleEdit(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveRole} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {roleEdit && (
          <div className="space-y-3">
            {roleError && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{roleError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Label (EN)"><input className="input" value={roleEdit.label} onChange={(e) => setRoleEdit({ ...roleEdit, label: e.target.value })} /></Field>
              <Field label="التسمية (AR)"><input className="input" value={roleEdit.labelAr} onChange={(e) => setRoleEdit({ ...roleEdit, labelAr: e.target.value })} /></Field>
            </div>
            {!roleEdit.id && (
              <Field label={tr("roles_key")}>
                <input className="input font-mono" dir="ltr" placeholder="ANALYST" value={roleEdit.key}
                  onChange={(e) => setRoleEdit({ ...roleEdit, key: e.target.value.toUpperCase() })} />
              </Field>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-paper-200 bg-paper-100/50 px-3 py-2 text-sm text-ink-700">
              <input type="checkbox" checked={roleEdit.admin} onChange={(e) => setRoleEdit({ ...roleEdit, admin: e.target.checked })} />
              {tr("roles_admin")}
            </label>
            {!roleEdit.admin && (
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">{tr("roles_perms")}</div>
                <div className="max-h-64 space-y-1.5 overflow-auto pe-1">
                  {MODULES.map((m) => (
                    <div key={m.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink-700">{tr(m.nav)}</span>
                      <div className="w-40">
                        <Select value={roleEdit.perms[m.key]} onChange={(v) => setRoleEdit({ ...roleEdit, perms: { ...roleEdit.perms, [m.key]: v as PermLevel } })}
                          options={[
                            { value: "none", label: tr("perm_none") },
                            { value: "read", label: tr("perm_read") },
                            { value: "write", label: tr("perm_write") },
                          ]} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
