import { useEffect, useState } from "react";
import { Card } from "../components/ui";

export default function PrivacyConfirm({ id, token }: { id: string; token: string }) {
  const [state, setState] = useState<{ loading: boolean; ok: boolean; message: string }>({ loading: true, ok: false, message: "" });
  useEffect(() => {
    fetch(`/api/privacy/confirm/${encodeURIComponent(id)}/${encodeURIComponent(token)}`)
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`); return body; })
      .then((body) => setState({ loading: false, ok: true, message: body.message || "Your request is confirmed." }))
      .catch((e) => setState({ loading: false, ok: false, message: e.message }));
  }, [id, token]);
  return <div className="grid min-h-screen place-items-center bg-paper p-4"><Card className="max-w-lg text-center"><div className={`mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full text-xl ${state.ok ? "bg-moss-500/15 text-moss-700" : "bg-paper-200 text-ink-500"}`}>{state.loading ? "…" : state.ok ? "✓" : "!"}</div><h1 className="text-xl font-bold text-ink-900">Privacy request</h1><p className="mt-2 text-sm text-ink-600">{state.loading ? "Confirming your request…" : state.message}</p></Card></div>;
}
