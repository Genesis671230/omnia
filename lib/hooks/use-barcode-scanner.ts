"use client";

/* Listens for a keyboard-wedge barcode/QR scanner anywhere on the page and
 * calls onScan(code). Works with no field focused, and when a field IS
 * focused the scanned text is taken back out of it, so a scan never ends up
 * typed into the search box or a quantity input. Detection: lib/scan/scan-code.
 *
 * Fields marked data-scan-input handle scans themselves (the manual "scan /
 * type a code" box) and are left alone. */

import { useEffect, useRef } from "react";
import { ScanBuffer } from "@/lib/scan/scan-code";

type Editable = HTMLInputElement | HTMLTextAreaElement;
const isEditable = (el: Element | null): el is Editable =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|number|tel|email|url|password|)$/.test(el.type));

/** Set a React-controlled field's value so its onChange runs. */
function setFieldValue(el: Editable, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const buf = new ScanBuffer();
    // The field a burst started in, and its value before the first (leaked) key.
    let snap: { el: Editable; value: string; start: number | null; end: number | null } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // A burst that went quiet without Enter: give swallowed keys back to the field.
    const flush = () => {
      if (!buf.stale(performance.now())) return;
      const lost = buf.swallowed;
      if (lost && snap && document.activeElement === snap.el) {
        const el = snap.el;
        try {
          const at = el.selectionStart ?? el.value.length;
          setFieldValue(el, el.value.slice(0, at) + lost + el.value.slice(el.selectionEnd ?? at));
          el.setSelectionRange?.(at + lost.length, at + lost.length);
        } catch { setFieldValue(el, el.value + lost); }
      }
      buf.reset();
      snap = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const target = document.activeElement;
      if (target instanceof HTMLElement && target.closest("[data-scan-input]")) { buf.reset(); return; }
      const fresh = buf.pending.length === 0 || buf.stale(e.timeStamp || performance.now());
      if (fresh && isEditable(target)) {
        let start: number | null = null, end: number | null = null;
        try { start = target.selectionStart; end = target.selectionEnd; } catch { /* number inputs have no selection */ }
        snap = { el: target, value: target.value, start, end };
      } else if (fresh) snap = null;

      const r = buf.feed({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, time: e.timeStamp || performance.now() });
      if (timer) clearTimeout(timer);
      if (r.kind === "swallow") {
        e.preventDefault();
        e.stopPropagation();
        timer = setTimeout(flush, 300);
      } else if (r.kind === "scan") {
        e.preventDefault();
        e.stopPropagation();
        // Take the leaked first keys back out of the field the scan landed in.
        if (snap && snap.el.value !== snap.value) {
          setFieldValue(snap.el, snap.value);
          try { if (snap.start != null) snap.el.setSelectionRange(snap.start, snap.end ?? snap.start); } catch { /* ignore */ }
        }
        snap = null;
        cb.current(r.code);
      } else if (buf.pending.length) {
        timer = setTimeout(flush, 300);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (timer) clearTimeout(timer); };
  }, [enabled]);
}

/** Short beep for scan feedback — packers look at the box, not the screen. */
export function scanBeep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 1320 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.28));
    o.onended = () => ctx.close();
  } catch { /* audio blocked — the toast still shows */ }
}

/** A scanned packaging box, broadcast to whichever pack panel is the scan target. */
export type PackBoxEvent = CustomEvent<{ sku: string; handled: boolean; message?: string }>;
export const PACK_BOX_EVENT = "omnia:pack-box";
export function broadcastBox(sku: string): { handled: boolean; message?: string } {
  const detail = { sku, handled: false as boolean, message: undefined as string | undefined };
  window.dispatchEvent(new CustomEvent(PACK_BOX_EVENT, { detail }));
  return detail;
}
