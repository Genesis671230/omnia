import type { BankLineGroup } from "./group-detector";

export type GroupType =
  | "vendor_expense"
  | "profit_share"
  | "owner_drawing"
  | "inter_account"
  | "intl_goods_rcm"
  | "skip"
  | "unclassified";

export type TaxTreatment = "vat_registered" | "non_registered" | "non_gcc";
export type UAEEmirate = "AB" | "DU" | "SH" | "AJ" | "UAQ" | "RAK" | "FUJ";

export type ProfitSharePayee = {
  normalizedName: string;   // lowercased, whitespace-collapsed
  displayName: string;
  equityAccountId: string;  // Zoho chartofaccounts id under Equity
};

// One flat schema — only the fields relevant to the chosen groupType get used.
// This lets the panel pass a single object per row without wrestling with unions.
export type GroupClassification = {
  groupType: GroupType;
  paidThroughAccountId?: string;      // from_account_id (transfers) OR paid_through (expenses)
  placeOfSupply?: UAEEmirate;
  // Expense-side fields
  expenseAccountId?: string;          // account_id in expense payload
  taxTreatment?: TaxTreatment;
  taxId?: string;
  isInclusiveTax?: boolean;
  isReverseChargeApplied?: boolean;
  // Transfer-side field (equity account for profit_share/owner_drawing, bank for inter_account)
  destinationAccountId?: string;      // to_account_id in banktransaction payload
  autoClassified: boolean;
  reasons: string[];
};

export type ClassifierContext = {
  defaultBankAccountId: string;
  standardVat5Id: string;
  ownerDrawingsAccountId: string;
  defaultPlaceOfSupply: UAEEmirate;
  payees: ProfitSharePayee[];
};

export function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

const PROFIT_SHARE_HINT = /\bPS\b|profit\s*share/i;
const OWNER_TRANSFER_HINT = /TOF\s*-?\s*Transfer\s+of\s+Funds/i;
const INTL_GOODS_HINT = /goods\s+bought\s+or\s+sold/i;
const INTL_REF_PREFIX = /^DSZ/;

export function autoClassify(group: BankLineGroup, ctx: ClassifierContext): GroupClassification {
  const desc = group.mainLine.description || "";
  const payeeNorm = normalizeName(group.payee);
  const isIntlRef = INTL_REF_PREFIX.test(group.reference);

  const base: GroupClassification = {
    groupType: "unclassified",
    paidThroughAccountId: ctx.defaultBankAccountId,
    placeOfSupply: ctx.defaultPlaceOfSupply,
    autoClassified: false,
    reasons: [],
  };

  // 1. Known profit-share payee (Muhammad Akmal etc.) → auto profit_share with their account.
  const payee = ctx.payees.find((p) => p.normalizedName && payeeNorm.includes(p.normalizedName));
  if (payee) {
    return {
      ...base,
      groupType: "profit_share",
      destinationAccountId: payee.equityAccountId,
      autoClassified: true,
      reasons: [`payee matches profit-share list: ${payee.displayName}`],
    };
  }

  // 2. Omnia Mohamed with PS in narration → profit_share (equity account TBD by user first time).
  if (payeeNorm.includes("omnia mohamed") && PROFIT_SHARE_HINT.test(desc)) {
    return {
      ...base,
      groupType: "profit_share",
      autoClassified: true,
      reasons: ['Omnia Mohamed transfer marked "PS"'],
    };
  }

  // 3. Omnia Mohamed with TOF → owner_drawing (safer default; user can flip to profit_share).
  if (payeeNorm.includes("omnia mohamed") && OWNER_TRANSFER_HINT.test(desc)) {
    return {
      ...base,
      groupType: "owner_drawing",
      destinationAccountId: ctx.ownerDrawingsAccountId,
      autoClassified: true,
      reasons: ['Omnia Mohamed transfer marked "TOF"'],
    };
  }

  // 4. International DSZ ref + goods marker → RCM expense (non_gcc + reverse charge).
  if (isIntlRef && INTL_GOODS_HINT.test(desc)) {
    return {
      ...base,
      groupType: "intl_goods_rcm",
      taxTreatment: "non_gcc",
      taxId: ctx.standardVat5Id,
      isInclusiveTax: false,
      isReverseChargeApplied: true,
      autoClassified: true,
      reasons: ["international wire for goods — RCM applies"],
    };
  }

  return base;
}

// Called on every group-type change so defaults stay coherent (e.g. clearing
// expense fields when switching to a transfer type).
export function applyGroupTypeDefaults(
  current: GroupClassification,
  newType: GroupType,
  ctx: ClassifierContext,
): GroupClassification {
  const base: GroupClassification = {
    ...current,
    groupType: newType,
    autoClassified: false,
    reasons: [`manually set to ${GROUP_LABEL[newType]}`],
  };

  switch (newType) {
    case "vendor_expense":
      return {
        ...base,
        taxTreatment: current.taxTreatment ?? "vat_registered",
        taxId: current.taxId ?? ctx.standardVat5Id,
        isInclusiveTax: false,
        isReverseChargeApplied: false,
        destinationAccountId: undefined,
      };
    case "intl_goods_rcm":
      return {
        ...base,
        taxTreatment: "non_gcc",
        taxId: ctx.standardVat5Id,
        isInclusiveTax: false,
        isReverseChargeApplied: true,
        destinationAccountId: undefined,
      };
    case "profit_share":
      return {
        ...base,
        expenseAccountId: undefined,
        taxTreatment: undefined,
        taxId: undefined,
        isInclusiveTax: undefined,
        isReverseChargeApplied: undefined,
      };
    case "owner_drawing":
      return {
        ...base,
        destinationAccountId: current.destinationAccountId ?? ctx.ownerDrawingsAccountId,
        expenseAccountId: undefined,
        taxTreatment: undefined,
        taxId: undefined,
        isInclusiveTax: undefined,
        isReverseChargeApplied: undefined,
      };
    case "inter_account":
      return {
        ...base,
        expenseAccountId: undefined,
        taxTreatment: undefined,
        taxId: undefined,
        isInclusiveTax: undefined,
        isReverseChargeApplied: undefined,
      };
    default:
      return base;
  }
}

// The exact rule Hamza spelled out:
//   vat_registered → is_inclusive_tax=true, tax_id=Standard 5%
//   anything else  → is_inclusive_tax=false, no tax_id (posts as non-input-VAT expense)
export function applyTaxTreatmentDefaults(
  current: GroupClassification,
  treatment: TaxTreatment,
  ctx: ClassifierContext,
): GroupClassification {
  if (treatment === "vat_registered") {
    return { ...current, taxTreatment: treatment, isInclusiveTax: true, taxId: ctx.standardVat5Id };
  }
  return {
    ...current,
    taxTreatment: treatment,
    isInclusiveTax: false,
    taxId: undefined,
    // RCM flag only makes sense for non_gcc; carry-over from earlier state otherwise clears.
    isReverseChargeApplied: treatment === "non_gcc" ? current.isReverseChargeApplied : false,
  };
}

export function isReadyToPost(c: GroupClassification): boolean {
  if (c.groupType === "unclassified" || c.groupType === "skip") return false;
  if (!c.paidThroughAccountId) return false;
  switch (c.groupType) {
    case "vendor_expense":
    case "intl_goods_rcm":
      return Boolean(c.expenseAccountId && c.taxTreatment && c.placeOfSupply);
    case "profit_share":
    case "owner_drawing":
    case "inter_account":
      return Boolean(c.destinationAccountId);
    default:
      return false;
  }
}

export const GROUP_LABEL: Record<GroupType, string> = {
  vendor_expense: "Vendor expense",
  profit_share: "Profit share",
  owner_drawing: "Owner drawing",
  inter_account: "Between own accounts",
  intl_goods_rcm: "International goods (RCM)",
  skip: "Skip",
  unclassified: "— pick type —",
};