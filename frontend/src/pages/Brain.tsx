import { useState, useEffect, useRef, Fragment, ReactNode } from "react";
import { Card } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api, tokenStore } from "../lib/api";

interface Msg { role: "user" | "cmo"; text: string; reasoning?: string; label?: string }

// Minimal rich-text renderer (bold, bullets, headings) — no dependency.
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={out.length} className="my-1.5 ms-4 list-disc space-y-1">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((ln) => {
    const t = ln.trim();
    if (/^[-*•]\s+/.test(t)) { bullets.push(t.replace(/^[-*•]\s+/, "")); return; }
    flush();
    if (!t) { out.push(<div key={out.length} className="h-2" />); return; }
    if (/^#{1,3}\s+/.test(t)) { out.push(<div key={out.length} className="mt-2 mb-1 font-semibold text-ink-900">{inline(t.replace(/^#{1,3}\s+/, ""))}</div>); return; }
    out.push(<p key={out.length} className="my-1 leading-relaxed">{inline(t)}</p>);
  });
  flush();
  return <div className="text-sm text-ink-700">{out}</div>;
}
function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-semibold text-ink-900">{p.slice(2, -2)}</strong>
      : <Fragment key={i}>{p}</Fragment>
  );
}

export default function Brain() {
  const { lang, tr } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<{ configured: boolean }>("/brain/status").then((s) => setConfigured(s.configured)).catch(() => setConfigured(false)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const run = async (path: string, body: object, userText?: string, label?: string) => {
    if (busy) return;
    if (userText) setMsgs((m) => [...m, { role: "user", text: userText }]);
    setBusy(true);

    const msgIdx = msgs.length + (userText ? 1 : 0);
    setMsgs((m) => [...m, { role: "cmo", text: "", reasoning: "", label }]);

    try {
      const token = tokenStore.get();
      const res = await fetch(`/api${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...body, lang, stream: true }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMsgs((m) => {
          const u = [...m];
          if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: "⚠️ " + (err.error || "Request failed") };
          return u;
        });
        setBusy(false);
        return;
      }

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/event-stream")) {
        const json = await res.json();
        if (json.configured === false) {
          setConfigured(false);
          setMsgs((m) => {
            const u = [...m];
            if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: tr("brain_notConfiguredHint") };
            return u;
          });
        } else if (json.error) {
          setMsgs((m) => {
            const u = [...m];
            if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: "⚠️ " + json.error };
            return u;
          });
        } else {
          setMsgs((m) => {
            const u = [...m];
            if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: json.answer || "" };
            return u;
          });
        }
        setBusy(false);
        return;
      }

      if (!res.body) throw new Error("Streaming not supported");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reasoning = "";
      let content = "";
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.reasoning) {
              reasoning += delta.reasoning;
              setMsgs((m) => {
                const u = [...m];
                if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], reasoning, text: content || " " };
                return u;
              });
            }
            if (delta.content) {
              content += delta.content;
              setMsgs((m) => {
                const u = [...m];
                if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], reasoning, text: content };
                return u;
              });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setMsgs((m) => {
        const u = [...m];
        if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: (e as { message?: string })?.message || tr("saveError") };
        return u;
      });
    } finally { setBusy(false); }
  };

  const ask = (q: string) => run("/brain/ask", { question: q }, q);
  const brief = () => run("/brain/brief", {}, undefined, tr("brain_briefLabel"));
  const send = () => { const q = input.trim(); if (!q) return; setInput(""); ask(q); };

  const [showReasoning, setShowReasoning] = useState<Record<number, boolean>>({});

  const suggestions = [
    tr("brain_s_forecast"), tr("brain_s_budget"), tr("brain_s_diagnose"),
    tr("brain_s_signals"), tr("brain_s_content"), tr("brain_s_plan"),
  ];

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <div className="mb-3 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl2 bg-ink-900 text-amber-500">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3a4 4 0 00-4 4 3 3 0 00-1 5.8V15a3 3 0 003 3h.5"/><path d="M12 3a4 4 0 014 4 3 3 0 011 5.8V15a3 3 0 01-3 3h-.5"/><path d="M12 8v13"/></svg>
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink-900">{tr("brain_title")}</h1>
          <p className="text-xs text-ink-500">{tr("brain_subtitle")}</p>
        </div>
        <button onClick={brief} disabled={busy} className="btn-amber ms-auto">✦ {tr("brain_brief")}</button>
      </div>

      {configured === false && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{tr("brain_notConfigured")}</div>
      )}

      {/* Conversation */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl2 bg-paper-200/30 p-4">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm text-ink-500">{tr("brain_empty")}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => ask(s)} disabled={busy}
                    className="rounded-full border border-paper-300 bg-white px-3 py-1.5 text-xs text-ink-600 transition hover:border-amber-500/40 hover:bg-amber-50/40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl2 rounded-se-sm bg-amber-500/15 px-3.5 py-2 text-sm text-ink-800">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <Card className="max-w-[90%] p-3.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{m.label || tr("brain_cmo")}
                </div>
                {m.reasoning && (
                  <div className="mb-2">
                    <button onClick={() => setShowReasoning((s) => ({ ...s, [i]: !s[i] }))}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-400 hover:text-ink-600">
                      <span className={`inline-block transition-transform ${showReasoning[i] ? "rotate-90" : ""}`}>▶</span>
                      {tr("brain_thinking")}
                    </button>
                    {showReasoning[i] && (
                      <div className="mt-1 rounded-lg bg-paper-200/70 p-2 text-xs text-ink-500 leading-relaxed whitespace-pre-wrap font-mono">
                        {m.reasoning}
                      </div>
                    )}
                  </div>
                )}
                <Rich text={m.text} />
              </Card>
            </div>
          )
        )}
        {busy && (
          <div className="flex justify-start">
            <Card className="p-3.5">
              <div className="flex items-center gap-1.5 text-sm text-ink-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" style={{ animationDelay: "300ms" }} />
                <span className="ms-1">{tr("brain_thinking")}</span>
              </div>
            </Card>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder={tr("brain_ask_ph")}
          className="input flex-1 resize-none"
        />
        <button onClick={send} disabled={busy || !input.trim()} className="btn-amber shrink-0">{tr("brain_send")}</button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-ink-400">{tr("brain_disclaimer")}</p>
    </div>
  );
}
