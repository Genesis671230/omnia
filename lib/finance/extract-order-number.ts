const ORDER_NUMBER_RE = /^(SA|WA|UAE|KSA|WOO)?\d{3,6}$/i;

export function extractOrderNumber(customerName: string | null | undefined): string | null {
  if (!customerName) return null;
  const first = customerName.trim().split(/\s+/, 1)[0];
  if (!first) return null;
  return ORDER_NUMBER_RE.test(first) ? first : null;
}