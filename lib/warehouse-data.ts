// Mock data + types for the warehouse cockpit demo.
// Shape mirrors what /api/inventory/warehouse-matrix would return.

export type WarehouseCell = {
    warehouse_name: string;
    stock_on_hand: number;
    actual_available_for_sale_stock: number;
    committed_stock: number;
    quantity_in_transit: number;
    is_item_mapped: boolean;
    is_primary: boolean;
  };
  
  export type StorefrontCell = { quantity: number | null; product_status: string };
  
  export type MatrixRow = {
    item_id: string;
    sku: string;
    name: string;
    category: string;
    image_hue: number; // for generated thumbnail gradient
    image_url: string; // real product photography
    zoho_aggregate_stock: number;
    warehouses: Record<string, WarehouseCell>;
    storefronts: Record<string, StorefrontCell>;
    velocity_7d: number[]; // units sold per day, last 7 days (simulated)
    velocity_per_day: number;
  };
  
  export type Timeframe = "day" | "week" | "month" | "year";
  
  export const TIMEFRAME_MULT: Record<Timeframe, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  
  export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    day: "per day",
    week: "per week",
    month: "per month",
    year: "per year",
  };
  
  // Curated professional product photography per category (Unsplash CDN).
  const CATEGORY_IMAGES: Record<string, string[]> = {
    Accessories: [
      "https://images.unsplash.com/photo-1601924582970-9238bcb495d9?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1583744946564-b52ac1c389c8?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1620625515032-6ed0c1790c75?w=240&h=240&fit=crop&q=80",
    ],
    Jewelry: [
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1599643477877-530eb83abc8e?w=240&h=240&fit=crop&q=80",
    ],
    Bags: [
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=240&h=240&fit=crop&q=80",
    ],
    Apparel: [
      "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1583002347010-fbebc0d68e4f?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1596993100471-c3905dafa78e?w=240&h=240&fit=crop&q=80",
    ],
    Home: [
      "https://images.unsplash.com/photo-1602874801007-aa5d7b2f0e83?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1600718374662-0483d2b9da44?w=240&h=240&fit=crop&q=80",
    ],
    Beauty: [
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=240&h=240&fit=crop&q=80",
      "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=240&h=240&fit=crop&q=80",
    ],
  };
  
  export type WarehouseCol = {
    warehouse_id: string;
    warehouse_name: string;
    short_name: string;
    is_primary: boolean;
    is_sellable: boolean;
  };
  
  export const OPERATIONAL = new Set([
    "KSA Quarantine",
    "PRMNT DMG",
    "Damage-Awaiting Repair",
    "Photo/Temp",
  ]);
  
  export const WAREHOUSES: WarehouseCol[] = [
    { warehouse_id: "omnia", warehouse_name: "Omniastores LLC", short_name: "Omnia UAE", is_primary: true, is_sellable: true },
    { warehouse_id: "smsa", warehouse_name: "SMSA Fulfillment KSA", short_name: "SMSA KSA", is_primary: false, is_sellable: true },
    { warehouse_id: "quar", warehouse_name: "KSA Quarantine", short_name: "Quarantine", is_primary: false, is_sellable: false },
    { warehouse_id: "dmg", warehouse_name: "PRMNT DMG", short_name: "Damaged", is_primary: false, is_sellable: false },
    { warehouse_id: "photo", warehouse_name: "Photo/Temp", short_name: "Photo/Temp", is_primary: false, is_sellable: false },
  ];
  
  export const STOREFRONTS = ["UAE", "KSA", "WA", "WOO"] as const;
  
  const ITEM_NAMES = [
    ["Amara Silk Scarf", "Accessories"],
    ["Zahra Gold Cuff", "Jewelry"],
    ["Layla Pearl Drop Earrings", "Jewelry"],
    ["Noor Beaded Clutch", "Bags"],
    ["Yasmin Kaftan Set", "Apparel"],
    ["Rania Embroidered Shawl", "Accessories"],
    ["Farah Statement Necklace", "Jewelry"],
    ["Dana Woven Tote", "Bags"],
    ["Salma Linen Abaya", "Apparel"],
    ["Mona Crystal Hairpin", "Accessories"],
    ["Hana Leather Belt", "Accessories"],
    ["Reem Enamel Bangle", "Jewelry"],
    ["Aya Silk Hijab — Sand", "Accessories"],
    ["Tala Ceramic Coasters", "Home"],
    ["Nadia Oud Diffuser", "Home"],
    ["Sara Woven Basket", "Home"],
    ["Lina Perfume Roller", "Beauty"],
    ["Jana Rose Body Oil", "Beauty"],
    ["Malak Kohl Set", "Beauty"],
    ["Huda Amber Candle", "Home"],
  ] as const;
  
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }
  
  export function generateMockRows(count = 20): MatrixRow[] {
    const rows: MatrixRow[] = [];
    for (let i = 0; i < count; i++) {
      const r = rng(i * 137 + 1);
      const [name, category] = ITEM_NAMES[i % ITEM_NAMES.length];
      const skuNum = String(1000 + Math.floor(r() * 9000));
      const sku = `${skuNum}${i > 15 ? "G" : ""}`;
  
      const omniaStock = Math.floor(r() * 60);
      const smsaStock = Math.floor(r() * 40);
      const quarStock = r() > 0.7 ? Math.floor(r() * 8) : 0;
      const dmgStock = r() > 0.85 ? Math.floor(r() * 4) : 0;
      const photoStock = r() > 0.9 ? Math.floor(r() * 3) : 0;
  
      const committed = Math.floor(omniaStock * 0.15);
      const inTransit = r() > 0.7 ? Math.floor(r() * 20) : 0;
  
      const warehouses: Record<string, WarehouseCell> = {
        omnia: { warehouse_name: "Omniastores LLC", stock_on_hand: omniaStock, actual_available_for_sale_stock: Math.max(0, omniaStock - committed), committed_stock: committed, quantity_in_transit: inTransit, is_item_mapped: true, is_primary: true },
        smsa: { warehouse_name: "SMSA Fulfillment KSA", stock_on_hand: smsaStock, actual_available_for_sale_stock: smsaStock, committed_stock: 0, quantity_in_transit: 0, is_item_mapped: true, is_primary: false },
        quar: { warehouse_name: "KSA Quarantine", stock_on_hand: quarStock, actual_available_for_sale_stock: 0, committed_stock: 0, quantity_in_transit: 0, is_item_mapped: true, is_primary: false },
        dmg: { warehouse_name: "PRMNT DMG", stock_on_hand: dmgStock, actual_available_for_sale_stock: 0, committed_stock: 0, quantity_in_transit: 0, is_item_mapped: true, is_primary: false },
        photo: { warehouse_name: "Photo/Temp", stock_on_hand: photoStock, actual_available_for_sale_stock: 0, committed_stock: 0, quantity_in_transit: 0, is_item_mapped: true, is_primary: false },
      };
  
      const uaeList = Math.floor(r() * 30);
      const ksaList = r() > 0.35 ? Math.floor(r() * 25) : 0;
      const waList = r() > 0.5 ? Math.floor(r() * 15) : 0;
      const wooList = r() > 0.7 ? Math.floor(r() * 8) : 0;
  
      const storefronts: Record<string, StorefrontCell> = {
        UAE: { quantity: uaeList, product_status: "active" },
        KSA: { quantity: ksaList, product_status: ksaList ? "active" : "draft" },
        WA: { quantity: waList, product_status: waList ? "active" : "draft" },
        WOO: { quantity: wooList, product_status: wooList ? "active" : "draft" },
      };
  
      const baseVel = 0.5 + r() * 6;
      const velocity_7d = Array.from({ length: 7 }, () => Math.max(0, Math.round(baseVel * (0.4 + r() * 1.2))));
      const velocity_per_day = velocity_7d.reduce((a, b) => a + b, 0) / 7;
  
      const catImages = CATEGORY_IMAGES[category] ?? CATEGORY_IMAGES.Accessories;
      const image_url = catImages[i % catImages.length];
  
      rows.push({
        item_id: `it_${i}`,
        sku,
        name,
        category,
        image_hue: Math.floor(r() * 360),
        image_url,
        zoho_aggregate_stock: omniaStock + smsaStock + quarStock + dmgStock + photoStock,
        warehouses,
        storefronts,
        velocity_7d,
        velocity_per_day: Math.round(velocity_per_day * 10) / 10,
      });
    }
    return rows;
  }
  
  export function isSellable(name: string) {
    return !OPERATIONAL.has(name);
  }
  
  export type ForecastSignal = {
    kind: "concentration" | "distribution_gap" | "dead_stock" | "oversell" | "storefront_imbalance" | "in_transit" | "fast_mover" | "slow_mover";
    severity: "high" | "medium" | "low";
    label: string;
    detail: string;
  };
  
  export function computeSignals(row: MatrixRow): ForecastSignal[] {
    const signals: ForecastSignal[] = [];
    const sellableCells = Object.values(row.warehouses).filter((w) => isSellable(w.warehouse_name) && w.is_item_mapped);
    const totalSellable = sellableCells.reduce((s, w) => s + w.actual_available_for_sale_stock, 0);
    const totalOnHand = Object.values(row.warehouses).reduce((s, w) => s + w.stock_on_hand, 0);
    const totalListed = Object.values(row.storefronts).reduce((s, sf) => s + (sf.quantity ?? 0), 0);
    const inTransit = Object.values(row.warehouses).reduce((s, w) => s + w.quantity_in_transit, 0);
  
    const sellableWithStock = sellableCells.filter((w) => w.actual_available_for_sale_stock > 0);
    if (sellableWithStock.length === 1 && totalSellable >= 5) {
      signals.push({ kind: "concentration", severity: "medium", label: "Single-warehouse concentration", detail: `All ${totalSellable} sellable units in ${sellableWithStock[0].warehouse_name}.` });
    }
  
    const smsa = row.warehouses.smsa;
    if (smsa && smsa.actual_available_for_sale_stock > 0 && (row.storefronts.KSA?.quantity ?? 0) === 0) {
      signals.push({ kind: "distribution_gap", severity: "high", label: "KSA stock, not listed", detail: `${smsa.actual_available_for_sale_stock} units at SMSA KSA but unlisted on Shopify KSA. Missed revenue.` });
    }
  
    if (totalOnHand > 3 && totalSellable === 0) {
      signals.push({ kind: "dead_stock", severity: "medium", label: "Dead stock", detail: `${totalOnHand} units on hand but 0 sellable — stuck in quarantine or damage.` });
    }
  
    if (totalListed > totalSellable && totalListed > 0) {
      const gap = totalListed - totalSellable;
      signals.push({ kind: "oversell", severity: gap > 5 ? "high" : "medium", label: `Oversell exposure: ${gap} units`, detail: `Listed ${totalListed}, can fulfill ${totalSellable}. Next ${gap} orders fail.` });
    }
  
    if (inTransit > 0 && totalSellable <= 3) {
      signals.push({ kind: "in_transit", severity: "low", label: "Replenishment in transit", detail: `${inTransit} units en route. Hold off on emergency reorders.` });
    }
  
    // Velocity-driven
    const daysOfCover = row.velocity_per_day > 0 ? totalSellable / row.velocity_per_day : Infinity;
    if (row.velocity_per_day >= 4 && daysOfCover < 7) {
      signals.push({ kind: "fast_mover", severity: "high", label: `Fast mover, ${Math.floor(daysOfCover)}d cover`, detail: `Selling ${row.velocity_per_day}/day; only ${totalSellable} sellable left. Reorder now.` });
    } else if (row.velocity_per_day < 1 && totalSellable > 20) {
      signals.push({ kind: "slow_mover", severity: "low", label: "Slow mover, deep inventory", detail: `Selling ${row.velocity_per_day}/day with ${totalSellable} sellable. Consider promo or reallocation.` });
    }
  
    return signals;
  }
  
  // ── Channel coverage: which storefronts is this SKU actually listed on? ──
  // A SKU is "listed" on a storefront when quantity is non-null AND status==='active'
  // (matches how the storefront cell renders as a live listing).
  // Zoho is always the source of truth in this mock — every row is "in Zoho".
  
  export const STOREFRONT_LABEL: Record<string, string> = {
    UAE: "Shopify UAE",
    KSA: "Shopify KSA",
    WA: "WhatsApp",
    WOO: "WooCommerce",
  };
  
  export type Coverage = {
    listed: Record<string, boolean>;
    listedCount: number;
    missing: string[]; // storefront ids where the SKU is NOT listed
  };
  
  export function computeCoverage(row: MatrixRow): Coverage {
    const listed: Record<string, boolean> = {};
    for (const s of STOREFRONTS) {
      const cell = row.storefronts[s];
      listed[s] = !!cell && cell.quantity !== null && cell.quantity > 0 && cell.product_status === "active";
    }
    const missing = STOREFRONTS.filter((s) => !listed[s]);
    const listedCount = STOREFRONTS.length - missing.length;
    return { listed, listedCount, missing };
  }
  
  // Pairwise gap: on A but not on B. Used to highlight cross-channel drift.
  export function hasPairGap(cov: Coverage, a: string, b: string): boolean {
    return cov.listed[a] === true && cov.listed[b] === false;
  }
  