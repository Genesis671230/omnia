// Packaging that goes into a parcel shipped from the KSA warehouse (SMSA
// Fulfillment KSA). Read off the "KSA Orders // <month>" tabs, Aug–Oct 2026
// (270 orders):
//   full set with a bangle size (…B15/B16/B18) → SET101 + PAP999 + BAN101 | BRAC101
//   adjustable full set (no B-size)              → SET101 + PAP999
//   necklace / earrings / ring                   → PAP666 + PEN102 | EAR101 | LEDR1
//   packaging qty follows the sets: 2 sets → SET101×2, PAP999×2
// Bangle vs bracelet isn't in the SKU, so what this exact design was packed
// with before wins; the rules are only the fallback. Pure — tested.

export type PackagingOption = { sku: string; label: string; primary: boolean };

/** Every packaging SKU the KSA picker offers — all rate-0 items in Zoho. */
export const KSA_PACKAGING: PackagingOption[] = [
  { sku: "SET101", label: "Set box", primary: true },
  { sku: "PAP999", label: "Paper bag large", primary: true },
  { sku: "BAN101", label: "Bangle box", primary: true },
  { sku: "BRAC101", label: "Bracelet box", primary: true },
  { sku: "PAP666", label: "Paper bag small", primary: false },
  { sku: "EAR101", label: "Earring box", primary: false },
  { sku: "LEDR1", label: "Ring box", primary: false },
  { sku: "PEN102", label: "Pendant box", primary: false },
];
export const PACKAGING_SKUS = new Set(KSA_PACKAGING.map((p) => p.sku));

/** Names the team sometimes types instead of the SKU. */
const PACKAGING_NAME_ALIASES: Record<string, string> = {
  "LED RING BOX - LEDBOX1": "LEDR1",
  "LED EARRING BOX - LEDBOX1": "EAR101",
  "LED PENDANT BOX - LEDBOX1": "PEN102",
  "LED BANGLE BOX - LEDBOX1": "BAN101",
  "LED BRACELET BOX - LEDBOX1": "BRAC101",
};

/** Sheet SKU cell → packaging SKU, or null when it's a product. */
export function packagingSku(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (PACKAGING_SKUS.has(s)) return s;
  if (PACKAGING_NAME_ALIASES[s]) return PACKAGING_NAME_ALIASES[s];
  if (/^(SET|PAP|BAN|BRAC|EAR|PEN|LEDR?)\d+$/.test(s) || /^LED .*BOX/.test(s)) return s; // other packaging: not a product
  return null;
}

export type PackLine = { sku: string; qty: number };
/** product SKU → packaging for ONE unit, learned from the sheet. */
export type PackHistory = Map<string, { pack: PackLine[]; orders: number }>;

/** The design part of a product SKU: 999029883C1B16 → 999029883, 8887359C1 → 8887359. */
export function designOf(sku: string): string {
  const m = /^(.*?\d)C\d+/i.exec(sku.trim());
  return (m ? m[1] : sku.trim()).toUpperCase();
}

/**
 * Learn per-unit packaging from sheet rows ([ReferenceNumber, SKU, Quantity]).
 * Only orders with ONE product line are used — with two products there is no
 * telling which box went with which. The most common combo per SKU wins, and
 * each design (designOf) gets the combined count too.
 */
export function learnPackaging(rows: { ref: string; sku: string; qty: number }[]): PackHistory {
  const byOrder = new Map<string, { products: { sku: string; qty: number }[]; pack: Map<string, number> }>();
  for (const r of rows) {
    if (!r.ref || !r.sku || r.ref === "ReferenceNumber") continue;
    const o = byOrder.get(r.ref) ?? { products: [], pack: new Map<string, number>() };
    byOrder.set(r.ref, o);
    const p = packagingSku(r.sku);
    if (p) o.pack.set(p, (o.pack.get(p) ?? 0) + (r.qty || 1));
    else o.products.push({ sku: r.sku.trim().toUpperCase(), qty: r.qty || 1 });
  }
  const votes = new Map<string, Map<string, number>>();
  const vote = (key: string, combo: string) => {
    const m = votes.get(key) ?? new Map<string, number>();
    votes.set(key, m);
    m.set(combo, (m.get(combo) ?? 0) + 1);
  };
  for (const o of byOrder.values()) {
    if (o.products.length !== 1 || o.pack.size === 0) continue;
    const { sku, qty } = o.products[0];
    // Per unit; only offered packaging (others are ignored, not guessed).
    const unit = [...o.pack].filter(([k]) => PACKAGING_SKUS.has(k))
      .map(([k, n]) => ({ sku: k, qty: Math.max(1, Math.round(n / qty)) }))
      .sort((a, b) => a.sku.localeCompare(b.sku));
    if (!unit.length) continue;
    const combo = unit.map((u) => `${u.sku}:${u.qty}`).join(",");
    vote(sku, combo);
    vote(`design:${designOf(sku)}`, combo);
  }
  const out: PackHistory = new Map();
  for (const [key, m] of votes) {
    const [combo, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    out.set(key, { pack: combo.split(",").map((c) => { const [sku, q] = c.split(":"); return { sku, qty: Number(q) }; }), orders: total || n });
  }
  return out;
}

export type ProductLine = { sku: string; qty: number; title?: string };
export type LineSuggestion = { sku: string; pack: PackLine[]; basis: string };

/** Fallback when the design was never shipped from KSA before. */
export function ruleFor(line: ProductLine): { pack: PackLine[]; basis: string } {
  const t = `${line.title ?? ""}`.toLowerCase();
  const sizedBangle = /B\d{2}(-\d+)?$/i.test(line.sku.trim());
  const isSet = /full set|bridal|\bset\b/.test(t) || /^(999|888|666|111)\d/.test(line.sku.trim());
  if (isSet) {
    const box = /bracelet/.test(t) ? "BRAC101" : "BAN101";
    return sizedBangle
      ? { pack: [{ sku: "SET101", qty: 1 }, { sku: "PAP999", qty: 1 }, { sku: box, qty: 1 }], basis: `full set with bangle size — ${box === "BAN101" ? "bangle" : "bracelet"} box assumed` }
      : { pack: [{ sku: "SET101", qty: 1 }, { sku: "PAP999", qty: 1 }], basis: "adjustable full set" };
  }
  if (/necklace|pendant|chain/.test(t)) return { pack: [{ sku: "PEN102", qty: 1 }, { sku: "PAP666", qty: 1 }], basis: "necklace" };
  if (/earring/.test(t)) return { pack: [{ sku: "EAR101", qty: 1 }, { sku: "PAP666", qty: 1 }], basis: "earrings" };
  if (/bracelet/.test(t)) return { pack: [{ sku: "BRAC101", qty: 1 }, { sku: "PAP666", qty: 1 }], basis: "bracelet" };
  if (/bangle/.test(t)) return { pack: [{ sku: "BAN101", qty: 1 }, { sku: "PAP666", qty: 1 }], basis: "bangle" };
  if (/\bring\b/.test(t)) return { pack: [{ sku: "LEDR1", qty: 1 }, { sku: "PAP666", qty: 1 }], basis: "ring" };
  return { pack: [{ sku: "PAP666", qty: 1 }], basis: "no rule matched — small bag only, check it" };
}

/** Per product line: history for this SKU, else for its design, else the rule. */
export function suggestPackaging(lines: ProductLine[], history: PackHistory): { perLine: LineSuggestion[]; total: PackLine[] } {
  const perLine: LineSuggestion[] = lines.map((l) => {
    const sku = l.sku.trim().toUpperCase();
    const exact = history.get(sku);
    const design = history.get(`design:${designOf(sku)}`);
    const hit = exact ?? design;
    const base = hit
      ? { pack: hit.pack, basis: `${exact ? "this SKU" : "this design"} shipped from KSA before (${hit.orders} order${hit.orders === 1 ? "" : "s"})` }
      : ruleFor(l);
    return { sku, pack: base.pack.map((p) => ({ sku: p.sku, qty: p.qty * Math.max(1, l.qty) })), basis: base.basis };
  });
  return { perLine, total: sumPack(perLine.flatMap((p) => p.pack)) };
}

export function sumPack(lines: PackLine[]): PackLine[] {
  const m = new Map<string, number>();
  for (const l of lines) if (l.qty > 0) m.set(l.sku, (m.get(l.sku) ?? 0) + l.qty);
  const order = KSA_PACKAGING.map((p) => p.sku);
  return [...m].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => order.indexOf(a.sku) - order.indexOf(b.sku));
}
