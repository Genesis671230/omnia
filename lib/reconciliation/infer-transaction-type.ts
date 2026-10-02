// What Zoho should book a bank line as, read off the account on the other
// side — so in the posting form you pick accounts and the type follows.
// Pure; client-safe.

import type { ZohoTransactionType } from "./mapping-resolver";

type Account = { account_name: string; account_type: string };

export function inferTransactionType(direction: "credit" | "debit" | undefined, other: Account | undefined): ZohoTransactionType | null {
  if (!other) return null;
  const t = other.account_type;
  // A card can be kept as a liability ("Credit Card - XXX-8436", Omniastores):
  // paying it is still a transfer, never an expense.
  const card = t === "credit_card" || (/liability/.test(t) && /credit\s*card/i.test(other.account_name) && !/charges/i.test(other.account_name));
  const money = t === "bank" || t === "cash" || card;
  if (direction === "credit") {
    if (t === "equity") return "owner_contribution";
    if (money) return "transfer_fund";
    if (/interest/i.test(other.account_name) && (t === "income" || t === "other_income")) return "interest_income";
    if (t === "other_income") return "other_income";
    return "deposit";
  }
  if (t === "equity") return "owner_drawings";
  if (money) return "transfer_fund";
  return "expense"; // expenses, prepaid, suspense, advances — /expenses takes any of them
}
