import React, { useState, useEffect, useRef, useCallback, Fragment, ReactNode } from "react";
import { Card } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { api, tokenStore } from "../lib/api";
import { listConvos, createConvo, getConvo, deleteConvo, truncateTitle, Conversation, StoredMsg } from "../lib/convo";

interface Msg { role: "user" | "cmo"; text: string; reasoning?: string; label?: string }

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
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(activeConvoId);
  activeRef.current = activeConvoId;
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => { api.get<{ configured: boolean }>("/brain/status").then((s) => setConfigured(s.configured)).catch(() => setConfigured(false)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const refreshConvos = useCallback(async () => {
    try {
      const rows = await api.get<Conversation[]>("/brain/conversations");
      setConvos(rows);
    } catch { /* keep existing convos on error */ }
  }, []);

  useEffect(() => { refreshConvos(); }, [refreshConvos]);

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const loadConvo = useCallback(async (id: string) => {
    runIdRef.current++;
    setBusy(false);
    const c = await getConvo(id);
    if (!c) return;
    setActiveConvoId(c.id);
    const loaded: Msg[] = (c.messages || []).map((m: StoredMsg) => ({
      role: m.role,
      text: m.text,
      reasoning: m.reasoning,
      label: m.label,
    }));
    setMsgs(loaded);
  }, []);

  const handleNew = useCallback(async () => {
    runIdRef.current++;
    setBusy(false);
    setActiveConvoId(null);
    setMsgs([]);
  }, []);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConvo(id);
    if (activeRef.current === id) {
      setActiveConvoId(null);
      setMsgs([]);
    }
    refreshConvos();
  }, [refreshConvos]);

  const run = async (path: string, body: object, userText?: string, label?: string) => {
    cancelStream();
    const thisRun = ++runIdRef.current;
    if (userText) setMsgs((m) => [...m, { role: "user", text: userText }]);
    setBusy(true);

    const msgIdx = msgs.length + (userText ? 1 : 0);
    setMsgs((m) => [...m, { role: "cmo", text: "", reasoning: "", label }]);

    let conversationId = activeRef.current;
    if (!conversationId) {
      const created = await createConvo();
      if (created) {
        conversationId = created.id;
        setActiveConvoId(created.id);
        refreshConvos();
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = tokenStore.get();
      const res = await fetch(`/api${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({ ...body, lang, stream: true, conversationId }),
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
        const chunk = decoder.decode(value, { stream: !done });

        // If user switched to another conversation, drain silently (backend saves to DB)
        if (activeRef.current !== conversationId) continue;

        buffer += chunk;

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

      // If user is still on this convo, do a final sync from DB for consistency
      if (activeRef.current === conversationId && conversationId) {
        const c = await getConvo(conversationId);
        if (c?.messages) {
          const loaded: Msg[] = c.messages.map((m: StoredMsg) => ({
            role: m.role,
            text: m.text,
            reasoning: m.reasoning,
            label: m.label,
          }));
          setMsgs(loaded);
        }
      }
    } catch (e) {
      if (activeRef.current === conversationId) {
        setMsgs((m) => {
          const u = [...m];
          if (u[msgIdx]) u[msgIdx] = { ...u[msgIdx], text: (e as { message?: string })?.message || tr("saveError") };
          return u;
        });
      }
    } finally {
      if (runIdRef.current === thisRun) setBusy(false);
      refreshConvos();
    }
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
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-5xl gap-3">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-56" : "w-0"} shrink-0 overflow-hidden transition-all duration-200`}>
        <div className="flex h-full flex-col rounded-xl2 bg-paper-200/60 p-2">
          <button onClick={() => { handleNew(); }}
            className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/></svg>
            {tr("brain_new")}
          </button>
          <div className="flex-1 space-y-1 overflow-y-auto">
            {convos.map((c) => (
              <div key={c.id}
                onClick={() => loadConvo(c.id)}
                className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition ${
                  activeConvoId === c.id ? "bg-amber-500/15 text-ink-900" : "text-ink-600 hover:bg-paper-200"
                }`}>
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" opacity="0.5"><path d="M2 3.5A1.5 1.5 0 013.5 2h5a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5h-1.5l-2.5 2v-2H3.5A1.5 1.5 0 012 7.5v-4z"/><path d="M6 9.5A1.5 1.5 0 007.5 8h2.5V6.5a1.5 1.5 0 00-1.5-1.5H8v2.5A1.5 1.5 0 016.5 9H6v.5z"/></svg>
                <span className="flex-1 truncate">{truncateTitle(c.title)}</span>
                <button onClick={(e) => handleDelete(c.id, e)}
                  className="hidden group-hover:block rounded p-0.5 text-ink-400 hover:text-red-500"
                  title={tr("brain_delete")}>
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5a.5.5 0 01.5.5v5a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v5a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v5a.5.5 0 001 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1.5-1V1.5A1.5 1.5 0 013 0h8.5A1.5 1.5 0 0113 1.5V3h.5a1 1 0 011 1zM11 4H4v9a1 1 0 001 1h5a1 1 0 001-1V4z"/></svg>
                </button>
              </div>
            ))}
            {convos.length === 0 && (
              <p className="px-2.5 py-4 text-center text-[11px] text-ink-400">{tr("brain_noConvos")}</p>
            )}
          </div>
          <button onClick={() => setSidebarOpen(false)}
            className="self-end rounded p-1 text-ink-400 hover:text-ink-600">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M4.646 1.646a.5.5 0 01.708 0l6 6a.5.5 0 010 .708l-6 6a.5.5 0 01-.708-.708L10.293 8 4.646 2.354a.5.5 0 010-.708z"/></svg>
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex flex-1 flex-col">
        <div className="mb-3 flex items-center gap-3">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="rounded p-1 text-ink-400 hover:text-ink-600">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z"/></svg>
            </button>
          )}
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
    </div>
  );
}
