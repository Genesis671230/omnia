import type { ReactNode } from "react";

/* Integration marks.

   These are RAMZA's own monochrome glyphs paired with each partner's name set
   in our type, not copies of the partners' trademarked letterforms. A single
   ink colour across the whole rail reads as one designed system instead of a
   ransom note of pasted brand assets, and it keeps us honest: we are naming
   the integrations we support, not borrowing anyone's visual identity.

   Every glyph is drawn on a 20x20 box with a 1.6 stroke so the rail holds a
   consistent optical weight at any size. */

export type BrandKey =
  | "stripe"
  | "telr"
  | "tabby"
  | "tamara"
  | "checkout"
  | "cod"
  | "shopify"
  | "woocommerce"
  | "zoho"
  | "xero"
  | "quickbooks";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const GLYPH: Record<BrandKey, ReactNode> = {
  // three offset stripes
  stripe: (
    <>
      <path {...S} d="M5.5 5.5h9.5l-2 3H3.5z" />
      <path {...S} d="M6.5 11.5H16l-2 3H4.5z" />
    </>
  ),
  // a card with a bold terminal bar
  telr: (
    <>
      <rect {...S} x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path {...S} d="M2.5 8.5h15" />
      <path {...S} d="M6 12h3.5" />
    </>
  ),
  // four pay-in-four cells, the first one settled
  tabby: (
    <>
      <rect {...S} x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path {...S} d="M10 2.5v15M2.5 10h15" />
      <rect x="3.6" y="3.6" width="5.3" height="5.3" rx="1.6" fill="currentColor" />
    </>
  ),
  // three installment arcs
  tamara: (
    <>
      <path {...S} d="M10 2.6a7.4 7.4 0 0 1 6.4 3.7" />
      <path {...S} d="M16.4 13.7A7.4 7.4 0 0 1 10 17.4" />
      <path {...S} d="M3.6 13.7A7.4 7.4 0 0 1 3.6 6.3" />
      <circle cx="10" cy="10" r="2.1" fill="currentColor" />
    </>
  ),
  // captured payment
  checkout: (
    <>
      <circle {...S} cx="10" cy="10" r="7.5" />
      <path {...S} d="M6.4 10.2l2.5 2.5 4.7-5" />
    </>
  ),
  // cash on delivery: a note handed over
  cod: (
    <>
      <rect {...S} x="2.5" y="5.5" width="15" height="9" rx="1.6" />
      <circle {...S} cx="10" cy="10" r="2.1" />
      <path {...S} d="M5.2 10h.01M14.8 10h.01" />
    </>
  ),
  // storefront bag
  shopify: (
    <>
      <path {...S} d="M4.2 6.5h11.6l1 11H3.2z" />
      <path {...S} d="M7.2 8.6V5.9a2.8 2.8 0 0 1 5.6 0v2.7" />
    </>
  ),
  // woo: the double-v in a bubble
  woocommerce: (
    <>
      <path {...S} d="M3 5.5h14a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5.6l-2.4 3-.6-3H3A1.5 1.5 0 0 1 1.5 12V7A1.5 1.5 0 0 1 3 5.5z" />
      <path {...S} d="M5.6 8.4l1.2 3 1.2-3 1.2 3 1.2-3" />
    </>
  ),
  // open ledger
  zoho: (
    <>
      <path {...S} d="M10 5.6C8.4 4.4 6.4 4 3.5 4.2v10.4c2.9-.2 4.9.2 6.5 1.4 1.6-1.2 3.6-1.6 6.5-1.4V4.2c-2.9-.2-4.9.2-6.5 1.4z" />
      <path {...S} d="M10 5.6v10.4" />
    </>
  ),
  xero: (
    <>
      <circle {...S} cx="10" cy="10" r="7.5" />
      <path {...S} d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />
    </>
  ),
  quickbooks: (
    <>
      <circle {...S} cx="10" cy="10" r="7.5" />
      <circle {...S} cx="10" cy="10" r="3.4" />
      <path {...S} d="M12.4 12.4l2.1 2.1" />
    </>
  ),
};

const LABEL: Record<BrandKey, string> = {
  stripe: "Stripe",
  telr: "Telr",
  tabby: "Tabby",
  tamara: "Tamara",
  checkout: "Checkout.com",
  cod: "Cash on delivery",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  zoho: "Zoho Books",
  xero: "Xero",
  quickbooks: "QuickBooks",
};

export function brandLabel(key: BrandKey): string {
  return LABEL[key];
}

export function BrandGlyph({
  brand,
  className = "",
}: {
  brand: BrandKey;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden focusable="false">
      {GLYPH[brand]}
    </svg>
  );
}

/* Glyph + wordmark on one baseline. `size` trades the rail between a quiet
   supporting row and a primary logo wall. */
export function BrandMark({
  brand,
  size = "md",
  className = "",
}: {
  brand: BrandKey;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = size === "sm" ? "size-[18px]" : size === "lg" ? "size-6" : "size-5";
  const type =
    size === "sm" ? "text-[0.8125rem]" : size === "lg" ? "text-base" : "text-sm";

  return (
    <span className={`r-logo ${className}`}>
      <BrandGlyph brand={brand} className={`${box} shrink-0`} />
      <span className={`r-logo-word ${type}`}>{LABEL[brand]}</span>
    </span>
  );
}
