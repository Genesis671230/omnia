/* The gateways and books RAMZA reconciles — their real marks, in their own
 * colours, on white tiles. Files live in public/ramza/logos/*-mark.png (the
 * companies' published marks). We name integrations we support; never imply
 * partnership or endorsement.
 *
 *   <PartnerLogos />   static row of tiles
 *   <LogoMarquee />    the same tiles drifting sideways (pauses on hover,
 *                      static for prefers-reduced-motion) */

export const GATEWAYS = [
  { key: "tabby", name: "Tabby", src: "/ramza/logos/tabby-mark.png", kind: "icon" },
  { key: "tamara", name: "Tamara", src: "/ramza/logos/tamara-mark.png", kind: "word" },
  { key: "stripe", name: "Stripe", src: "/ramza/logos/stripe-mark.png", kind: "icon" },
  { key: "telr", name: "Telr", src: "/ramza/logos/telr-mark.png", kind: "word" },
  { key: "zoho", name: "Zoho Books", src: "/ramza/logos/zoho-mark.png", kind: "word" },
] as const;

export type GatewayKey = (typeof GATEWAYS)[number]["key"];

/** One mark at a given height — icon marks get their name beside them. */
export function GatewayMark({ g, h = 28 }: { g: (typeof GATEWAYS)[number]; h?: number }) {
  return g.kind === "icon" ? (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
      <img src={g.src} alt="" style={{ height: h, width: h }} className="rounded-[7px]" />
      <span className="font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[-0.01em] text-[#14131C]">{g.name}</span>
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand mark
    <img src={g.src} alt={g.name} style={{ height: h }} className="w-auto rounded-[6px]" />
  );
}

function Tile({ g }: { g: (typeof GATEWAYS)[number] }) {
  return (
    <span className="flex h-[64px] shrink-0 items-center justify-center rounded-2xl bg-white px-6 shadow-[0_1px_2px_rgba(20,19,28,0.06),0_14px_30px_-22px_rgba(20,19,28,0.45)] ring-1 ring-[#E8E5DE]" title={g.name}>
      <GatewayMark g={g} h={g.kind === "icon" ? 30 : 30} />
    </span>
  );
}

export function PartnerLogos({ label = "Works with" }: { tone?: "dark" | "light"; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label && <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6E6B75]">{label}</span>}
      {GATEWAYS.map((g) => <Tile key={g.key} g={g} />)}
    </div>
  );
}

export function LogoMarquee() {
  const row = [...GATEWAYS, ...GATEWAYS, ...GATEWAYS];
  return (
    <div className="group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div className="flex w-max gap-4 py-2 motion-safe:animate-[ramza-marquee_38s_linear_infinite] group-hover:[animation-play-state:paused]">
        {[...row, ...row].map((g, i) => <Tile key={`${g.key}-${i}`} g={g} />)}
      </div>
    </div>
  );
}
