// Barcode / QR scanner support for the orders page. Pure — tested.
//
// USB and Bluetooth scanners act as a keyboard: they "type" the code in one
// fast burst (≈5–40 ms between keys) and finish with Enter (some with Tab).
// A person types ≥ 80 ms apart, so a burst of 3+ keys closed by Enter is a
// scan. Keys are read from the physical key (KeyboardEvent.code) when the
// layout gives a non-ASCII character, so a scan still reads "SET101" while
// the PC is on the Arabic layout.

import { KSA_PACKAGING, PACKAGING_SKUS, packagingSku } from "@/lib/ksa-dispatch/packaging";

/** A burst continues while keys come within this many ms of each other… */
export const SCAN_MAX_GAP_MS = 120;
/** …and is a scan when its keys average at most this (scanners: 5–40 ms; even fast typists: 100+). */
export const SCAN_MAX_AVG_MS = 60;
export const SCAN_MIN_LENGTH = 3;

export type KeyIn = { key: string; code: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; time: number };

const SHIFT_DIGITS = ")!@#$%^&*(";
const CODE_CHARS: Record<string, [string, string]> = {
  Minus: ["-", "_"], Equal: ["=", "+"], Period: [".", ">"], Comma: [",", "<"], Slash: ["/", "?"],
  Semicolon: [";", ":"], Quote: ["'", "\""], BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"],
  Backquote: ["`", "~"], Space: [" ", " "], NumpadDecimal: [".", "."], NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"],
  NumpadDivide: ["/", "/"], NumpadMultiply: ["*", "*"],
};

/** The ASCII character a key stands for, or null (modifier, arrow, F-key…). */
export function charOf(e: Pick<KeyIn, "key" | "code" | "shiftKey">): string | null {
  if (e.key.length === 1) {
    const c = e.key.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) return e.key;
  }
  // Non-ASCII layout (Arabic) or dead key: fall back to the physical key.
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m) return e.shiftKey ? m[1] : m[1].toLowerCase();
  const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (d) return e.shiftKey && e.code.startsWith("Digit") ? SHIFT_DIGITS[Number(d[1])] : d[1];
  const p = CODE_CHARS[e.code];
  return p ? p[e.shiftKey ? 1 : 0] : null;
}

const TERMINATORS = new Set(["Enter", "NumpadEnter", "Tab"]);

export type FeedResult =
  /** Not part of a scan (or not yet known to be). */
  | { kind: "pass" }
  /** Inside a burst: swallow the key so it doesn't land in a focused field. */
  | { kind: "swallow" }
  /** Terminator closed a scan. */
  | { kind: "scan"; code: string };

/**
 * Keyboard-burst detector. Feed every keydown; it answers whether the key is
 * an ordinary keystroke, part of a scan to swallow, or the end of a scan.
 * The first two keys of a burst can't be told from typing, so they pass —
 * the caller undoes them when the scan completes (see `leaked`).
 */
export class ScanBuffer {
  private chars: string[] = [];
  private first = -Infinity;
  private last = -Infinity;
  /** How many of the current burst's chars were let through (not swallowed) — always a prefix. */
  leaked = 0;
  constructor(private maxGap = SCAN_MAX_GAP_MS, private maxAvg = SCAN_MAX_AVG_MS, private minLength = SCAN_MIN_LENGTH) {}

  get pending(): string { return this.chars.join(""); }
  /** Chars swallowed so far — handed back to the field when a burst turns out not to be a scan. */
  get swallowed(): string { return this.chars.slice(this.leaked).join(""); }
  /** Average ms between the burst's keys. A busy page can stretch single gaps; the average stays scanner-fast. */
  private avg(): number { return this.chars.length < 2 ? Infinity : (this.last - this.first) / (this.chars.length - 1); }

  reset() { this.chars = []; this.leaked = 0; this.first = -Infinity; this.last = -Infinity; }

  feed(e: KeyIn): FeedResult {
    if (e.ctrlKey || e.metaKey || e.altKey) { this.reset(); return { kind: "pass" }; }
    const gap = e.time - this.last;
    if (TERMINATORS.has(e.key) || TERMINATORS.has(e.code)) {
      const code = this.pending;
      const isScan = code.length >= this.minLength && this.avg() <= this.maxAvg && gap <= this.maxGap * 2;
      this.reset();
      return isScan ? { kind: "scan", code } : { kind: "pass" };
    }
    const ch = charOf(e);
    if (ch == null) {
      if (e.key === "Shift" || e.key === "CapsLock") return this.chars.length > this.leaked ? { kind: "swallow" } : { kind: "pass" };
      this.reset();
      return { kind: "pass" };
    }
    if (gap > this.maxGap) { this.chars = []; this.leaked = 0; this.first = e.time; }
    this.chars.push(ch);
    this.last = e.time;
    // Once swallowing starts it lasts the whole burst (swallowed chars stay a suffix).
    if (this.leaked < this.chars.length - 1 || (this.chars.length >= 3 && this.avg() <= this.maxAvg)) return { kind: "swallow" };
    this.leaked = this.chars.length;
    return { kind: "pass" };
  }

  /** True when the burst has gone quiet without a terminator (person typing fast, or a scanner without Enter). */
  stale(now: number): boolean { return this.chars.length > 0 && now - this.last > this.maxGap * 2; }
}

/** Scanner text → a code to look up: trims, keeps a URL's last path segment, drops "#", upper-cases. */
export function normalizeScan(raw: string): string {
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (/^(https?:\/\/|www\.)/i.test(s)) {
    try {
      const u = new URL(/^www\./i.test(s) ? `https://${s}` : s);
      const q = u.searchParams.get("sku") ?? u.searchParams.get("code") ?? u.searchParams.get("order");
      s = q ?? u.pathname.split("/").filter(Boolean).pop() ?? s;
    } catch { /* not a URL after all */ }
  }
  return s.replace(/^#+/, "").replace(/\s+/g, "").toUpperCase();
}

/** A scanned code → the packaging SKU it is (SET101, BAN101 …), or null.
 *  `barcodes` maps printed barcodes (EAN, supplier codes) to a SKU — Settings → packaging.barcodes. */
export function boxSkuFor(code: string, barcodes: Record<string, string> = {}): string | null {
  const c = normalizeScan(code);
  if (!c) return null;
  const mapped = Object.entries(barcodes).find(([k]) => normalizeScan(k) === c)?.[1];
  if (mapped) {
    const m = mapped.trim().toUpperCase();
    return PACKAGING_SKUS.has(m) ? m : null;
  }
  for (const candidate of [c, code.trim().toUpperCase(), c.replace(/[^A-Z0-9]/g, "")]) {
    const sku = packagingSku(candidate);
    if (sku && PACKAGING_SKUS.has(sku)) return sku;
  }
  return null;
}

export const boxLabel = (sku: string) => KSA_PACKAGING.find((p) => p.sku === sku)?.label ?? sku;
