// Where shoppers leave each storefront. Pure: takes Shopify session funnel
// counts (ShopifyQL `FROM sessions`) and says, step by step, how many left
// and which step leaks worst; ranks product landing pages by how many
// visitors they lose before the cart.

export type FunnelCounts = { sessions: number; addedToCart: number; reachedCheckout: number; completed: number };

export type FunnelStep = {
  key: keyof FunnelCounts;
  label: string;
  count: number;
  /** Share of all sessions still here. */
  ofTotal: number;
  /** Visitors who left between the previous step and this one. */
  lost: number;
  /** Share of the previous step that left. */
  dropRate: number;
};

export const STEP_LABELS: Record<keyof FunnelCounts, string> = {
  sessions: "Visited",
  addedToCart: "Added to cart",
  reachedCheckout: "Reached checkout",
  completed: "Purchased",
};

const pct = (a: number, b: number) => (b > 0 ? a / b : 0);

export function funnelSteps(c: FunnelCounts): FunnelStep[] {
  const keys: (keyof FunnelCounts)[] = ["sessions", "addedToCart", "reachedCheckout", "completed"];
  return keys.map((key, i) => {
    const count = Math.max(0, c[key]);
    const prev = i === 0 ? count : Math.max(0, c[keys[i - 1]]);
    const lost = i === 0 ? 0 : Math.max(prev - count, 0);
    return { key, label: STEP_LABELS[key], count, ofTotal: pct(count, c.sessions), lost, dropRate: i === 0 ? 0 : pct(lost, prev) };
  });
}

/** The step that loses the most visitors (by count), or null with no traffic. */
export function worstLeak(c: FunnelCounts): FunnelStep | null {
  const steps = funnelSteps(c).slice(1).filter((s) => s.lost > 0);
  if (!steps.length) return null;
  return steps.reduce((a, b) => (b.lost > a.lost ? b : a));
}

export type LandingPageRow = { path: string; sessions: number; addedToCart: number; reachedCheckout: number; completed: number };

export type ProductLeak = LandingPageRow & {
  handle: string;
  cartRate: number;
  conversion: number;
  /** Visitors who landed on the product and never added to cart. */
  bounced: number;
};

/** The product handle of a Shopify product path (/products/x, /en/products/x, /collections/y/products/x). */
export function productHandle(path: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Product landing pages ranked by visitors lost before the cart. Pages with
 * fewer than `minSessions` are dropped — a 1-of-2 rate says nothing.
 */
export function productLeaks(rows: LandingPageRow[], minSessions = 5): ProductLeak[] {
  const byHandle = new Map<string, ProductLeak>();
  for (const r of rows) {
    const handle = productHandle(r.path);
    if (!handle) continue;
    const cur = byHandle.get(handle);
    const merged: LandingPageRow = cur
      ? { path: cur.path, sessions: cur.sessions + r.sessions, addedToCart: cur.addedToCart + r.addedToCart, reachedCheckout: cur.reachedCheckout + r.reachedCheckout, completed: cur.completed + r.completed }
      : { ...r };
    byHandle.set(handle, {
      ...merged, handle,
      cartRate: pct(merged.addedToCart, merged.sessions),
      conversion: pct(merged.completed, merged.sessions),
      bounced: Math.max(merged.sessions - merged.addedToCart, 0),
    });
  }
  return [...byHandle.values()].filter((p) => p.sessions >= minSessions).sort((a, b) => b.bounced - a.bounced);
}
