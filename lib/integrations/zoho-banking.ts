// Zoho Books banking client — records the arrival of a gateway payout in the
// real bank account.
//
// WHY THIS IS NOT A "DEPOSIT":
// A Customer Payment is already written per settled order
// (createZohoCustomerPayment in ./zoho.ts), so by the time a payout lands the
// money is ALREADY in the books. Recording the payout as a `deposit` on top of
// that would count the same cash twice and inflate both revenue and the bank
// balance. So the money moves through a per-gateway clearing account instead:
//
//   1. customer pays          → Customer Payment deposits GROSS into "<Gateway> Clearing"
//   2. gateway wires the net  → transfer_fund: Clearing → Bank, for NET
//   3. gateway keeps its cut  → transfer_fund: Clearing → Merchant Fees, for FEE
//
// After (2) and (3) the clearing account has fallen by exactly GROSS and nets
// to zero once every order in it has settled. Whatever is left sitting in a
// clearing account is, by construction, money a gateway has collected from
// customers but not yet wired to us — a number worth watching on its own.
//
// SCOPE: this hits /books/v3, which needs ZohoBooks.banking.CREATE and
// ZohoBooks.banking.READ. The refresh token used by ./zoho.ts is scoped
// ZohoInventory.fullaccess.all and will 401 here — re-authorize with the
// banking scopes added before expecting any of this to write.

const BOOKS_API_BASE = "https://www.zohoapis.com/books/v3";

export type ZohoBankAccount = {
  account_id: string;
  account_name: string;
  account_type: string;
  currency_code: string;
  is_active: boolean;
};

// Which Zoho account each side of the movement lands in. Kept as plain data
// (not read from env inside the builder) so the posting math below can be
// tested exhaustively without any environment or network at all.
export type ZohoAccountMap = {
  bankAccountId: string;
  feeAccountId: string;
  clearingByGateway: Record<string, string>;
};

export type PayoutPostingInput = {
  gateway: string;
  bankReference: string;
  date: string; // YYYY-MM-DD
  /** What actually hit the bank, AED. */
  netAed: number;
  /** What customers were charged in total, AED — net + the gateway's fee. */
  grossAed: number;
  payoutId: string | null;
};

export type ZohoPosting = {
  /** Stable, derived from the bank reference — the idempotency key. */
  referenceNumber: string;
  transaction_type: "transfer_fund";
  from_account_id: string;
  to_account_id: string;
  amount: number;
  date: string;
  description: string;
};

export const FEE_REFERENCE_SUFFIX = "-FEE";

/**
 * Turns one reconciled payout into the Zoho postings that record it.
 *
 * Pure and total: it either returns a complete, balanced set of postings or
 * throws with the reason. It never emits a partial set, because a transfer
 * without its matching fee entry silently strands money in the clearing
 * account and looks like a gateway underpaid.
 */
export function buildPayoutPostings(
  input: PayoutPostingInput,
  accounts: ZohoAccountMap,
): ZohoPosting[] {
  const clearingId = accounts.clearingByGateway[input.gateway];
  if (!clearingId) {
    throw new Error(
      `No Zoho clearing account mapped for gateway "${input.gateway}" — ` +
        `refusing to guess which account this payout came from.`,
    );
  }
  if (!accounts.bankAccountId) throw new Error("No Zoho bank account configured");
  if (!input.bankReference) {
    throw new Error("Payout has no bank reference — it would be impossible to deduplicate in Zoho");
  }

  const net = +input.netAed.toFixed(2);
  const gross = +input.grossAed.toFixed(2);
  const fee = +(gross - net).toFixed(2);

  if (net <= 0) throw new Error(`Payout net must be positive, got ${net}`);
  if (fee < 0) {
    throw new Error(
      `Payout net ${net} exceeds gross ${gross} — a gateway paying more than it collected ` +
        `means the figures are wrong, not that we earned a bonus.`,
    );
  }

  const label = `${input.gateway} payout ${input.payoutId ?? input.bankReference}`;
  const postings: ZohoPosting[] = [
    {
      referenceNumber: input.bankReference,
      transaction_type: "transfer_fund",
      from_account_id: clearingId,
      to_account_id: accounts.bankAccountId,
      amount: net,
      date: input.date,
      description: `${label} — net settled to bank`,
    },
  ];

  // A zero fee is normal (COD remittances, some Stripe payouts) — emitting a
  // 0.00 posting would just be noise in the ledger.
  if (fee > 0) {
    postings.push({
      referenceNumber: `${input.bankReference}${FEE_REFERENCE_SUFFIX}`,
      transaction_type: "transfer_fund",
      from_account_id: clearingId,
      to_account_id: accounts.feeAccountId,
      amount: fee,
      date: input.date,
      description: `${label} — gateway fees withheld`,
    });
  }

  return postings;
}

/** Reads the account mapping from env. Throws with the missing key named. */
export function accountMapFromEnv(): ZohoAccountMap {
  const bankAccountId = process.env.ZOHO_BANK_ACCOUNT_ID;
  const feeAccountId = process.env.ZOHO_FEE_ACCOUNT_ID;
  if (!bankAccountId) throw new Error("ZOHO_BANK_ACCOUNT_ID is not set");
  if (!feeAccountId) throw new Error("ZOHO_FEE_ACCOUNT_ID is not set");

  let clearingByGateway: Record<string, string> = {};
  const raw = process.env.ZOHO_CLEARING_ACCOUNTS;
  if (raw) {
    try {
      clearingByGateway = JSON.parse(raw);
    } catch {
      throw new Error(`ZOHO_CLEARING_ACCOUNTS is not valid JSON: ${raw.slice(0, 80)}`);
    }
  }
  return { bankAccountId, feeAccountId, clearingByGateway };
}

export function zohoBankingConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_BANK_ACCOUNT_ID &&
      process.env.ZOHO_FEE_ACCOUNT_ID &&
      process.env.ZOHO_CLEARING_ACCOUNTS,
  );
}

async function booksFetch(
  path: string,
  accessToken: string,
  init?: RequestInit & { query?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const qs = new URLSearchParams({ organization_id: orgId, ...(init?.query ?? {}) });
  const res = await fetch(`${BOOKS_API_BASE}${path}?${qs}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // 401 here almost always means the token predates the banking scopes
    // rather than that it expired — say so, because the fix is a
    // re-authorization, not a retry.
    const hint =
      res.status === 401
        ? " (the token likely lacks ZohoBooks.banking scopes — re-authorize)"
        : "";
    throw new Error(`Zoho Books HTTP ${res.status}${hint} (${path}): ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  if (json.code !== 0) throw new Error(`Zoho Books error ${json.code} (${path}): ${json.message}`);
  return json;
}

export async function fetchZohoBankAccounts(accessToken: string): Promise<ZohoBankAccount[]> {
  const json = await booksFetch("/bankaccounts", accessToken);
  return (json.bankaccounts ?? []) as ZohoBankAccount[];
}

/**
 * Looks for a transaction already carrying this reference. Zoho has no
 * uniqueness constraint on reference_number, so this is what stops a retry
 * (or two people clicking publish) from recording the same payout twice.
 */
export async function findBankTransactionByReference(
  referenceNumber: string,
  accessToken: string,
): Promise<{ transaction_id: string; amount: number } | null> {
  const json = await booksFetch("/banktransactions", accessToken, {
    query: { reference_number: referenceNumber },
  });
  const rows = (json.banktransactions ?? []) as { transaction_id: string; amount: number; reference_number?: string }[];
  const exact = rows.find((r) => r.reference_number === referenceNumber);
  return exact ? { transaction_id: exact.transaction_id, amount: exact.amount } : null;
}

export async function createBankTransaction(
  posting: ZohoPosting,
  accessToken: string,
): Promise<{ transaction_id: string }> {
  const json = await booksFetch("/banktransactions", accessToken, {
    method: "POST",
    body: JSON.stringify({
      from_account_id: posting.from_account_id,
      to_account_id: posting.to_account_id,
      transaction_type: posting.transaction_type,
      amount: posting.amount,
      date: posting.date,
      reference_number: posting.referenceNumber,
      description: posting.description,
    }),
  });
  const tx = json.banktransaction as { transaction_id: string };
  return { transaction_id: tx.transaction_id };
}

export async function deleteBankTransaction(id: string, accessToken: string): Promise<void> {
  await booksFetch(`/banktransactions/${encodeURIComponent(id)}`, accessToken, { method: "DELETE" });
}

export type PostPayoutResult = {
  referenceNumber: string;
  transactionId: string;
  amount: number;
  /** True when the transaction already existed and was reused, not created. */
  alreadyPresent: boolean;
};

/**
 * Writes one payout's postings, skipping any that already exist.
 *
 * Each posting is checked-then-created individually rather than as a batch,
 * so a failure partway through leaves the successful ones in place and a
 * re-run completes the rest instead of duplicating them.
 */
export async function postPayoutToZoho(
  input: PayoutPostingInput,
  accounts: ZohoAccountMap,
  accessToken: string,
): Promise<PostPayoutResult[]> {
  const postings = buildPayoutPostings(input, accounts);
  const results: PostPayoutResult[] = [];
  for (const posting of postings) {
    const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
    if (existing) {
      results.push({
        referenceNumber: posting.referenceNumber,
        transactionId: existing.transaction_id,
        amount: existing.amount,
        alreadyPresent: true,
      });
      continue;
    }
    const created = await createBankTransaction(posting, accessToken);
    results.push({
      referenceNumber: posting.referenceNumber,
      transactionId: created.transaction_id,
      amount: posting.amount,
      alreadyPresent: false,
    });
  }
  return results;
}
