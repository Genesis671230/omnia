import { test } from "node:test";
import assert from "node:assert/strict";
import { ScanBuffer, boxSkuFor, charOf, normalizeScan, type KeyIn } from "@/lib/scan/scan-code";

/** Keydowns for `text` + Enter, `gap` ms apart, upper-case letters preceded by Shift like a HID scanner. */
function keys(text: string, gap: number, t0 = 1000, terminator = "Enter"): KeyIn[] {
  const out: KeyIn[] = [];
  let t = t0;
  for (const ch of text) {
    const upper = /[A-Z]/.test(ch);
    if (upper) out.push({ key: "Shift", code: "ShiftLeft", shiftKey: true, time: t });
    const code = /[A-Za-z]/.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : "Minus";
    out.push({ key: ch, code, shiftKey: upper, time: t });
    t += gap;
  }
  out.push({ key: terminator, code: terminator, shiftKey: false, time: t });
  return out;
}
const run = (b: ScanBuffer, ks: KeyIn[]) => ks.map((k) => b.feed(k));

test("a fast burst closed by Enter is a scan; keys from the 3rd on are swallowed", () => {
  const b = new ScanBuffer();
  const r = run(b, keys("SET101", 8));
  const last = r[r.length - 1];
  assert.deepEqual(last, { kind: "scan", code: "SET101" });
  const chars = r.filter((_, i) => keys("SET101", 8)[i].key.length === 1);
  assert.deepEqual(chars.map((x) => x.kind), ["pass", "pass", "swallow", "swallow", "swallow", "swallow"]);
});

test("a person typing (120 ms apart) is never a scan and nothing is swallowed", () => {
  const b = new ScanBuffer();
  const r = run(b, keys("OS4441", 120));
  assert.ok(r.every((x) => x.kind === "pass"));
});

test("Tab terminator and slower Bluetooth scanners (35 ms) still scan", () => {
  const b = new ScanBuffer();
  const r = run(b, keys("OS4441", 35, 0, "Tab"));
  assert.deepEqual(r[r.length - 1], { kind: "scan", code: "OS4441" });
});

test("Arabic keyboard layout: the physical key is used", () => {
  assert.equal(charOf({ key: "س", code: "KeyS", shiftKey: false }), "s");
  assert.equal(charOf({ key: "١", code: "Digit1", shiftKey: false }), "1");
  assert.equal(charOf({ key: "Shift", code: "ShiftLeft", shiftKey: true }), null);
  const b = new ScanBuffer();
  const ar: KeyIn[] = [["ش", "KeyA"], ["س", "KeyS"], ["ي", "KeyD"]].map(([key, code], i) => ({ key, code, shiftKey: false, time: i * 5 }));
  run(b, ar);
  assert.deepEqual(b.feed({ key: "Enter", code: "Enter", shiftKey: false, time: 20 }), { kind: "scan", code: "asd" });
});

test("a pause splits bursts; two-key bursts are not scans; modifiers reset", () => {
  const b = new ScanBuffer();
  run(b, keys("ZZZZ", 5, 0).slice(0, -1)); // no Enter
  assert.equal(b.stale(500), true);
  const r = run(b, keys("ab", 5, 1000));
  assert.deepEqual(r[r.length - 1], { kind: "pass" });
  b.feed({ key: "c", code: "KeyC", shiftKey: false, ctrlKey: true, time: 2000 });
  assert.equal(b.pending, "");
});

test("normalizeScan: URLs, # and case", () => {
  assert.equal(normalizeScan("  #os4441\r"), "OS4441");
  assert.equal(normalizeScan("https://omnia.example/box/SET101"), "SET101");
  assert.equal(normalizeScan("https://x.io/p?sku=ban101"), "BAN101");
});

test("boxSkuFor: packaging SKUs, separators, barcode map, products are not boxes", () => {
  assert.equal(boxSkuFor("set101"), "SET101");
  assert.equal(boxSkuFor("SET-101"), "SET101");
  assert.equal(boxSkuFor("LED BANGLE BOX - LEDBOX1"), "BAN101");
  assert.equal(boxSkuFor("6291100000017", { "6291100000017": "PAP999" }), "PAP999");
  assert.equal(boxSkuFor("6291100000017", { "6291100000017": "NOTABOX" }), null);
  assert.equal(boxSkuFor("999029883C1B16"), null);
  assert.equal(boxSkuFor("OS4441"), null);
  assert.equal(boxSkuFor("SET102"), null); // packaging, but not one the picker offers
});

test("a busy page stretching one gap past 100 ms doesn't break the scan (average decides)", () => {
  const b = new ScanBuffer();
  const times = [0, 106, 154, 162, 170, 178];
  const r = [..."OS4436"].map((ch, i) => b.feed({ key: ch, code: /\d/.test(ch) ? `Digit${ch}` : `Key${ch}`, shiftKey: false, time: times[i] }));
  assert.deepEqual(r.map((x) => x.kind), ["pass", "pass", "pass", "swallow", "swallow", "swallow"]);
  assert.equal(b.leaked, 3);
  assert.equal(b.swallowed, "436");
  assert.deepEqual(b.feed({ key: "Enter", code: "Enter", shiftKey: false, time: 186 }), { kind: "scan", code: "OS4436" });
});

test("a fast typist at ~90 ms a key + Enter is not a scan", () => {
  const b = new ScanBuffer();
  const r = run(b, keys("OS44", 90));
  assert.ok(r.every((x) => x.kind === "pass"));
});
