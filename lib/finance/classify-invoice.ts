import type { ResidualCategory } from "./types";

// balance/total < 0.10 catches the Aug 11 fee-residual pattern (gateway fees 2-8%).
// balance/total ≥ 0.10 is a legitimate partial payment.
export function classifyResidual(total: number, balance: number): ResidualCategory {
  if (total <= 0) return "truly_unpaid";
  if (balance >= total - 0.01) return "truly_unpaid";
  return balance / total < 0.10 ? "fee_residual" : "partial_payment";
}