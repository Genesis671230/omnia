import { Section, SectionHeading } from "./ui/section";
import { BrandMark, type BrandKey } from "./brand-marks";
import { Reveal } from "./reveal";

/* A logo wall, not a chip list. Three rows in one panel, split by hairlines,
   with payments carrying the most weight because that is the side of the
   ledger people arrive worried about. Books names its status inline: Zoho is
   live, the other two deep-link to the audit form with the tool preselected
   so "we're on Xero" is a click rather than an email. */

type Row = {
  label: string;
  note: string;
  size: "md" | "lg";
  items: { brand: BrandKey; href?: string; status?: string }[];
};

const ROWS: Row[] = [
  {
    label: "Payments",
    note: "Every payout file, including cash on delivery.",
    size: "lg",
    items: [
      { brand: "tabby" },
      { brand: "tamara" },
      { brand: "telr" },
      { brand: "stripe" },
      { brand: "checkout" },
      { brand: "cod" },
    ],
  },
  {
    label: "Stores",
    note: "Orders sync on their own, no export step.",
    size: "md",
    items: [{ brand: "shopify" }, { brand: "woocommerce" }],
  },
  {
    label: "Books",
    note: "Where the matched payment is posted.",
    size: "md",
    items: [
      { brand: "zoho", status: "Live" },
      { brand: "xero", href: "?tool=xero#audit", status: "On request" },
      { brand: "quickbooks", href: "?tool=quickbooks#audit", status: "On request" },
    ],
  },
];

export function Integrations() {
  return (
    <Section id="integrations">
      <div className="max-w-2xl">
        <SectionHeading>Works with what you already run</SectionHeading>
        <p className="r-lead mt-4" style={{ color: "var(--ink-60)" }}>
          No gateway switch, no new store platform, no re-keying. RAMZA reads what
          these already produce and posts the result into your books.
        </p>
      </div>

      <Reveal className="mt-10">
        <div className="r-glass r-grain relative overflow-hidden rounded-[1.75rem]">
          {ROWS.map((row, i) => (
            <div
              key={row.label}
              className={`relative z-[1] grid gap-5 px-6 py-8 sm:px-9 sm:py-9 lg:grid-cols-[13rem_1fr] lg:gap-8 ${
                i > 0 ? "border-t r-hairline" : ""
              }`}
            >
              <div>
                <h3
                  className="text-sm font-semibold tracking-tight"
                  style={{ color: "var(--ink)" }}
                >
                  {row.label}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed" style={{ color: "var(--ink-40)" }}>
                  {row.note}
                </p>
              </div>

              <div className="r-logo-rail">
                {row.items.map((item) =>
                  item.href ? (
                    <a
                      key={item.brand}
                      href={item.href}
                      className="r-logo-link"
                      title={item.status}
                    >
                      <BrandMark brand={item.brand} size={row.size} />
                      {item.status && <StatusDot status={item.status} />}
                    </a>
                  ) : (
                    <span key={item.brand} className="inline-flex items-center gap-2">
                      <BrandMark brand={item.brand} size={row.size} />
                      {item.status && <StatusDot status={item.status} />}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

function StatusDot({ status }: { status: string }) {
  const live = status === "Live";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
      style={{
        background: live
          ? "var(--brand-soft)"
          : "color-mix(in srgb, var(--residual) 16%, transparent)",
        color: live ? "var(--brand)" : "color-mix(in srgb, var(--residual) 80%, var(--ink))",
      }}
    >
      {status}
    </span>
  );
}
