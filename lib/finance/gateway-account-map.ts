// Resolves a payments-sheet row (gateway + which tab + currency/region) to
// the actual Zoho clearing account it should post against. Pure/no I/O —
// matches by name against whatever account list the caller already has in
// memory (zohoConfig.allAccounts from useZohoSettings(), fetched once and
// shared — see lib/hooks/use-zoho-settings.tsx). This function must NEVER
// trigger a Zoho API call; that's the whole point of it existing.
//
// Business rule, confirmed against the live chart of accounts on
// 2026-09-04 (account_type "payment_clearing"):
//   Telr, Stripe, Checkout — ONE account each, used regardless of which
//     sheet tab or currency the order came from:
//       Telr     -> "Telr Gateway"
//       Stripe   -> "Stripe Payment getaway"      (yes, "getaway" — a typo
//                    in the org's own Zoho account name, not ours; matched
//                    by "stripe" substring so the typo doesn't matter)
//       Checkout -> "Checkout - AED"               (a "Checkout - SAR"
//                    account also exists in Zoho but is deliberately NOT
//                    used — explicit business call, not a data gap)
//   Tabby, Tamara — split by region:
//       Local orders tab           -> the plain/AED account
//                                      ("TABBY AED", "TAMARA")
//       SMSA Orders tab + currency -> the region-specific account
//                                      ("TABBY KSA"/"TABBY KWD"/"TABBY QTR",
//                                       "TAMARA KSA"/"TAMARA KWD")
//   Shopify — ONE account ("SHOPIFY"), same idea as Telr/Stripe/Checkout.
//   COD — no clearing account exists in the chart of accounts (COD cash
//     lands in a bank/cash account directly, not a gateway clearing
//     account) — always resolves to null here, by design, not a bug.
//
// Matching is done by keyword, not literal string, against whatever
// GOOGLE/Zoho account list is passed in — this keeps it correct against
// the exact-cased "Stripe Payment getaway" typo, and adapts automatically
// if the org renames/adds an account (e.g. adding "TABBY BHD" tomorrow
// needs no code change, only a new REGION_KEYWORDS entry if it's a new
// region token).

export type ZohoAccountRef = { account_id: string; account_name: string; account_type?: string };

const CLEARING_ACCOUNT_TYPE = "payment_clearing";

// Every non-UAE region token that can show up in an account name — used to
// EXCLUDE region-specific accounts when resolving the "shared" (Local/UAE)
// variant, e.g. so "TAMARA KSA" is never picked for a Local-orders Tamara
// row just because it also contains "tamara".
const NON_UAE_REGION_TOKENS = ["ksa", "kwd", "qar", "qtr", "omr", "bhd", "sar"];

const REGION_TOKENS: Record<string, string[]> = {
  KSA: ["ksa"],
  KWD: ["kwd"],
  QAR: ["qar", "qtr"], // this org's own Zoho account is literally "TABBY QTR"
  OMR: ["omr"],
  BHD: ["bhd"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();
}

function clearingAccounts(accounts: ZohoAccountRef[]): ZohoAccountRef[] {
  // account_type may be absent on older callers' shapes — don't drop every
  // account just because the type field wasn't threaded through; only
  // filter when it's actually populated and clearly NOT a clearing account
  // (this is what stops "Delivery Charges - Tabby" or "Shopify marketing"
  // — both cost/expense accounts that also contain the gateway keyword —
  // from being mistaken for the real deposit account).
  return accounts.filter((a) => !a.account_type || a.account_type === CLEARING_ACCOUNT_TYPE);
}

// Gateways with exactly one clearing account, used no matter which sheet
// tab or currency the order came from.
const SHARED_GATEWAYS = new Set(["telr", "stripe", "checkout", "shopify"]);
// Gateways whose clearing account genuinely differs by tab/region.
const REGIONAL_GATEWAYS = new Set(["tabby", "tamara"]);

export function resolveZohoAccountForSheetRow(
  gatewayCanonical: string | null,
  tab: "smsa" | "local",
  region: string,
  accounts: ZohoAccountRef[],
): ZohoAccountRef | null {
  if (!gatewayCanonical) return null;
  const keyword = gatewayCanonical.toLowerCase();
  const pool = clearingAccounts(accounts);

  if (SHARED_GATEWAYS.has(keyword)) {
    // Exclude any account that carries a non-UAE region token — this is
    // what keeps Checkout from landing on "Checkout - SAR" just because it
    // also contains "checkout".
    const match = pool.find((a) => {
      const n = normalize(a.account_name);
      return n.includes(keyword) && !NON_UAE_REGION_TOKENS.some((t) => n.includes(t));
    });
    return match ?? null;
  }

  if (REGIONAL_GATEWAYS.has(keyword)) {
    if (tab === "local") {
      const match = pool.find((a) => {
        const n = normalize(a.account_name);
        return n.includes(keyword) && !NON_UAE_REGION_TOKENS.some((t) => n.includes(t));
      });
      return match ?? null;
    }
    const tokens = REGION_TOKENS[region];
    if (!tokens) return null; // an SMSA currency with no known Zoho account for it — don't guess
    const match = pool.find((a) => {
      const n = normalize(a.account_name);
      return n.includes(keyword) && tokens.some((t) => n.includes(t));
    });
    return match ?? null;
  }

  // COD and anything else unlisted (no business rule given) — don't guess.
  return null;
}
