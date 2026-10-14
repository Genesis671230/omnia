"use client";

/* Funnel events from the RAMZA pages — first-party, so they work with or
 * without an ad pixel, and every event also goes to the pixels via track().
 *
 *   funnel("demo_start", { industry: "ecommerce", source: "demo" })
 *
 * Events are queued and sent in small batches to /api/lead/events
 * (sendBeacon on page hide, so the last click before leaving still counts).
 * anon_id: 1-year first-party cookie — it is what ties a lead to the steps
 * that led to it. No personal data goes in props. */

import { track } from "./track";
import { getAttribution } from "./attribution";

const AID = "ramza_aid";
const SID = "ramza_sid";

/** The funnel, in order — the /leads funnel view counts unique visitors per step. */
export const FUNNEL_STEPS = [
  "page_view", "demo_start", "demo_complete", "report_open", "lead",
] as const;

/** Which pixel event each funnel event becomes (custom names are trackCustom on Meta). */
const PIXEL: Record<string, string> = {
  demo_start: "DemoStart",
  file_drop: "FileDrop",
  demo_complete: "DemoComplete",
  report_open: "ViewContent",
  tool_use: "ToolUse",
  whatsapp_click: "Contact",
  industry_pick: "IndustryPick",
};

type Ev = { name: string; props: Record<string, unknown>; path: string; ts: number };
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

function cookie(name: string): string | null {
  const m = typeof document !== "undefined" ? document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`)) : null;
  return m ? decodeURIComponent(m[1]) : null;
}
const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export function anonId(): string {
  let a = cookie(AID);
  if (!a) {
    a = rid();
    try { document.cookie = `${AID}=${a}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`; } catch { /* cookies blocked */ }
  }
  return a;
}
function sessionId(): string {
  try {
    let s = sessionStorage.getItem(SID);
    if (!s) { s = rid(); sessionStorage.setItem(SID, s); }
    return s;
  } catch { return "nosession"; }
}

function flush(beacon = false) {
  if (!queue.length) return;
  const batch = queue.splice(0, 40);
  const body = JSON.stringify({ anonId: anonId(), sessionId: sessionId(), attribution: getAttribution(), events: batch });
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/lead/events", new Blob([body], { type: "application/json" }));
    else void fetch("/api/lead/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never break the page */ }
  if (queue.length) flush(beacon);
}

export function funnel(name: string, props: Record<string, unknown> = {}, opts: { pixelEventId?: string } = {}): void {
  if (typeof window === "undefined") return;
  queue.push({ name, props, path: window.location.pathname, ts: Date.now() });
  if (!hooked) {
    hooked = true;
    window.addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(false), 1500);
  if (PIXEL[name]) track(PIXEL[name], { ...props, eventId: opts.pixelEventId });
  debugLog(name, props);
}

/* ?ramza_debug=1 → a small overlay lists every event and which pixels loaded. */
type Dbg = { name: string; props: Record<string, unknown>; at: string };
const dbg: Dbg[] = [];
const listeners = new Set<() => void>();
function debugLog(name: string, props: Record<string, unknown>) {
  dbg.unshift({ name, props, at: new Date().toLocaleTimeString() });
  dbg.length = Math.min(dbg.length, 30);
  listeners.forEach((f) => f());
}
export function debugEvents(): Dbg[] { return dbg; }
export function onDebug(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
