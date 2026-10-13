// What it takes to close one draft sales order — pure, so every rule is tested.
//
// The default convention is read off the sales orders the team already closed
// in Zoho (OS4051, OS4060 UAE · SA4063, OS4041 KSA, Oct 2026), and every part
// of it is a setting (salesorders.* in lib/settings/registry.ts):
//   UAE    vat_not_registered, place of supply = the emirate, Standard Rate 5%
//          on every line, shipping included
//   GCC    gcc_vat_not_registered, place of supply = the country, Zero Rate
//   other  non_gcc, Zero Rate
//   Always AED: foreign orders are entered at the fixed rate table.
//   Packaging from the packing sheet goes on as rate-0 lines from the same
//   warehouse as the jewellery, so Zoho moves the box/bag stock.
//   Packaging kits on the draft (ledsp9 "set box and pap999", a Zoho combo)
//   are swapped for their components, so the sheet's boxes are never counted
//   twice and the batch-tracked box gets a batch like any other line.
//   Zoho lets a non-batch item go below zero (PAP999 read −97 in Omniastores
//   LLC on 2026-10-12 and still invoiced), so short bags/boxes are a warning;
//   batch-tracked items still need a batch with stock.
//
// What broke daily closing (drafts Oct 2026): KSA drafts arrive with the UAE
// treatment (vat_not_registered / SH), the UAE shipping line arrives
// tax-exempt (SO total short by the shipping VAT, 784.57 vs 786), no
// packaging lines — and batch-tracked jewellery can't be invoiced without a
// batch per line (Zoho code 2302).
//
// COD orders: the sale is booked in House of Omnia, so the Omniastores sales
// order only moves the stock — every line goes to AED 0 and its invoice is
// zero (paid as soon as it is sent).

export const GCC_COUNTRIES = ["SA", "KW", "QA", "OM", "BH"] as const;
const EMIRATES = new Set(["DU", "AB", "SH", "AJ", "UQ", "RK", "FU"]);

export type Region = "UAE" | "GCC" | "INTL";
export type SoRules = {
  rates: Record<string, number>;
  regions: Record<Region, { tax_treatment: string; tax_name: string }>;
  /** % of the order total; never below AED 1. Draft lines are built from
   *  per-item conversions, so a foreign order lands up to ~1 AED off
   *  (SA4066: 1660.86 vs 1659.76). */
  tolerancePct: number;
  /** packing-sheet SKU → Zoho SKU */
  aliases: Record<string, string>;
};
export const DEFAULT_RULES: SoRules = {
  rates: { AED: 1, SAR: 0.98, KWD: 11.99, QAR: 1, OMR: 9.54, USD: 3.67 },
  regions: {
    UAE: { tax_treatment: "vat_not_registered", tax_name: "Standard Rate" },
    GCC: { tax_treatment: "gcc_vat_not_registered", tax_name: "Zero Rate" },
    INTL: { tax_treatment: "non_gcc", tax_name: "Zero Rate" },
  },
  tolerancePct: 0.2,
  aliases: {},
};
/** The Zoho tax each region resolves to. */
export type RegionTax = Record<Region, { tax_id: string; pct: number }>;

export type SoLine = {
  line_item_id: string; item_id: string; sku?: string; name?: string; description?: string;
  quantity: number; rate: number; discount?: string | number; tax_id?: string; tax_percentage?: number;
  tax_exemption_id?: string; item_total: number; warehouse_id?: string; unit?: string;
  item_type?: string; product_type?: string; track_batch_number?: boolean;
};
export type SoDetail = {
  salesorder_id: string; salesorder_number: string; status: string; date: string; customer_id: string;
  customer_name?: string; tax_treatment: string; place_of_supply: string; currency_code: string;
  reference_number?: string; notes?: string; shipment_date?: string;
  total: number; line_items: SoLine[]; invoices?: { invoice_id: string; invoice_number: string }[];
};
export type OrderFacts = { country: string | null; currency: string | null; grossOriginal: number | null; storeId?: string | null; orderDate?: string | null; discountAed?: number | null; gateway?: string | null };

export const isCodOrder = (order: Pick<OrderFacts, "gateway"> | null | undefined) => (order?.gateway ?? "").trim().toUpperCase() === "COD";
export type PackItem = { item_id: string; sku: string; name: string; stockTracked: boolean; trackBatch?: boolean };
/** item_id → warehouse_id → available qty */
export type StockMap = Map<string, Map<string, number>>;

export type Issue = { code: string; message: string; blocking: boolean };
/** `soft`: packaging without batches — Zoho invoices it below zero, so short stock only warns. */
export type Consume = { item_id: string; sku: string; warehouse_id: string; qty: number; soft?: boolean };
/** A combo (kit) item → the inventory components one unit moves. */
export type Combo = { sku: string; components: (PackItem & { qty: number })[] };
export type ClosePlan = {
  state: "closed" | "ready" | "blocked";
  region: Region;
  country: string;
  /** COD: closed at AED 0 here, the sale lives in House of Omnia. */
  cod: boolean;
  issues: Issue[];
  changes: string[];
  update: Record<string, unknown> | null;
  soTotal: number;
  expectedTotal: number;
  orderTotalAed: number | null;
  consume: Consume[];
  /** What the customer paid, the rate used and the AED it makes. */
  fx: { currency: string; paid: number; rate: number; aed: number; source: "fixed" | "override" } | null;
};

export function regionOf(country: string): Region {
  const c = country.toUpperCase();
  if (c === "AE") return "UAE";
  if ((GCC_COUNTRIES as readonly string[]).includes(c)) return "GCC";
  return "INTL";
}

/** Country for the order: the order row, else the store prefix (SA = KSA store). */
export function countryOf(soNumber: string, order: OrderFacts | null): string {
  if (order?.country) return order.country.toUpperCase();
  if (/^(SA|KSA)\d/i.test(soNumber)) return "SA";
  return "AE";
}

/** Place of supply follows the treatment: an emirate for UAE treatments, the
 *  country for GCC ones, none outside the GCC. */
export function placeOfSupply(treatment: string, country: string, currentPos: string): string {
  if (treatment.startsWith("gcc_")) return country;
  if (treatment === "non_gcc") return "";
  return EMIRATES.has(currentPos) ? currentPos : "DU";
}

export function toAedFixed(amount: number, currency: string, rates: Record<string, number> = DEFAULT_RULES.rates): number | null {
  const r = rates[currency.toUpperCase()];
  return r == null ? null : Math.round(amount * r * 100) / 100;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planClose(input: {
  so: SoDetail;
  order: OrderFacts | null;
  /** warehouse_id: where this box ships from (split order: KSA half / UAE half); else the product warehouse. */
  packaging: { sku: string; qty: number; description?: string; warehouse_id?: string }[] | null;
  items: Map<string, PackItem>;           // Zoho SKU (upper) → item
  stock: StockMap;
  taxes: RegionTax;
  defaultWarehouse: string;
  rules?: SoRules;
  /** COD order whose sale is booked in another org (House of Omnia): close this one at AED 0. */
  codZero?: boolean;
  /** Ship every stock line and the packaging from this warehouse (KSA dispatch:
   *  SMSA Fulfillment KSA) instead of the one the draft carries. */
  warehouseOverride?: string;
  /** Per product SKU (upper case) → warehouse: a split order's KSA and UAE halves. Wins over warehouseOverride. */
  lineWarehouses?: Record<string, string>;
  /** AED per unit of the order's currency for THIS order, instead of the fixed rate. */
  rateOverride?: number;
  /** Scale the item prices so the SO lands exactly on paid × rate (≤ MATCH_MAX_PCT off). */
  matchOrderTotal?: boolean;
  /** Combo items on the draft (item_id → components); their SKUs are in `items` too. */
  combos?: Map<string, Combo>;
}): ClosePlan {
  const { so, order, packaging, items, stock, taxes } = input;
  const rules = input.rules ?? DEFAULT_RULES;
  const country = countryOf(so.salesorder_number, order);
  const region = regionOf(country);
  const treatment = rules.regions[region].tax_treatment;
  const pos = placeOfSupply(treatment, country, so.place_of_supply);
  const issues: Issue[] = [];
  const changes: string[] = [];
  const consume: Consume[] = [];
  const cod = Boolean(input.codZero);
  const base = { region, country, cod, soTotal: so.total, orderTotalAed: null as number | null, consume, fx: null as ClosePlan["fx"] };
  // The order's rate: this order's override, else the fixed table.
  const rateRules = input.rateOverride && input.rateOverride > 0 && order?.currency
    ? { ...rules.rates, [order.currency.toUpperCase()]: input.rateOverride } : rules.rates;
  if (order?.grossOriginal != null && order.currency && rateRules[order.currency.toUpperCase()] != null) {
    const rate = rateRules[order.currency.toUpperCase()];
    base.fx = { currency: order.currency.toUpperCase(), paid: order.grossOriginal, rate, aed: toAedFixed(order.grossOriginal, order.currency, rateRules)!, source: input.rateOverride && input.rateOverride > 0 ? "override" : "fixed" };
  }

  if (so.status !== "draft" && so.status !== "open") {
    return { ...base, state: "closed", issues, changes, update: null, expectedTotal: so.total };
  }
  if (so.invoices?.length) issues.push({ code: "has_invoice", message: `Already has invoice ${so.invoices[0].invoice_number}`, blocking: true });

  // Tax on every line, by region.
  const { tax_id: taxId, pct } = taxes[region];
  if (so.tax_treatment !== treatment || (pos && so.place_of_supply !== pos)) {
    changes.push(`Tax treatment ${so.tax_treatment}/${so.place_of_supply || "—"} → ${treatment}/${pos || "—"}`);
  }
  const override = input.warehouseOverride;
  const productWh = override || so.line_items.find((l) => l.warehouse_id)?.warehouse_id || input.defaultWarehouse;
  // Rate-0 packaging kits on the draft: a known combo comes off and its boxes
  // come from the sheet (or, with no packaging rows, from the kit itself).
  const isKitLine = (l: SoLine) => l.rate === 0 && l.item_type !== "inventory" && l.product_type === "goods";
  const kits = so.line_items.filter((l) => isKitLine(l) && input.combos?.get(l.item_id)?.components.length);
  const unknownKits = so.line_items.filter((l) => isKitLine(l) && !input.combos?.get(l.item_id)?.components.length);
  const kitIds = new Set(kits.map((l) => l.line_item_id));
  const lines: Record<string, unknown>[] = so.line_items.filter((l) => !kitIds.has(l.line_item_id)).map((l) => {
    if (l.tax_id !== taxId) changes.push(`${l.sku || l.name}: tax ${l.tax_percentage ?? 0}%${l.tax_exemption_id && !l.tax_id ? " (exempt)" : ""} → ${pct}%`);
    const wh = lineWarehouse(l, input.lineWarehouses, override);
    if (wh && wh !== l.warehouse_id) changes.push(`${l.sku || l.name}: warehouse ${l.warehouse_id || "—"} → ${wh}`);
    if (wh && l.item_type === "inventory") {
      consume.push({ item_id: l.item_id, sku: l.sku || l.name || l.item_id, warehouse_id: wh, qty: l.quantity });
    }
    return {
      line_item_id: l.line_item_id, item_id: l.item_id, name: l.name, description: l.description ?? "",
      quantity: l.quantity, rate: cod ? 0 : l.rate, discount: cod ? 0 : l.discount ?? 0, unit: l.unit,
      tax_id: taxId, tax_exemption_id: "",
      ...(wh ? { warehouse_id: wh } : {}),
    };
  });

  if (cod && so.line_items.some((l) => l.rate !== 0)) changes.push("COD — every line at AED 0, the sale is booked in House of Omnia");

  // Packaging from the sheet, minus what is already on the order.
  if (!packaging) {
    issues.push({ code: "not_in_sheet", message: "Not in the packing sheet yet — not dispatched, or the order number is missing on the day tab", blocking: true });
  } else {
    const onSo = new Map<string, number>();
    for (const l of so.line_items) onSo.set(l.item_id, (onSo.get(l.item_id) ?? 0) + l.quantity);
    if (unknownKits.length) {
      issues.push({ code: "bundle_on_so", message: `Draft carries ${unknownKits.map((b) => b.sku || b.name).join(", ")} at AED 0 and it isn't a Zoho combo with components — check by hand so boxes aren't counted twice`, blocking: true });
    }
    // The sheet is what left the warehouse; with no packaging rows, the kit's own components go out instead.
    const fromKits = kits.flatMap((l) => input.combos!.get(l.item_id)!.components.map((c) => ({ sku: c.sku, qty: c.qty * l.quantity, description: undefined as string | undefined, warehouse_id: undefined as string | undefined })));
    const boxes = packaging.length ? packaging : fromKits;
    for (const l of kits) {
      const c = input.combos!.get(l.item_id)!;
      changes.push(`− ${l.quantity} × ${l.sku || l.name} (kit: ${c.components.map((x) => `${x.qty}× ${x.sku}`).join(" + ")}) → ${packaging.length ? "boxes from the packing sheet" : "its components"}`);
    }
    for (const p of boxes) {
      const zohoSku = (rules.aliases[p.sku.toUpperCase()] ?? p.sku).toUpperCase();
      const it = items.get(zohoSku);
      if (!it) {
        issues.push({ code: "unknown_sku", message: `${p.sku}${p.description ? ` (${p.description})` : ""} is not an item in Zoho — create it or map it under Settings → SKU aliases`, blocking: true });
        continue;
      }
      // What the draft already carries counts once, against the first box line of that item.
      const already = onSo.get(it.item_id) ?? 0;
      const missing = p.qty - already;
      onSo.set(it.item_id, Math.max(0, already - p.qty));
      if (missing <= 0) continue;
      const wh = p.warehouse_id || productWh;
      lines.push({ item_id: it.item_id, name: it.name, quantity: missing, rate: 0, tax_id: taxId, warehouse_id: wh });
      changes.push(`+ ${missing} × ${it.sku} ${it.name}${p.warehouse_id && p.warehouse_id !== productWh ? ` (from ${wh})` : ""}`);
      if (it.stockTracked) consume.push({ item_id: it.item_id, sku: it.sku, warehouse_id: wh, qty: missing, ...(it.trackBatch ? {} : { soft: true }) });
    }
    if (!boxes.length) issues.push({ code: "no_packaging", message: "On the sheet with no packaging rows", blocking: false });
  }

  // Stock: every tracked line must be available in its warehouse.
  const need = new Map<string, Consume>();
  for (const c of consume) {
    const k = `${c.item_id}|${c.warehouse_id}`;
    const prev = need.get(k);
    need.set(k, prev ? { ...prev, qty: prev.qty + c.qty, soft: prev.soft && c.soft } : { ...c });
  }
  // A confirmed SO already commits its own lines, and Zoho's available-for-sale
  // excludes them — OS4319's KSA unit read "0 available" to itself. Add back
  // what this SO commits, per item and warehouse.
  const own = ownCommitted(so);
  for (const c of need.values()) {
    const read = stock.get(c.item_id)?.get(c.warehouse_id);
    if (read == null) continue; // not read — the close re-reads before posting
    const have = read + (own.get(`${c.item_id}|${c.warehouse_id}`) ?? 0);
    if (have >= c.qty) continue;
    issues.push(c.soft
      ? { code: "stock_short", message: `${c.sku}: needs ${c.qty}, Zoho books show ${have} in this warehouse — closing anyway (Zoho allows it); fix the count with a stock adjustment or transfer`, blocking: false }
      : { code: "stock_short", message: `${c.sku}: needs ${c.qty}, ${have} available`, blocking: true });
  }

  // Amount: the SO after the tax fix must equal the order at the fixed rate.
  let expectedTotal = cod ? 0 : r2(so.line_items.reduce((s, l) => s + r2(l.item_total * (1 + pct / 100)), 0));
  if (cod) {
    if (order?.grossOriginal != null && order.currency) base.orderTotalAed = toAedFixed(order.grossOriginal, order.currency, rateRules);
  } else if (order?.grossOriginal != null && order.currency) {
    const aed = toAedFixed(order.grossOriginal, order.currency, rateRules);
    base.orderTotalAed = aed;
    const off = (total: number) => aed != null && Math.abs(aed - total) > Math.max(1, (aed * rules.tolerancePct) / 100);
    // "Match SO to order": scale the item prices onto paid × rate exactly, so
    // per-item conversions (840.88 vs 841.65) never leave a gap on the invoice.
    const matched = aed != null && input.matchOrderTotal && Math.abs(aed - expectedTotal) >= 0.01
      ? matchTotal(so.line_items, lines, aed, pct) : null;
    if (matched && matched.offPct <= MATCH_MAX_PCT) {
      for (const l of lines) {
        const r = matched.rates.get(String(l.line_item_id ?? ""));
        if (r != null) l.rate = r;
      }
      changes.push(`Item prices scaled ×${matched.factor.toFixed(4)}: SO AED ${expectedTotal.toFixed(2)} → AED ${matched.total.toFixed(2)} = ${order.currency} ${order.grossOriginal} × ${base.fx?.rate}`);
      expectedTotal = matched.total;
    } else if (matched) {
      issues.push({ code: "amount_diff", message: `SO AED ${expectedTotal.toFixed(2)} is ${matched.offPct.toFixed(1)}% off the order's AED ${aed!.toFixed(2)} — too far to match automatically (max ${MATCH_MAX_PCT}%), fix it in the editor`, blocking: true });
    }
    if (aed == null) issues.push({ code: "no_rate", message: `No fixed rate for ${order.currency} — add it under Settings`, blocking: true });
    else if (matched) { /* handled above */ }
    else if (off(expectedTotal)) {
      // The draft's discount often isn't the store's (OS4252: 5% a line = AED 133,
      // the store gave AED 99). Spread the store's discount over the goods lines
      // in proportion; use it only when that lands on the order total.
      const fix = order.currency === "AED" && order.discountAed != null ? spreadDiscount(so.line_items, order.discountAed, pct) : null;
      if (fix && !off(fix.total)) {
        for (const l of lines) {
          const d = fix.discounts.get(String(l.line_item_id ?? ""));
          if (d != null) l.discount = d;
        }
        changes.push(`Discount AED ${fix.was.toFixed(2)} → the store's AED ${order.discountAed.toFixed(2)}, spread over the items`);
        expectedTotal = fix.total;
      } else {
        issues.push({ code: "amount_diff", message: `SO would total AED ${expectedTotal.toFixed(2)}, order is ${order.currency} ${order.grossOriginal} = AED ${aed.toFixed(2)} at the fixed rate`, blocking: true });
      }
    }
  } else {
    issues.push({ code: "no_order", message: "Store order not found — amount not verified", blocking: false });
  }

  const update: Record<string, unknown> = {
    customer_id: so.customer_id,
    tax_treatment: treatment,
    ...(pos ? { place_of_supply: pos } : {}),
    is_inclusive_tax: false,
    line_items: lines,
  };
  const state = issues.some((i) => i.blocking) ? "blocked" : "ready";
  return { ...base, state, issues, changes, update, expectedTotal };
}

/** item|warehouse → qty a confirmed ("open") SO already commits. Drafts commit nothing. */
export function ownCommitted(so: Pick<SoDetail, "status" | "line_items">): Map<string, number> {
  const m = new Map<string, number>();
  if (so.status !== "open") return m;
  for (const l of so.line_items) {
    if (l.item_type !== "inventory" || !l.warehouse_id) continue;
    const k = `${l.item_id}|${l.warehouse_id}`;
    m.set(k, (m.get(k) ?? 0) + l.quantity);
  }
  return m;
}

/** Where a draft line ships from: its SKU's split warehouse, else the override
 *  (stock lines only), else what the draft says. */
export function lineWarehouse(l: Pick<SoLine, "sku" | "item_type" | "warehouse_id">, byLine?: Record<string, string>, override?: string): string | undefined {
  if (l.item_type !== "inventory") return l.warehouse_id;
  const split = byLine?.[(l.sku ?? "").trim().toUpperCase()];
  return split || override || l.warehouse_id;
}

/** Largest gap "Match SO to order" will close by scaling prices — rounding
 *  from per-item conversion (OS4304 −0.76, OS4319 −0.82). A bigger gap
 *  (WA55988: 40 AED, 4.4%) is a missing discount or line: a person decides. */
export const MATCH_MAX_PCT = 1;

/**
 * Item rates that make the SO total exactly `targetAed` (tax included): the
 * priced goods lines are scaled by one factor (shipping and rate-0 packaging
 * untouched), an absolute line discount is kept, and the rounding residue goes
 * on the largest line. `out` are the update lines (they may carry a new
 * discount from the discount fix); `src` the draft lines for qty/type.
 */
export function matchTotal(src: SoLine[], out: Record<string, unknown>[], targetAed: number, pct: number): { rates: Map<string, number>; total: number; factor: number; offPct: number } | null {
  const k = 1 + pct / 100;
  const byId = new Map(src.map((l) => [l.line_item_id, l]));
  const disc = (l: Record<string, unknown>) => String(l.discount ?? "0");
  const net = (l: Record<string, unknown>, rate: number) => {
    const qty = Number(l.quantity ?? 0);
    const d = disc(l);
    return d.endsWith("%") ? rate * qty * (1 - Number(d.slice(0, -1)) / 100) : rate * qty - Number(d || 0);
  };
  const isGoods = (l: Record<string, unknown>) => {
    const s = byId.get(String(l.line_item_id ?? ""));
    return Boolean(s) && !isShipping(s!) && Number(l.rate ?? 0) > 0;
  };
  const goods = out.filter(isGoods);
  if (!goods.length) return null;
  const total = (rates: Map<string, number>) => r2(out.reduce((s, l) => {
    const r = rates.get(String(l.line_item_id ?? "")) ?? Number(l.rate ?? 0);
    return s + r2(net(l, r) * k);
  }, 0));
  const before = total(new Map());
  const goodsNet = goods.reduce((s, l) => s + net(l, Number(l.rate)), 0);
  const otherNet = before / k - goodsNet;
  const factor = (targetAed / k - otherNet) / goodsNet;
  if (!(factor > 0)) return null;
  const rates = new Map<string, number>();
  for (const l of goods) {
    const qty = Number(l.quantity);
    const d = disc(l);
    const newNet = net(l, Number(l.rate)) * factor;
    rates.set(String(l.line_item_id), r2(d.endsWith("%") ? Number(l.rate) * factor : (newNet + Number(d || 0)) / qty));
  }
  const big = goods.reduce((a, b) => (net(a, Number(a.rate)) >= net(b, Number(b.rate)) ? a : b));
  const bigId = String(big.line_item_id);
  // Rounding residue onto the largest line, a cent at a time per unit.
  for (let i = 0; i < 3; i++) {
    const residue = r2(targetAed - total(rates));
    if (Math.abs(residue) < 0.005) break;
    rates.set(bigId, r2(rates.get(bigId)! + residue / k / Number(big.quantity)));
  }
  return { rates, total: total(rates), factor, offPct: Math.abs(targetAed - before) / targetAed * 100 };
}

/** Invoice date per the setting: the store order's Dubai day, the packing-sheet
 *  day, or the sales order's own date — falling back down that list. */
export function invoiceDateFor(source: "order" | "dispatch" | "salesorder", so: SoDetail, orderDubaiDay: string | null, dispatchDay: string | null): string {
  if (source === "order" && orderDubaiDay) return orderDubaiDay;
  if ((source === "order" || source === "dispatch") && dispatchDay) return dispatchDay;
  return so.date;
}

const isShipping = (l: SoLine) => l.product_type === "service" || /shipping/i.test(`${l.sku ?? ""} ${l.name ?? ""}`);

/** Store discount (AED, pre-tax) spread over the priced goods lines in
 *  proportion to their value, as per-line amounts; the rounding residue sits
 *  on the largest line. */
export function spreadDiscount(lines: SoLine[], discountAed: number, pct: number): { discounts: Map<string, number>; total: number; was: number } | null {
  const goods = lines.filter((l) => !isShipping(l) && l.rate > 0);
  const gross = goods.reduce((s, l) => s + l.rate * l.quantity, 0);
  if (!goods.length || gross <= 0 || discountAed < 0 || discountAed >= gross) return null;
  const was = r2(goods.reduce((s, l) => s + (l.rate * l.quantity - l.item_total), 0));
  const discounts = new Map<string, number>();
  let given = 0;
  for (const l of goods) {
    const d = r2((l.rate * l.quantity * discountAed) / gross);
    discounts.set(l.line_item_id, d);
    given += d;
  }
  const big = goods.reduce((a, b) => (a.rate * a.quantity >= b.rate * b.quantity ? a : b));
  discounts.set(big.line_item_id, r2(discounts.get(big.line_item_id)! + discountAed - given));
  const total = r2(lines.reduce((s, l) => {
    const net = discounts.has(l.line_item_id) ? l.rate * l.quantity - discounts.get(l.line_item_id)! : l.item_total;
    return s + r2(net * (1 + pct / 100));
  }, 0));
  return { discounts, total, was };
}
