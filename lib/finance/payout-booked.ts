// Is anything on a payout actually in Zoho?
//
// A settlement row is created for every order the moment a payout matches a
// bank credit, long before anything reaches Zoho — counting rows locked a
// payout's books ("20 booked here — locked") before a single document was
// written. Only a Zoho id means money is in those books. A PENDING write may
// have landed, so it counts; a CLAIMED lease is just a publish in progress
// that wrote nothing yet.

export const BOOKED_ID_COLUMNS = ["zoho_payment_id", "zoho_fee_expense_id", "zoho_fx_journal_id", "force_payment_id"] as const;

export function isBookedInZoho(r: Partial<Record<(typeof BOOKED_ID_COLUMNS)[number], string | null>>): boolean {
  return BOOKED_ID_COLUMNS.some((c) => {
    const v = r[c];
    return !!v && !v.startsWith("CLAIMED:");
  });
}
