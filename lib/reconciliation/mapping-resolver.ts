


/**
 * Mapping Resolver
 * TransactionIntent + ZohoAccountMap + BankLine → DraftPosting
 * The ONLY place account IDs get resolved.
 */

import {
  classifyTransaction,
  type BankTransactionInput,
  type TransactionIntent,
  type TransactionKind,
} from "./transaction-classifier";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";

export type ZohoTransactionType =
  | "deposit" | "expense" | "transfer_fund"
  | "owner_contribution" | "owner_drawings"
  | "interest_income" | "other_income";

export type DraftPosting = {
  bankLineId: string;
  transactionType: ZohoTransactionType;
  intent: TransactionIntent;
  fromAccountId?: string;
  date: string;
  toAccountId?: string;
  amount: number;
  description: string;
  reference?: string;
  confidence: "ready" | "needs_review";
  reasons: string[];
};

const KIND_TO_ZOHO_TYPE: Record<TransactionKind, ZohoTransactionType> = {
  gateway_transfer: "transfer_fund",
  deposit: "deposit",
  expense: "expense",
  owner_contribution: "owner_contribution",
  owner_drawing: "owner_drawings",
  interest_income: "interest_income",
  refund: "expense",
  unknown: "deposit",
};


export type ZohoSettings = {
  bankAccountId: string;
  clearingByGateway: Record<string, string>;   // gateway key -> Zoho account id
  expenseAccountByKind: Record<string, string>; // category key -> Zoho account id
  defaultIncomeAccountId: string;
};


export function guessAccountId(
  entity: string | undefined,
  accounts: { account_id: string; account_name: string }[],
): string | undefined {
  if (!entity) return undefined;
  const needle = entity.toLowerCase();
  return accounts.find((a) => a.account_name.toLowerCase().includes(needle))?.account_id;
}

export function normalizeZohoSettings(raw: Partial<ZohoSettings> | undefined | null): ZohoSettings {
  return {
    bankAccountId: raw?.bankAccountId ?? "",
    clearingByGateway: raw?.clearingByGateway ?? {},
    expenseAccountByKind: raw?.expenseAccountByKind ?? {},
    defaultIncomeAccountId: raw?.defaultIncomeAccountId ?? "",
  };
}

/** Guards every field with a fallback so downstream code never hits `.property of undefined`. */
export function normalizeAccountMap(raw: Partial<ZohoAccountMap> | undefined | null): ZohoAccountMap {
  return {
    bankAccountId: raw?.bankAccountId ?? "",
    feeAccountId: raw?.feeAccountId ?? "",
    clearingByGateway: raw?.clearingByGateway ?? {},
    defaultIncomeAccountId: raw?.defaultIncomeAccountId ?? "",
    expenseAccountByKind: raw?.expenseAccountByKind ?? {},
  };
}



export function resolveDraftPosting(line: BankTransactionInput, rawSettings: ZohoAccountMap): DraftPosting {
  const settings = normalizeAccountMap(rawSettings);
  const intent = classifyTransaction(line);
  const isCredit = line.amount > 0;

  const base: DraftPosting = {
    bankLineId: line.id,
    transactionType: KIND_TO_ZOHO_TYPE[intent.kind],
    intent,
    amount: Math.abs(line.amount),
    date: line.date ?? "",
    description: line.narration,
    reference: line.reference ?? undefined,
    confidence: "needs_review",
    reasons: [...intent.reasons],
    fromAccountId: isCredit ? undefined : settings.bankAccountId || undefined,
    toAccountId: isCredit ? settings.bankAccountId || undefined : undefined,
  };

  switch (intent.kind) {
    case "gateway_transfer": {
      const provider = intent.metadata.provider as string | undefined;
      const gatewayAccountId = provider ? settings.clearingByGateway[provider] : undefined;
      if (!gatewayAccountId) {
        return { ...base, reasons: [...base.reasons, `no clearing account mapped for "${provider ?? intent.entity}"`] };
      }
      return {
        ...base,
        fromAccountId: isCredit ? gatewayAccountId : settings.bankAccountId || undefined,
        toAccountId: isCredit ? settings.bankAccountId || undefined : gatewayAccountId,
        confidence: settings.bankAccountId ? "ready" : "needs_review",
        reasons: [...base.reasons, `mapped to ${intent.entity} clearing account`],
      };
    }

    case "refund": {
      const accountId = settings.defaultIncomeAccountId || undefined;
      return {
        ...base,
        transactionType: isCredit ? "deposit" : "expense",
        toAccountId: isCredit ? settings.bankAccountId || undefined : accountId,
        fromAccountId: isCredit ? accountId : settings.bankAccountId || undefined,
        confidence: accountId && settings.bankAccountId ? "ready" : "needs_review",
        reasons: [...base.reasons, "refund — routed via default income/expense account"],
      };
    }

    case "expense": {
      const kindKey = matchExpenseKind(intent, settings.expenseAccountByKind);
      const accountId = kindKey ? settings.expenseAccountByKind[kindKey] : undefined;
      return {
        ...base,
        toAccountId: accountId,
        confidence: accountId && settings.bankAccountId ? "ready" : "needs_review",
        reasons: accountId
          ? [...base.reasons, `matched expense category: ${kindKey}`]
          : [...base.reasons, "no expense category matched"],
      };
    }

    case "deposit": {
      const accountId = settings.defaultIncomeAccountId || undefined;
      return {
        ...base,
        fromAccountId: accountId,
        confidence: accountId && settings.bankAccountId ? "ready" : "needs_review",
        reasons: accountId
          ? [...base.reasons, "matched default income account"]
          : [...base.reasons, "no default income account configured"],
      };
    }

    case "owner_contribution":
    case "owner_drawing":
    case "interest_income":
      return { ...base, confidence: settings.bankAccountId ? "ready" : "needs_review" };

    default:
      return base;
  }
}

function matchExpenseKind(intent: TransactionIntent, expenseAccountByKind: Record<string, string> | undefined) {
  const map = expenseAccountByKind ?? {};
  return Object.keys(map).find((kind) =>
    intent.reasons.some((r) => r.toLowerCase().includes(kind.toLowerCase())) ||
    (intent.entity ?? "").toLowerCase().includes(kind.toLowerCase())
  );
}

