"use client";

/* Fixed bottom chat bar — general store-ops Q&A PLUS read-only tool access
   to live sales/orders/reconciliation/inventory data (see app/api/chat).
   Streams token-by-token so replies feel alive; expands into a panel above
   the bar while a conversation runs. */

import { Send, Sparkles, X, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant"; content: string };

export function StoreChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setOpen(true);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
    } catch (e) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `Something went wrong: ${(e as Error).message}` };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="chatdock">
      <style>{CHAT_CSS}</style>

      {open && (
        <div className="chatdock-panel">
          <div className="chatdock-panel-head">
            <span><Sparkles size={13} /> Omnia assistant · live sales, orders &amp; reconciliation</span>
            <button onClick={() => setOpen(false)} aria-label="Close chat"><X size={15} /></button>
          </div>
          <div className="chatdock-msgs" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="chatdock-empty">Ask about sales, orders, inventory, or reconciliation across all 4 stores — this assistant can pull live numbers. General ops/marketing/logistics questions work too.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chatdock-msg ${m.role}`}>
                <span className="chatdock-bubble">
                  {m.content || (streaming && i === messages.length - 1 ? "" : m.content)}
                  {streaming && i === messages.length - 1 && m.role === "assistant" && <i className="chatdock-cursor" />}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* <div className="chatdock-bar">
        <span className="chatdock-orb"><Sparkles size={15} /></span>
        <input
          ref={inputRef}
          className="chatdock-input"
          placeholder="Ask anything — sales, pending payouts, fees, reconciliation…"
          value={input}
          onFocus={() => messages.length > 0 && setOpen(true)}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button className="chatdock-send" disabled={!input.trim() || streaming} onClick={send} aria-label="Send">
          {streaming ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div> */}
    </div>
  );
}

const CHAT_CSS = `
  .chatdock { position: fixed; left: var(--sb-w, 240px); right: 0; transition: left .3s; bottom: 0; z-index: 40; display: flex; flex-direction: column; align-items: center; padding: 14px 16px; pointer-events: none; }
  .chatdock-bar, .chatdock-panel { pointer-events: auto; }
  .chatdock-bar { display: flex; align-items: center; gap: 10px; width: min(620px, 100%); background: #0F1B3D; border: 6px solid rgba(147,169,214,.45); background-clip: padding-box; border-radius: 999px; padding: 6px 8px 6px 6px; box-shadow: 0 18px 40px -12px rgba(15,27,61,.45); font-family: var(--os-font); }
  .chatdock-orb { width: 38px; height: 38px; border-radius: 999px; background: #2563EB; color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .chatdock-input { flex: 1; border: 0; outline: none; background: transparent; font-size: 14px; color: #F3F6FC; text-align: center; font-family: var(--os-font); }
  .chatdock-input::placeholder { color: #97A3BA; }
  .chatdock-send { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 999px; border: 1px solid #33415F; background: #1E2B52; color: #F3F6FC; cursor: pointer; flex-shrink: 0; }
  .chatdock-send:disabled { opacity: .45; cursor: not-allowed; }
  .chatdock-send .spin { animation: chatdock-spin 1s linear infinite; }
  @keyframes chatdock-spin { to { transform: rotate(360deg); } }

  .chatdock-panel { width: min(620px, 100%); font-family: var(--os-font); max-height: 46vh; margin-bottom: 10px; background: var(--card, #fff); border: 1px solid var(--line, #D8E1F1); border-radius: 16px; box-shadow: 0 20px 50px rgba(15,27,61,.18); display: flex; flex-direction: column; overflow: hidden; animation: chatdock-rise .18s ease-out; }
  @keyframes chatdock-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .chatdock-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line, #D8E1F1); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted, #5E6B85); font-weight: 600; }
  .chatdock-panel-head span { display: inline-flex; align-items: center; gap: 6px; }
  .chatdock-panel-head button { border: 0; background: transparent; color: var(--muted, #5E6B85); cursor: pointer; display: flex; }
  .chatdock-msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .chatdock-empty { font-size: 12.5px; color: var(--muted, #5E6B85); line-height: 1.6; margin: 0; }
  .chatdock-msg { display: flex; }
  .chatdock-msg.user { justify-content: flex-end; }
  .chatdock-bubble { max-width: 82%; font-size: 13px; line-height: 1.55; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; }
  .chatdock-msg.user .chatdock-bubble { background: var(--ink, #0F1B3D); color: var(--cream, #F3F6FC); border-bottom-right-radius: 4px; }
  .chatdock-msg.assistant .chatdock-bubble { background: var(--gold-wash, #EAF1FD); color: var(--ink, #0F1B3D); border-bottom-left-radius: 4px; }
  .chatdock-cursor { display: inline-block; width: 6px; height: 13px; margin-left: 2px; background: #3B82F6; vertical-align: -2px; animation: chatdock-blink 1s step-start infinite; }
  @keyframes chatdock-blink { 50% { opacity: 0; } }

  @media (max-width: 640px) {
    .chatdock { padding: 10px; }
  }
`;
