/* The gateways' own logos (public/gateways) on a white tile with a hairline;
 * a plain monogram tile for anything without one (Unclassified). */

const LOGOS: Record<string, string> = {
  stripe: "/gateways/stripe.png", tabby: "/gateways/tabby.png", tamara: "/gateways/tamara.png", telr: "/gateways/telr.png",
  "shopify payments": "/gateways/shopify.svg", shopify: "/gateways/shopify.svg", checkout: "/gateways/checkout.svg", cod: "/gateways/cod.svg",
};
const WIDE = new Set(["tamara", "telr", "checkout"]);

/** Every logo sits in the same fixed-width slot so the names beside them line up. */
export function GatewayLogo({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center" style={{ width: Math.round(size * 2.4) }}>
      <Logo name={name} size={size} />
    </span>
  );
}

function Logo({ name, size }: { name: string; size: number }) {
  const key = (name || "").trim().toLowerCase();
  const src = LOGOS[key];
  const box = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-[#E3E7F0] bg-white";
  if (!src) {
    return (
      <span className={`${box} text-[10px] font-semibold text-[#6B7385]`} style={{ height: size, width: size }} aria-hidden>
        {(name || "?").slice(0, 1)}
      </span>
    );
  }
  const wide = WIDE.has(key);
  return (
    <span className={`${box} ${wide ? "px-0.5" : ""}`} style={{ height: size, width: wide ? size * 2.4 : size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
      <img src={src} alt="" className="h-full w-full object-contain" />
    </span>
  );
}
