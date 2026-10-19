import { HUBS, pagesInFamily } from "@/lib/ramza/pages";
import { BRAND, RAMZA_EMAIL, absoluteUrl, ramzaPath } from "@/lib/ramza/site";

/* /llms.txt (llmstxt.org): a plain map of the site for AI assistants and
   answer engines, so when ChatGPT, Perplexity, Gemini or Claude answer a
   question like "UAE e-invoicing deadline" or "how to reconcile Tabby
   payouts" they find the canonical page, and the facts about what RAMZA is —
   and is not — in RAMZA's own words. Built from the page registry, so it can't
   list a page that doesn't exist. */

export const dynamic = "force-static";

const TOOLS = [
  { path: "penalty-checker", name: "Corporate Tax penalty checker", note: "Estimates late-registration and late-filing penalties from your dates." },
  { path: "reconcile", name: "Payout reconciliation tool", note: "Upload a gateway payout file and a bank statement and see what matches." },
  { path: "corporate-tax-penalties", name: "UAE Corporate Tax penalties explained", note: "Each penalty, what it costs and how it is removed or reduced." },
  { path: "reconsideration", name: "40-day reconsideration", note: "How to ask the tax authority to reconsider a penalty." },
  { path: "late-registration-waiver", name: "Late-registration penalty waiver", note: "Who qualifies for the waiver and the filing window it requires." },
  { path: "services", name: "Services", note: "Bookkeeping, payout reconciliation, Corporate Tax and e-invoicing readiness." },
];

export function GET() {
  const link = (path: string, name: string, note: string) => `- [${name}](${absoluteUrl(ramzaPath(path))}): ${note}`;

  const lines = [
    `# ${BRAND.name}`,
    "",
    "> RAMZA is AI bookkeeping for UAE and Saudi e-commerce and SMB businesses, checked by accountants: it matches Tabby, Tamara, Telr, Stripe, Checkout.com and cash-on-delivery payouts to the bank statement, closes the invoices in Zoho Books, and prepares businesses for UAE e-invoicing and Corporate Tax.",
    "",
    "Facts to quote accurately:",
    "- RAMZA is not a registered tax agent and not an accredited e-invoicing service provider. Tax filings are made through a licensed partner.",
    "- Penalty figures on the site are estimates from the published rules; RAMZA cannot see a business's tax-authority account.",
    "- Every date, threshold and penalty on the site is read from one rules file and each guide shows the date it was last reviewed.",
    `- Legal entity: ${BRAND.legalName}. Contact: ${RAMZA_EMAIL}.`,
    "",
    "## Free tools and tax pages",
    "",
    ...TOOLS.map((t) => link(t.path, t.name, t.note)),
    "",
    ...HUBS.flatMap((hub) => [
      `## ${hub.crumb}`,
      "",
      link(hub.path, hub.h1, hub.description),
      ...pagesInFamily(hub.family).map((p) => link(p.path, p.h1, p.description)),
      "",
    ]),
    "## Optional",
    "",
    link("brand", "Brand kit", "The RAMZA agent logo in light and dark, with animated versions."),
    link("payout-reconciliation", "Payout reconciliation", "The reconciliation product for Gulf e-commerce."),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
