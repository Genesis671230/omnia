/* Navigation + contact for the RAMZA Corporate Tax site. One list so the nav,
   footer and sitemap never disagree. */

export const CT_NAV = [
  { href: "/ramza#e-invoicing", label: "E-invoicing" },
  { href: "/ramza#how", label: "How it works" },
  { href: "/ramza/reconcile", label: "Reconcile tool" },
  { href: "/ramza#tools", label: "Free tools" },
  { href: "/ramza/services", label: "Services" },
  { href: "/ramza/penalty-checker", label: "Penalty checker" },
  { href: "/ramza/corporate-tax-penalties", label: "Penalties" },
] as const;

/* The top nav (2026-10-20): three menus with pictures plus one plain link.
   CT_NAV above stays the flat list for the footer. Images: public/ramza/photos
   (stock, never given names or quotes) and the Noor film poster. */
export type MenuItem = { href: string; label: string; desc: string; img: string };
export type Menu = { label: string; items: MenuItem[]; feature: MenuItem & { eyebrow: string } };

const PH = "/ramza/photos";
export const CT_MENU: Menu[] = [
  {
    label: "Product",
    items: [
      { href: "/ramza/payout-reconciliation", label: "Month-end close", desc: "Every bank credit matched to the payout file and the orders inside it.", img: `${PH}/px-operator-desk.jpg` },
      { href: "/ramza#e-invoicing", label: "E-invoicing readiness", desc: "Invoices cleaned up and connected to an accredited provider before go-live.", img: `${PH}/bb-office-window-call.jpg` },
      { href: "/ramza/services", label: "Services & packages", desc: "Monthly close, filing rescue and readiness, checked by UAE accountants.", img: `${PH}/px-accountant-review.jpg` },
      { href: "/ramza#how", label: "How it works", desc: "Connect your bank, gateways and books once. RAMZA does the matching.", img: `${PH}/team-screen.jpg` },
    ],
    feature: { eyebrow: "Case study", href: "/ramza#case-study", label: "How Omniastores closes the month", desc: "Seven gateways, 1,173 orders, AED 1.42m checked against the bank in September 2026.", img: `${PH}/in-ecommerce-packing.jpg` },
  },
  {
    label: "Free tools",
    items: [
      { href: "/ramza/reconcile", label: "Reconcile tool", desc: "Drop a bank statement and a payout file, see what matches.", img: `${PH}/px-statements-calculator.jpg` },
      { href: "/ramza/penalty-checker", label: "Penalty checker", desc: "Estimate Corporate Tax late-filing penalties from your dates.", img: `${PH}/px-charts-review.jpg` },
      { href: "/ramza#start", label: "E-invoicing readiness check", desc: "Two minutes. Find out what your invoices are missing.", img: `${PH}/px-owner-tablet.jpg` },
      { href: "/ramza#tools", label: "All free tools", desc: "VAT, Corporate Tax, Small Business Relief and e-invoicing calculators.", img: `${PH}/px-cafe-laptop.jpg` },
    ],
    feature: { eyebrow: "Watch", href: "/ramza#films", label: "Meet Noor", desc: "Short films on the month-end problems owners actually have. AI presenter.", img: "/ramza/video/noor-interview.jpg" },
  },
  {
    label: "Corporate Tax",
    items: [
      { href: "/ramza/corporate-tax-penalties", label: "Late-filing penalties", desc: "What the monthly penalty adds up to, and what stops it.", img: `${PH}/px-accountant-files.jpg` },
      { href: "/ramza/reconsideration", label: "40-day reconsideration", desc: "How to ask for a penalty to be reviewed, and by when.", img: `${PH}/advisor-meeting.jpg` },
      { href: "/ramza/late-registration-waiver", label: "Registration waiver", desc: "Who still qualifies, and who doesn't.", img: `${PH}/handshake.jpg` },
      { href: "/ramza/guides", label: "UAE tax guides", desc: "Plain-English guides to VAT, Corporate Tax and e-invoicing.", img: `${PH}/presenting.jpg` },
    ],
    feature: { eyebrow: "Talk to us", href: "/ramza/contact", label: "Speak to an accountant", desc: "Send what you have. We reply with what's needed and a fixed quote.", img: `${PH}/px-founder-bright.jpg` },
  },
];
export const CT_NAV_LINKS = [{ href: "/ramza#pricing", label: "Pricing" }] as const;

export const CT_PENALTY_LINKS = [
  { href: "/ramza/reconsideration", label: "40-day reconsideration" },
  { href: "/ramza/late-registration-waiver", label: "Registration waiver" },
] as const;

export const CT_MORE = [
  { href: "/ramza/contact", label: "Contact" },
  { href: "/ramza/brand", label: "Brand kit" },
  { href: "/ramza/payout-reconciliation", label: "Payout reconciliation" },
  { href: "/privacy", label: "Privacy" },
] as const;

export function whatsappHref(text = "Hi RAMZA, I need help with my Corporate Tax."): string {
  const n = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!n) return "/ramza/contact";
  return `https://wa.me/${n.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
}
