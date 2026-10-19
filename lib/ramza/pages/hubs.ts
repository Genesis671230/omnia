import type { PageFamily } from "./types";

/* One index page per family, at the family's path prefix (/ramza/guides,
   /ramza/reconciliation, …). Hubs are what turn 18 loose pages into topic
   clusters: every page links up to its hub (breadcrumb + JSON-LD), the hub
   links down to all of them, and the site footer links to every hub — so no
   page is ever more than two clicks from any other. */

export type Hub = {
  family: PageFamily;
  /* Path relative to /ramza — also the prefix every page in the family uses. */
  path: string;
  crumb: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
};

export const HUBS: Hub[] = [
  {
    family: "guide",
    path: "guides",
    crumb: "Guides",
    title: "UAE tax, e-invoicing and reconciliation guides — RAMZA",
    description:
      "Plain-English guides for UAE businesses: e-invoicing deadlines, Corporate Tax rate and Small Business Relief, VAT registration, COD and gateway reconciliation.",
    h1: "Guides for UAE founders and finance teams",
    lead: "Each guide answers its question in the first paragraph, then shows the dates, thresholds and steps. Every number comes from the published rules and carries the date we last checked it.",
  },
  {
    family: "reconciliation",
    path: "reconciliation",
    crumb: "Reconciliation by gateway",
    title: "Payout reconciliation by gateway — Tabby, Tamara, Telr, Stripe, COD — RAMZA",
    description:
      "How each Gulf payment gateway settles, what its payout report contains, and how to match it to the bank and close the invoices in Zoho Books.",
    h1: "Payout reconciliation, gateway by gateway",
    lead: "Every gateway batches, nets and names its payouts differently. These pages show exactly how each one settles and how to tie it back to the orders and the bank.",
  },
  {
    family: "vs",
    path: "vs",
    crumb: "Comparisons",
    title: "RAMZA compared — A2X, Synder and spreadsheets — RAMZA",
    description:
      "Honest side-by-side comparisons of RAMZA with A2X, Synder and spreadsheet reconciliation for Gulf e-commerce, including where the other option wins.",
    h1: "How RAMZA compares",
    lead: "Side-by-side comparisons, with sources, including the rows where the other option is the better fit.",
  },
  {
    family: "market",
    path: "markets",
    crumb: "Markets",
    title: "E-commerce reconciliation in the UAE and Saudi Arabia — RAMZA",
    description:
      "What reconciliation looks like for online stores in the UAE and KSA: the gateways, currencies, VAT and settlement timing in each market.",
    h1: "Markets we work in",
    lead: "The gateways, currencies, VAT treatment and settlement timing that shape a month-end close in each market.",
  },
];

const BY_FAMILY = new Map(HUBS.map((h) => [h.family, h]));
const BY_PATH = new Map(HUBS.map((h) => [h.path, h]));

export function hubFor(family: PageFamily): Hub | undefined {
  return BY_FAMILY.get(family);
}

export function getHub(path: string): Hub | undefined {
  return BY_PATH.get(path.replace(/^\/+|\/+$/g, ""));
}
