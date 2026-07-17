// Default courier for a shipping invoice, derived from the order's
// destination country. Live country values observed in orders: AE, SA, QA,
// KW, OM, US — everything outside AE is "international" here.
export function defaultCourier(countryCode: string): "Ontrack" | "SMSA" {
  return (countryCode || "").trim().toUpperCase() === "AE" ? "Ontrack" : "SMSA";
}

// The alternate courier a founder can switch to for an international order.
export const COURIER_OPTIONS = ["Ontrack", "SMSA", "DHL"] as const;
