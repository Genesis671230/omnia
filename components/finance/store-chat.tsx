"use client";

/* Fixed bottom chat bar — general store-ops Q&A PLUS read-only tool access
   to live sales/orders/reconciliation/inventory data (see app/api/chat).
   Streams token-by-token so replies feel alive; expands into a panel above
   the bar while a conversation runs. */

import { MessageCircle, Send, Sparkles, X, Loader2 } from "lucide-react";
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

      <div className="chatdock-bar">
        <MessageCircle size={16} className="chatdock-icon" />
        <input
          ref={inputRef}
          className="chatdock-input"
          placeholder="Ask about sales, orders, inventory, or reconciliation…"
          value={input}
          onFocus={() => messages.length > 0 && setOpen(true)}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button className="chatdock-send" disabled={!input.trim() || streaming} onClick={send} aria-label="Send">
          {streaming ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}

const CHAT_CSS = `
  .chatdock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: flex; flex-direction: column; align-items: center; padding: 14px 16px; pointer-events: none; }
  .chatdock-bar, .chatdock-panel { pointer-events: auto; }
  .chatdock-bar { display: flex; align-items: center; gap: 10px; width: min(640px, 100%); background: var(--card, #fff); border: 1px solid var(--line-strong, #D6CCBA); border-radius: 999px; padding: 10px 16px; box-shadow: 0 10px 30px rgba(31,27,22,.12); }
  .chatdock-icon { color: var(--gold, #B08343); flex-shrink: 0; }
  .chatdock-input { flex: 1; border: 0; outline: none; background: transparent; font-size: 13.5px; color: var(--ink, #1F1B16); }
  .chatdock-send { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 999px; border: 0; background: var(--gold, #B08343); color: #fff; cursor: pointer; flex-shrink: 0; }
  .chatdock-send:disabled { opacity: .45; cursor: not-allowed; }
  .chatdock-send .spin { animation: chatdock-spin 1s linear infinite; }
  @keyframes chatdock-spin { to { transform: rotate(360deg); } }

  .chatdock-panel { width: min(640px, 100%); max-height: 46vh; margin-bottom: 10px; background: var(--card, #fff); border: 1px solid var(--line, #EAE3D6); border-radius: 16px; box-shadow: 0 20px 50px rgba(31,27,22,.18); display: flex; flex-direction: column; overflow: hidden; animation: chatdock-rise .18s ease-out; }
  @keyframes chatdock-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .chatdock-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line, #EAE3D6); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted, #8A8175); font-weight: 600; }
  .chatdock-panel-head span { display: inline-flex; align-items: center; gap: 6px; }
  .chatdock-panel-head button { border: 0; background: transparent; color: var(--muted, #8A8175); cursor: pointer; display: flex; }
  .chatdock-msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .chatdock-empty { font-size: 12.5px; color: var(--muted, #8A8175); line-height: 1.6; margin: 0; }
  .chatdock-msg { display: flex; }
  .chatdock-msg.user { justify-content: flex-end; }
  .chatdock-bubble { max-width: 82%; font-size: 13px; line-height: 1.55; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; }
  .chatdock-msg.user .chatdock-bubble { background: var(--ink, #1F1B16); color: var(--cream, #FBF8F1); border-bottom-right-radius: 4px; }
  .chatdock-msg.assistant .chatdock-bubble { background: var(--gold-wash, #FBF3E6); color: var(--ink, #1F1B16); border-bottom-left-radius: 4px; }
  .chatdock-cursor { display: inline-block; width: 6px; height: 13px; margin-left: 2px; background: var(--gold, #B08343); vertical-align: -2px; animation: chatdock-blink 1s step-start infinite; }
  @keyframes chatdock-blink { 50% { opacity: 0; } }

  @media (max-width: 640px) {
    .chatdock { padding: 10px; }
  }
`;
