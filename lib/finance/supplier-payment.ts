// Splitting a supplier payment across that supplier's open bills. Pure.
//
// The payment amount defaults to the bank debit but may be any amount (a
// part of the debit, e.g. when one transfer paid two suppliers). Bills are
// paid oldest first unless someone types amounts in; whatever isn't applied
// stays on the supplier as an advance.

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type BillBalance = { bill_id: string; balance: number };

/** Fill bills oldest-first (the order given) until the amount runs out. */
export function allocateOldestFirst(amount: number, bills: BillBalance[]): Record<string, number> {
  let left = r2(amount);
  const out: Record<string, number> = {};
  for (const b of bills) {
    if (left <= 0) break;
    const take = r2(Math.min(left, b.balance));
    if (take > 0) out[b.bill_id] = take;
    left = r2(left - take);
  }
  return out;
}

export type AllocationCheck = { ok: boolean; applied: number; advance: number; errors: string[] };

export function checkAllocation(input: {
  amount: number;
  /** The bank debit the payment comes out of. */
  bankAmount: number;
  bills: BillBalance[];
  applied: Record<string, number>;
}): AllocationCheck {
  const errors: string[] = [];
  const amount = r2(input.amount);
  if (!(amount > 0)) errors.push("Enter an amount above zero.");
  if (amount > r2(input.bankAmount) + 0.005) errors.push(`The payment can't be more than the bank debit (AED ${input.bankAmount.toFixed(2)}).`);
  let applied = 0;
  for (const [billId, value] of Object.entries(input.applied)) {
    const v = r2(value);
    if (v === 0) continue;
    const bill = input.bills.find((b) => b.bill_id === billId);
    if (!bill) { errors.push("A bill picked is no longer open."); continue; }
    if (v < 0) errors.push("A bill can't take a negative amount.");
    if (v > bill.balance + 0.005) errors.push(`More than the balance owed on a bill (AED ${bill.balance.toFixed(2)}).`);
    applied = r2(applied + v);
  }
  if (applied > amount + 0.005) errors.push(`Bills take AED ${applied.toFixed(2)} — more than the payment of AED ${amount.toFixed(2)}.`);
  return { ok: errors.length === 0, applied, advance: r2(Math.max(amount - applied, 0)), errors };
}

/** One vendor payment per bank debit and supplier — the reference makes a retry find it. */
export function supplierPaymentReference(bankReference: string | null | undefined, bankLineId: string, vendorId: string) {
  return `${(bankReference || `BANKLINE-${bankLineId}`).trim().slice(0, 60)}/VP/${vendorId.slice(-8)}`;
}
