// Where the sales come from — counted sales grouped by shipping country, then
// by city inside each country. Same rule, calendar and money as the sales
// ledger (isCountedSale, Dubai day, gross_aed), so the countries always add up
// to the ledger's "Sold" for the same range.
//
// orders.country is the ISO-2 code both integrations store (Shopify
// countryCodeV2, WooCommerce billing.country). Anything that isn't two
// letters is reported as "unknown" rather than guessed onto the map.

import { dubaiDayKey } from "@/lib/dubai-day";
import { isCountedSale } from "./sale-rule";

export type GeoOrderInput = {
  store_id: string;
  financial_status: string | null;
  gateway: string | null;
  gross_aed: number | null;
  order_date: string | null;
  country: string | null;
  city: string | null;
};

export type CitySales = { city: string; orders: number; soldAed: number };

export type CountrySales = {
  /** ISO-2, upper case. */
  country: string;
  orders: number;
  soldAed: number;
  /** Share of the range's counted sales (0–1). */
  share: number;
  byStore: Record<string, number>;
  /** Biggest first; blank cities are grouped as "Unknown city". */
  cities: CitySales[];
};

export type SalesByCountry = {
  fromDay: string;
  toDay: string;
  total: { orders: number; soldAed: number };
  countries: CountrySales[];
  /** Counted sales whose country is missing or not an ISO-2 code. */
  unknown: { orders: number; soldAed: number };
};

const UNKNOWN_CITY = "Unknown city";

// Customers type the big Gulf cities in Arabic or in several spellings;
// without this Riyadh and الرياض show as two cities. Keys are lower-cased,
// with Arabic hamza / taa-marbuta / alef-maqsura folded (see fold()).
const CITY_ALIASES: Record<string, string> = {
  "الرياض": "Riyadh", "رياض": "Riyadh",
  "جده": "Jeddah", "jedda": "Jeddah", "jiddah": "Jeddah",
  "الدمام": "Dammam", "الخبر": "Khobar", "al khobar": "Khobar", "al-khobar": "Khobar",
  "مكه": "Makkah", "مكه المكرمه": "Makkah", "mecca": "Makkah", "makkah al mukarramah": "Makkah",
  "المدينه": "Madinah", "المدينه المنوره": "Madinah", "medina": "Madinah", "al madinah": "Madinah",
  "الطايف": "Taif", "تبوك": "Tabuk", "ابها": "Abha", "بريده": "Buraydah", "الاحسا": "Al Ahsa", "الاحساء": "Al Ahsa", "حايل": "Hail",
  "دبي": "Dubai", "ابوظبي": "Abu Dhabi", "ابو ظبي": "Abu Dhabi", "abudhabi": "Abu Dhabi",
  "الشارقه": "Sharjah", "العين": "Al Ain", "عجمان": "Ajman", "راس الخيمه": "Ras Al Khaimah", "الفجيره": "Fujairah",
  "الدوحه": "Doha", "مسقط": "Muscat", "صلاله": "Salalah", "صحار": "Sohar",
  "الكويت": "Kuwait City", "kuwait": "Kuwait City", "المنامه": "Manama",
};

const fold = (s: string) =>
  s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ئ/g, "ي");

/** "dubai " / "DUBAI" / "دبي" → "Dubai". Unrecognised non-Latin names are left as typed. */
export function normalizeCity(raw: string | null | undefined): string {
  const s = (raw || "").trim().replace(/\s+/g, " ");
  if (!s) return UNKNOWN_CITY;
  const alias = CITY_ALIASES[fold(s)];
  if (alias) return alias;
  if (!/^[\x20-\x7E]+$/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-'(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export function computeSalesByCountry(
  orders: GeoOrderInput[],
  { fromDay, toDay }: { fromDay: string; toDay: string },
): SalesByCountry {
  type Acc = { orders: number; soldAed: number; byStore: Record<string, number>; cities: Map<string, CitySales> };
  const acc = new Map<string, Acc>();
  const unknown = { orders: 0, soldAed: 0 };
  let totalOrders = 0;
  let totalAed = 0;

  for (const o of orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || day < fromDay || day > toDay) continue;
    if (!isCountedSale(o)) continue;
    const gross = Number(o.gross_aed) || 0;
    totalOrders += 1;
    totalAed += gross;

    const code = (o.country || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      unknown.orders += 1;
      unknown.soldAed += gross;
      continue;
    }
    let a = acc.get(code);
    if (!a) acc.set(code, (a = { orders: 0, soldAed: 0, byStore: {}, cities: new Map() }));
    a.orders += 1;
    a.soldAed += gross;
    a.byStore[o.store_id] = (a.byStore[o.store_id] || 0) + gross;

    const city = normalizeCity(o.city);
    const key = city.toLowerCase();
    const c = a.cities.get(key) ?? { city, orders: 0, soldAed: 0 };
    c.orders += 1;
    c.soldAed += gross;
    a.cities.set(key, c);
  }

  const round = (v: number) => Math.round(v * 100) / 100;
  const countries: CountrySales[] = [...acc.entries()]
    .map(([country, a]) => ({
      country,
      orders: a.orders,
      soldAed: round(a.soldAed),
      share: totalAed ? a.soldAed / totalAed : 0,
      byStore: Object.fromEntries(Object.entries(a.byStore).map(([k, v]) => [k, round(v)])),
      cities: [...a.cities.values()]
        .map((c) => ({ ...c, soldAed: round(c.soldAed) }))
        .sort((x, y) => y.soldAed - x.soldAed),
    }))
    .sort((x, y) => y.soldAed - x.soldAed);

  return {
    fromDay,
    toDay,
    total: { orders: totalOrders, soldAed: round(totalAed) },
    countries,
    unknown: { orders: unknown.orders, soldAed: round(unknown.soldAed) },
  };
}
