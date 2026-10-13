// Rows for the KSA dispatch sheet — the file the KSA team exports and sends
// to SMSA, who ship from their Riyadh fulfilment centre. One tab per month
// ("KSA Orders // Oct 2026"), one block per day:
//
//   (blank row)
//   ReferenceNumber | HeaderPO | ShipCarrier | … | TotalSalesPrice   ← header again
//   OS4301 | | SMSA | DLV | | | 10-Oct-26 | | 97470300292 | TAHANI ALHAJRI | …  | 999029883C1B16 | 1
//   OS4301 | …                                                                     | SET101 | 1
//
// One row per SKU, packaging included. Format read off the team's own rows
// (Sep–Oct 2026): ShipDate "10-Oct-26"; ShipToAddress1 = ShipToAddress2 =
// "address1\ncity as typed\nCountry" (address2 is NOT used); ShipToCity in
// English; mobile with the country code, digits only; CODAmount always 0.
// Pure — tested.

import { normalizeCity } from "@/lib/orders/sales-by-country";

export const KSA_HEADERS = [
  "ReferenceNumber", "HeaderPO", "ShipCarrier", "ShipService", "ShipBilling", "ShipAccount",
  "ShipDate", "CancelDate", "ShipToMobile", "ShipToName", "ShipToCompany", "ShipToAddress1",
  "ShipToAddress2", "ShipToCity", "ShipToState", "ShipToZip", "ShipToCountry", "ShipToPhone",
  "ShipToEmail", "SKU", "Quantity", "SerialNo", "LOTNo", "ExpiryDate", "CODCurrency", "CODAmount",
  "ShipToGPS", "TotalUnitCost", "TotalSalesPrice",
] as const;

export const SHIP_TO_COMPANY = "OMNIASTORES LLC (KSA FULFILLMENT)";

const COUNTRY: Record<string, { name: string; dial: string }> = {
  SA: { name: "Saudi Arabia", dial: "966" },
  QA: { name: "Qatar", dial: "974" },
  AE: { name: "United Arab Emirates", dial: "971" },
  KW: { name: "Kuwait", dial: "965" },
  OM: { name: "Oman", dial: "968" },
  BH: { name: "Bahrain", dial: "973" },
};
export const countryName = (code: string | null | undefined) => COUNTRY[(code ?? "").toUpperCase()]?.name ?? (code || "Saudi Arabia");

/** "+974 7030 0292" / "0553637139" / "533999015" / "00966…" → digits with the country code. */
export function phoneWithCode(raw: string | null | undefined, country: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  const dial = COUNTRY[(country ?? "SA").toUpperCase()]?.dial ?? "966";
  if (Object.values(COUNTRY).some((c) => d.startsWith(c.dial) && d.length > c.dial.length + 6)) return d;
  if (d.startsWith("0")) d = d.slice(1);
  return dial + d;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Dubai day "2026-10-10" → "10-Oct-26", the sheet's ShipDate. */
export function shipDateLabel(dubaiDay: string): string {
  const [y, m, d] = dubaiDay.split("-");
  return `${d}-${MON[Number(m) - 1]}-${y.slice(2)}`;
}

/** The month's tab among the sheet's titles: "KSA Orders // Oct 2026" or "KSA orders // October 2026". */
export function findMonthTab(titles: string[], dubaiDay: string): string | null {
  const [y, m] = dubaiDay.split("-").map(Number);
  const names = [MON[m - 1], MONTH_FULL[m - 1]].map((s) => s.toLowerCase());
  return titles.find((t) => {
    const hit = /^\s*ksa orders\s*\/\/\s*([a-z]+)\s+(\d{4})\s*$/i.exec(t);
    return Boolean(hit && Number(hit[2]) === y && names.includes(hit[1].toLowerCase()));
  }) ?? null;
}
export const newMonthTabTitle = (dubaiDay: string) => {
  const [y, m] = dubaiDay.split("-").map(Number);
  return `KSA Orders // ${MON[m - 1]} ${y}`;
};

export type KsaOrder = {
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  city: string | null;
  country: string | null;
  shipping_address1: string | null;
};

/** One row per SKU — products first, then packaging — keyed by header name. */
export function buildKsaRows(order: KsaOrder, skus: { sku: string; qty: number }[], dubaiDay: string, headers: readonly string[] = KSA_HEADERS): string[][] {
  const phone = phoneWithCode(order.customer_phone, order.country);
  const country = countryName(order.country);
  const city = (order.city ?? "").trim();
  const englishCity = city ? normalizeCity(city) : "";
  const address = [(order.shipping_address1 ?? "").trim(), city, country].filter(Boolean).join("\n");
  const base: Record<string, string> = {
    ReferenceNumber: order.order_number,
    ShipCarrier: "SMSA",
    ShipService: "DLV",
    ShipDate: shipDateLabel(dubaiDay),
    ShipToMobile: phone,
    ShipToName: (order.customer_name ?? "").trim(),
    ShipToCompany: SHIP_TO_COMPANY,
    ShipToAddress1: address,
    ShipToAddress2: address,
    ShipToCity: englishCity,
    ShipToCountry: country,
    ShipToPhone: phone,
    CODAmount: "0",
  };
  return skus.filter((s) => s.sku && s.qty > 0).map((s) => {
    const v: Record<string, string> = { ...base, SKU: s.sku, Quantity: String(s.qty) };
    return headers.map((h) => v[h.trim()] ?? "");
  });
}

/**
 * Where the rows go in the month tab (1-based start row) and what to write.
 * `values` is the tab as the Sheets API returns it (trailing empty rows cut).
 * Today's block already open (last row is today's) → just the rows; otherwise
 * a blank row + the header + the rows, the way the team starts each day.
 */
export function placeRows(values: string[][], rows: string[][], shipDate: string, headers: readonly string[] = KSA_HEADERS): { startRow: number; write: string[][] } {
  let last = values.length - 1;
  while (last >= 0 && !(values[last] ?? []).some((c) => String(c ?? "").trim())) last--;
  if (last < 0) return { startRow: 1, write: [[...headers], ...rows] };
  const dateCol = headers.indexOf("ShipDate");
  const lastRow = values[last];
  const todayOpen = String(lastRow[0] ?? "").trim() !== "ReferenceNumber" && String(lastRow[dateCol] ?? "").trim() === shipDate;
  return todayOpen
    ? { startRow: last + 2, write: rows }
    : { startRow: last + 2, write: [[], [...headers], ...rows] };
}

/** Is this order already in the tab? (ReferenceNumber column.) */
export const inTab = (values: string[][], orderNumber: string) =>
  values.some((r) => String(r[0] ?? "").trim().toUpperCase() === orderNumber.trim().toUpperCase());
