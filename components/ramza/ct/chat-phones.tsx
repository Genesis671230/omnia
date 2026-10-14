"use client";

/* Two real-looking phones: a WhatsApp chat (iOS light) with the RAMZA
 * assistant and a Telegram finance group (dark) with the RAMZA bot — the
 * messages type in one by one, loop, and a lock-screen style banner drops
 * in above. The UIs are drawn in code to look like the apps people already
 * use (colours, bubbles, ticks, wallpaper, inline buttons); no app logos are
 * copied. Companies and numbers in the scripts are illustrative.
 *
 *   <WhatsAppPhone script={…} />   <TelegramPhone script={…} />
 *   <ChatPhonesPair />              both, overlapped — used in the hero */

import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ── scripts ─────────────────────────────────────────────────────────── */

export type WaMsg =
  | { from: "them" | "me"; time: string; text: string }
  | { from: "them"; time: string; doc: { name: string; meta: string } }
  | { from: "them"; time: string; card: { title: string; rows: [string, string, "ok" | "warn" | "plain"?][] } };

export type TgMsg =
  | { who: string; color?: string; me?: boolean; time: string; text: string; buttons?: string[]; pressed?: number }
  | { who: string; color?: string; time: string; progress: { label: string; done: number; total: number } };

export const WA_EINV: WaMsg[] = [
  { from: "them", time: "09:02", text: "Good morning ☀️ Here's where your invoice backlog stands before e-invoicing:" },
  { from: "them", time: "09:02", card: { title: "Readiness · Al Noor Trading", rows: [["Invoices open", "214 → 38", "ok"], ["Missing buyer TRN", "11", "warn"], ["Payouts unmatched", "0", "ok"], ["Credit notes to raise", "6", "warn"]] } },
  { from: "them", time: "09:03", doc: { name: "Backlog-close-plan.pdf", meta: "3 pages · PDF · 212 KB" } },
  { from: "me", time: "09:10", text: "Can we close it by month end?" },
  { from: "them", time: "09:10", text: "Yes — 38 left, about two days of work. I've drafted the 6 credit notes for your OK, and asked the 11 buyers for their TRNs." },
  { from: "me", time: "09:12", text: "Approve all 👍" },
  { from: "them", time: "09:12", text: "Done ✓ Posted to Zoho. 32 left — I'll send the daily count at 6 pm." },
];

export const TG_EINV: TgMsg[] = [
  { who: "RAMZA bot", color: "#6AB3F3", time: "18:00", progress: { label: "Invoice backlog — month-end close", done: 182, total: 214 } },
  { who: "RAMZA bot", color: "#6AB3F3", time: "18:00", text: "⚠️ 4 invoices still have no buyer TRN. 2 Tabby refunds need a credit note.", buttons: ["Approve credit notes", "Show the 4 invoices"], pressed: 0 },
  { who: "Sara · Finance", color: "#E8A15A", time: "18:04", text: "Approved ✅ chasing the TRNs now" },
  { who: "RAMZA bot", color: "#6AB3F3", time: "18:04", text: "Credit notes CN-1041, CN-1042 booked ✓\n30 to go · on track for month end 🎯" },
];

/* ── ticker: reveals n messages, holds, loops ───────────────────────── */

function useReveal(n: number, run: boolean, still: boolean, step = 1600, hold = 5200) {
  const [k, setK] = useState(still ? n : 0);
  useEffect(() => {
    if (still) { setK(n); return; }
    if (!run) return;
    const t = setTimeout(() => setK((x) => (x >= n ? 0 : x + 1)), k >= n ? hold : k === 0 ? 700 : step);
    return () => clearTimeout(t);
  }, [k, n, run, still, step, hold]);
  return k;
}

/* ── shared phone shell (iPhone-ish: bezel, island, status bar) ─────── */

function StatusBar({ dark }: { dark?: boolean }) {
  const c = dark ? "#FFFFFF" : "#0B0B0C";
  return (
    <div className="relative z-10 flex h-[46px] items-end justify-between px-7 pb-1.5 text-[13px] font-semibold" style={{ color: c }}>
      <span className="tabular-nums">9:41</span>
      <span className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" fill={c} aria-hidden><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill={c} aria-hidden><path d="M7.5 2.2c2 0 3.8.8 5.2 2.1l1.1-1.1A8.9 8.9 0 0 0 7.5.6 8.9 8.9 0 0 0 1.2 3.2l1.1 1.1A7.3 7.3 0 0 1 7.5 2.2Zm0 3.1c1.2 0 2.2.4 3 1.2l1.1-1.1a5.8 5.8 0 0 0-8.2 0l1.1 1.1c.8-.8 1.8-1.2 3-1.2Zm0 3.1c-.4 0-.8.2-1.1.5L7.5 10l1.1-1.1a1.6 1.6 0 0 0-1.1-.5Z" /></svg>
        <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden><rect x=".5" y=".5" width="21" height="11" rx="3.2" fill="none" stroke={c} strokeOpacity=".4" /><rect x="2" y="2" width="16" height="8" rx="2" fill={c} /><path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z" fill={c} fillOpacity=".5" /></svg>
      </span>
    </div>
  );
}

function Phone({ children, dark, className = "" }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <div className={`relative w-[300px] shrink-0 rounded-[52px] bg-[#1B1B1F] p-[10px] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.08)_inset] ${className}`}>
      {/* side buttons */}
      <span aria-hidden className="absolute -left-[3px] top-[110px] h-8 w-[3px] rounded-l bg-[#2A2A30]" />
      <span aria-hidden className="absolute -left-[3px] top-[154px] h-14 w-[3px] rounded-l bg-[#2A2A30]" />
      <span aria-hidden className="absolute -right-[3px] top-[140px] h-20 w-[3px] rounded-r bg-[#2A2A30]" />
      <div className={`relative h-[600px] overflow-hidden rounded-[43px] ${dark ? "bg-[#0E1621]" : "bg-[#F6F6F6]"}`}>
        {/* dynamic island */}
        <span aria-hidden className="absolute left-1/2 top-[11px] z-20 h-[27px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
        <StatusBar dark={dark} />
        {children}
        {/* home indicator */}
        <span aria-hidden className={`absolute bottom-[7px] left-1/2 z-20 h-[5px] w-[110px] -translate-x-1/2 rounded-full ${dark ? "bg-white/80" : "bg-black/85"}`} />
      </div>
    </div>
  );
}

/* ── WhatsApp (iOS, light) ──────────────────────────────────────────── */

// The beige doodle wallpaper, approximated with faint line icons on a tile.
const WA_WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='#cdbfa9' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round' opacity='.55'><path d='M14 18h16v12H14zM18 18v-4h8v4'/><circle cx='86' cy='22' r='8'/><path d='M82 22h8M86 18v8'/><path d='M50 56c6-8 14-8 20 0'/><path d='M20 78l8 8 14-16'/><rect x='76' y='70' width='22' height='16' rx='3'/><path d='M80 76h14M80 81h9'/><path d='M44 100c4 6 12 6 16 0'/><circle cx='104' cy='104' r='5'/><path d='M8 52l6-6 6 6'/></svg>`,
)}")`;

function Ticks() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" className="ml-0.5 inline-block" aria-label="Read">
      <path d="M11.1.7 4.9 7.6 2.2 5" fill="none" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.1.7 8.9 7.6 7.7 6.4" fill="none" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WaBubble({ m }: { m: WaMsg }) {
  const me = m.from === "me";
  const meta = (
    <span className="float-right ml-2 mt-1.5 flex translate-y-[3px] items-center text-[10.5px] leading-none text-[#667781]">
      {m.time}{me && <Ticks />}
    </span>
  );
  const tail = me
    ? <svg className="absolute -right-[7px] top-0" width="8" height="13" viewBox="0 0 8 13" aria-hidden><path d="M0 0h8L1.5 8.5C1 9.3 0 9 0 8Z" fill="#D9FDD3" /></svg>
    : <svg className="absolute -left-[7px] top-0" width="8" height="13" viewBox="0 0 8 13" aria-hidden><path d="M8 0H0l6.5 8.5c.5.8 1.5.5 1.5-.5Z" fill="#FFFFFF" /></svg>;
  return (
    <div className={`relative max-w-[84%] rounded-[8px] px-2 py-1 text-[13px] leading-[1.32] text-[#111B21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${me ? "self-end rounded-tr-none bg-[#D9FDD3]" : "self-start rounded-tl-none bg-white"}`}>
      {tail}
      {"text" in m && <span className="whitespace-pre-line">{m.text}{meta}</span>}
      {"doc" in m && (
        <div className="w-[200px]">
          <div className="flex items-center gap-2.5 rounded-md bg-[#F5F6F6] px-2.5 py-2">
            <span className="grid h-9 w-7 place-items-center rounded-[3px] bg-[#E5484D] text-[8px] font-bold text-white">PDF</span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium">{m.doc.name}</div>
              <div className="text-[10.5px] text-[#667781]">{m.doc.meta}</div>
            </div>
          </div>
          <div className="h-3">{meta}</div>
        </div>
      )}
      {"card" in m && (
        <div className="w-[208px]">
          <div className="border-b border-[#E9EDEF] pb-1.5 text-[12.5px] font-semibold">{m.card.title}</div>
          <ul className="mt-1 space-y-[3px]">
            {m.card.rows.map(([k, v, s]) => (
              <li key={k} className="flex items-center justify-between text-[12px]">
                <span className="text-[#54656F]">{k}</span>
                <span className={`font-semibold tabular-nums ${s === "ok" ? "text-[#008069]" : s === "warn" ? "text-[#C77700]" : ""}`}>{v}</span>
              </li>
            ))}
          </ul>
          <div className="h-3">{meta}</div>
        </div>
      )}
    </div>
  );
}

function WaTyping() {
  return (
    <div className="relative self-start rounded-[8px] rounded-tl-none bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="h-[7px] w-[7px] rounded-full bg-[#8696A0]" animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
        ))}
      </span>
    </div>
  );
}

export function WhatsAppPhone({ script = WA_EINV, name = "RAMZA", className }: { script?: WaMsg[]; name?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const still = !!useReducedMotion();
  const k = useReveal(script.length, inView, still);
  const typing = !still && inView && k < script.length && script[k]?.from === "them";
  const shown = script.slice(0, k);

  return (
    <div ref={ref}>
      <Phone className={className}>
        {/* header */}
        <div className="relative z-10 flex items-center gap-2 border-b border-black/[0.06] bg-[#F6F6F6]/95 px-2.5 pb-2 pt-1 backdrop-blur">
          <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden><path d="M10 2 2 10l8 8" fill="none" stroke="#007AFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="-ml-0.5 text-[15px] text-[#007AFF]">12</span>
          <span className="ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#4F35E8] to-[#2A1BA8] text-[13px] font-bold tracking-wide text-white">R</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-semibold text-black">{name}</div>
            <div className="truncate text-[11.5px] text-[#667781]">{typing ? "typing…" : "Business account"}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" aria-hidden><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10.5 5-3v9l-5-3" strokeLinejoin="round" /></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" className="ml-3 mr-1" aria-hidden><path d="M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6.5 6.5l1.5-2.3 4.5 1.8V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2Z" strokeLinejoin="round" /></svg>
        </div>

        {/* chat */}
        <div className="absolute inset-x-0 bottom-[78px] top-[100px] overflow-hidden bg-[#EFEAE2]" style={{ backgroundImage: WA_WALLPAPER, backgroundSize: "120px" }}>
          <div className="flex h-full flex-col justify-end gap-[5px] px-3.5 pb-2">
            <div className="mx-auto mb-1 rounded-md bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-[#54656F] shadow-sm">Today</div>
            <AnimatePresence initial={false}>
              {shown.map((m, i) => (
                <motion.div key={i} layout="position" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ type: "spring", stiffness: 420, damping: 32 }} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                  <WaBubble m={m} />
                </motion.div>
              ))}
              {typing && <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex"><WaTyping /></motion.div>}
            </AnimatePresence>
          </div>
        </div>

        {/* composer */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex h-[78px] items-start gap-2.5 bg-[#F6F6F6] px-3 pt-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" className="mt-1.5" aria-hidden><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
          <div className="flex h-[34px] flex-1 items-center justify-end rounded-full bg-white px-2.5 ring-1 ring-black/[0.08]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" aria-hidden><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="9.5" cy="10" r=".9" fill="#007AFF" /><circle cx="14.5" cy="10" r=".9" fill="#007AFF" /><path d="M9 14.5c1.6 1.4 4.4 1.4 6 0" strokeLinecap="round" /></svg>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" className="mt-1.5" aria-hidden><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" /><circle cx="12" cy="12.5" r="3.5" /></svg>
          <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8" className="mt-1.5" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" /></svg>
        </div>
      </Phone>
    </div>
  );
}

/* ── Telegram (iOS, night) ──────────────────────────────────────────── */

const TG_WALLPAPER =
  "radial-gradient(120% 70% at 0% 0%, rgba(58,96,140,0.55), transparent 60%), radial-gradient(90% 60% at 100% 100%, rgba(52,80,120,0.5), transparent 60%), #0E1621";

function TgBubble({ m, pressedOn }: { m: TgMsg; pressedOn: boolean }) {
  const me = "me" in m && m.me;
  return (
    <div className={`max-w-[88%] ${me ? "self-end" : "self-start"}`}>
      <div className={`rounded-[16px] px-2.5 pb-1.5 pt-1 text-[13px] leading-[1.33] text-white ${me ? "rounded-br-[5px] bg-[#2B5278]" : "rounded-bl-[5px] bg-[#182533]"}`}>
        {!me && <div className="text-[12px] font-semibold" style={{ color: m.color ?? "#6AB3F3" }}>{m.who}</div>}
        {"text" in m && <span className="whitespace-pre-line">{m.text}</span>}
        {"progress" in m && (
          <div className="w-[200px] pb-0.5">
            <div className="text-[12.5px] font-medium">📋 {m.progress.label}</div>
            <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-[#3AA0F0] to-[#5FE0A8]" initial={{ width: 0 }} animate={{ width: `${(m.progress.done / m.progress.total) * 100}%` }} transition={{ duration: 1.2, ease: "easeOut" }} />
            </div>
            <div className="mt-1 flex justify-between text-[11.5px] text-white/70"><span>{m.progress.done} of {m.progress.total} closed</span><span>{Math.round((m.progress.done / m.progress.total) * 100)}%</span></div>
          </div>
        )}
        <div className="mt-0.5 text-right text-[10.5px] text-white/45">{m.time}{me && <span className="ml-1 text-[#6AB3F3]">✓✓</span>}</div>
      </div>
      {"buttons" in m && m.buttons && (
        <div className="mt-[3px] grid grid-cols-2 gap-[3px]">
          {m.buttons.map((b, i) => (
            <motion.span key={b} animate={pressedOn && m.pressed === i ? { scale: [1, 0.94, 1], backgroundColor: ["rgba(24,37,51,0.85)", "rgba(58,110,165,0.9)", "rgba(24,37,51,0.85)"] } : {}} transition={{ duration: 0.6 }}
              className="rounded-[10px] bg-[#182533]/85 px-2 py-1.5 text-center text-[11.5px] font-medium text-white backdrop-blur">
              {b}
            </motion.span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TelegramPhone({ script = TG_EINV, title = "Finance · Month-end", members = "4 members", className }: { script?: TgMsg[]; title?: string; members?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const still = !!useReducedMotion();
  const k = useReveal(script.length, inView, still, 2100, 4800);
  const shown = script.slice(0, k);

  return (
    <div ref={ref}>
      <Phone dark className={className}>
        <div className="relative z-10 flex items-center gap-2 bg-[#17212B]/95 px-2.5 pb-2 pt-1 backdrop-blur">
          <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden><path d="M10 2 2 10l8 8" fill="none" stroke="#6AB3F3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="text-[15px] text-[#6AB3F3]">Chats</span>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <div className="truncate text-[15px] font-semibold text-white">{title}</div>
            <div className="truncate text-[11.5px] text-white/50">{members}</div>
          </div>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#5FE0A8] to-[#2E9E8F] text-[13px] font-bold text-white">F</span>
        </div>

        <div className="absolute inset-x-0 bottom-[78px] top-[100px] overflow-hidden" style={{ background: TG_WALLPAPER }}>
          <div className="flex h-full flex-col justify-end gap-[6px] px-2.5 pb-2">
            <div className="mx-auto mb-1 rounded-full bg-black/25 px-2.5 py-0.5 text-[11px] font-medium text-white/80">Today</div>
            <AnimatePresence initial={false}>
              {shown.map((m, i) => (
                <motion.div key={i} layout="position" initial={{ opacity: 0, x: "me" in m && m.me ? 20 : -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ type: "spring", stiffness: 380, damping: 30 }} className="flex flex-col">
                  <TgBubble m={m} pressedOn={k > i + 1} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 flex h-[78px] items-start gap-2.5 bg-[#17212B] px-3 pt-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7F8B97" strokeWidth="1.8" className="mt-1.5" aria-hidden><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.3-2.4l7.3-7.3" strokeLinecap="round" /></svg>
          <div className="flex h-[34px] flex-1 items-center rounded-full bg-[#0E1621] px-3 text-[13px] text-white/35 ring-1 ring-white/10">Message</div>
          <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke="#7F8B97" strokeWidth="1.8" className="mt-1.5" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" /></svg>
        </div>
      </Phone>
    </div>
  );
}

/* ── notification banner (iOS style) ────────────────────────────────── */

export function PushBanner({ app, tint, title, body, delay = 0 }: { app: string; tint: string; title: string; body: string; delay?: number }) {
  const still = !!useReducedMotion();
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: -24, scale: 0.96 }}
      animate={still ? undefined : { opacity: [0, 1, 1, 0], y: [-24, 0, 0, -18], scale: [0.96, 1, 1, 0.98] }}
      transition={still ? undefined : { duration: 6, times: [0, 0.1, 0.85, 1], repeat: Infinity, repeatDelay: 3, delay }}
      className="flex w-[290px] items-start gap-2.5 rounded-[20px] bg-white/80 p-3 text-[#0B0B0C] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/50 backdrop-blur-xl"
    >
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px]" style={{ background: tint }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden><path d="M12 3C7 3 3 6.6 3 11c0 2.3 1.1 4.4 2.9 5.9L5 21l4.3-2.2c.9.2 1.8.3 2.7.3 5 0 9-3.6 9-8s-4-8.1-9-8.1Z" /></svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-[11.5px] text-black/50"><span className="font-medium uppercase tracking-wide">{app}</span><span>now</span></div>
        <div className="truncate text-[13.5px] font-semibold">{title}</div>
        <div className="line-clamp-2 text-[13px] leading-snug text-black/80">{body}</div>
      </div>
    </motion.div>
  );
}

/* ── the pair, overlapped (hero) ────────────────────────────────────── */

export function ChatPhonesPair() {
  return (
    <div className="relative mx-auto h-[640px] w-full max-w-[560px]">
      <div className="absolute right-0 top-10 hidden origin-bottom-left rotate-[5deg] sm:block">
        <TelegramPhone />
      </div>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 sm:left-0 sm:translate-x-0">
        <WhatsAppPhone />
      </div>
      <div className="absolute -right-4 top-2 z-30 hidden lg:block">
        <PushBanner app="WhatsApp" tint="#25D366" title="RAMZA" body="Backlog: 32 invoices left to close before month end. 6 credit notes posted ✓" delay={2.5} />
      </div>
    </div>
  );
}
