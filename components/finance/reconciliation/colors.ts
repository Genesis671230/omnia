/* One gateway → one color, everywhere.
 *
 * Color follows the ENTITY, never its rank: Tabby is the same hue in the group
 * header, the row chip, and every chart, whatever order the data arrives in.
 * A filter that changes which gateways are on screen must not repaint the
 * survivors, so these are fixed assignments rather than a cycled array.
 *
 * Palette provenance: slots 1–6 of the validated categorical order, checked
 * with the dataviz validator against this page's white card surface —
 *   lightness band PASS · chroma floor PASS
 *   CVD separation  PASS (worst adjacent #eda100↔#1baf7a ΔE 9.1 protan)
 *   normal-vision   PASS (worst adjacent ΔE 19.6)
 *   contrast        WARN — aqua/yellow/magenta sit under 3:1 on white, so the
 *                   relief rule applies: every chart here ships direct value
 *                   labels and a legend, and color never carries meaning alone.
 *
 * Unclassified is deliberately NOT a categorical hue — it is the absence of a
 * gateway, and giving it a color would make "we don't know" look like a peer
 * of the ones we do know.
 */

export const GATEWAY_COLORS: Record<string, string> = {
  Stripe: "#2a78d6", // slot 1 blue
  Tabby: "#eb6834", // slot 2 orange
  Tamara: "#1baf7a", // slot 3 aqua
  Checkout: "#eda100", // slot 4 yellow
  COD: "#e87ba4", // slot 5 magenta
  Telr: "#008300", // slot 6 green
  Unclassified: "#898781", // muted ink — not a series color
};

export const GATEWAY_FALLBACK = "#898781";

export function gatewayColor(gateway: string): string {
  return GATEWAY_COLORS[gateway] ?? GATEWAY_FALLBACK;
}

/* Status colors are a reserved, never-themed set — they must never impersonate
 * a series, which is why they are not drawn from the categorical slots above.
 * Each ships with an icon + label in the UI, so hue never carries the meaning
 * on its own. */
export const STATE_COLORS = {
  SETTLED: "#0ca30c", // good
  AWAITING_PAYOUT: "#fab219", // warning
  PAYOUT_VARIANCE: "#d03b3b", // critical
  ORDERS_UNRESOLVED: "#ec835a", // serious
} as const;

/** Aging severity — a one-hue sequential ramp (blue, light→dark), because age
 *  is a magnitude, not four unrelated categories. */
export const AGING_COLORS = {
  "0-7": "#86b6ef",
  "8-14": "#3987e5",
  "15+": "#184f95",
} as const;

export const CHART_INK = {
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  primary: "#0b0b0b",
  secondary: "#52514e",
} as const;
