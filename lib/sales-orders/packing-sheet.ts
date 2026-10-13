// The warehouse's packing sheet: one Google spreadsheet per month, one tab per
// day of month ("1".."31"), listing every order dispatched that day with the
// packaging that went into the parcel (set box, bags, ring box…):
//
//   Count | Client # | SKU     | BOX TYPE | 1
//   1     | SA4063   |         |          | 1      ← order row (SKU may sit on it too)
//         |          | PAP999  | BAG(B)   | 1      ← packaging rows until the next order
//         |          | SET101  | SET BOX  | 1
//
// Columns H+ hold the day's stock verification block and are ignored here.
// Pure parsing lives here so it can be tested; the read is one batchGet.

import { readTabsValues } from "@/lib/integrations/google-sheets";

export type PackLine = { sku: string; description: string; qty: number; warehouse_id?: string };
export type PackedOrder = { orderNumber: string; day: number; packaging: PackLine[]; sheetRow: number };

/** Built-in sheet per month (YYYY-MM); Settings → salesorders.packing_sheets
 *  adds to / overrides this, and the page accepts a pasted link. */
export const PACKING_SHEETS: Record<string, string> = {
  "2026-10": "1krsLLGY9OgEF89l5ac71B8PjPobcuM2yXwas9fcTai4",
};

/** Accepts a bare id or a full docs.google.com URL. */
export function sheetIdFromInput(input: string): string {
  const m = input.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : input.trim();
}

// Order numbers seen in the sheet: OS4233, SA4063, WA56026, os3990 and bare
// Woo-era numbers (801907, 3516). Header words never match.
const ORDER_RE = /^(?:OS|SA|WA|UAE|KSA)?\d{3,}$/i;
const SKU_RE = /^[A-Z0-9][A-Z0-9-]{2,}$/i;

export function parsePackingTab(values: string[][], day: number): PackedOrder[] {
  const out: PackedOrder[] = [];
  let cur: PackedOrder | null = null;
  const add = (sku: string, desc: string) => {
    if (!cur) return;
    const key = sku.toUpperCase();
    const hit = cur.packaging.find((p) => p.sku === key);
    if (hit) hit.qty += 1;
    else cur.packaging.push({ sku: key, description: desc.trim(), qty: 1 });
  };
  values.forEach((row, i) => {
    if (i === 0) return; // header
    const order = String(row[1] ?? "").trim();
    const sku = String(row[2] ?? "").trim();
    const desc = String(row[3] ?? "");
    if (order && ORDER_RE.test(order)) {
      cur = { orderNumber: order.toUpperCase(), day, packaging: [], sheetRow: i + 1 };
      out.push(cur);
    }
    if (sku && SKU_RE.test(sku)) add(sku, desc);
  });
  return out;
}

const DAY_TAB = /^\s*([1-9]|[12]\d|3[01])\s*$/;

/** Every day tab of the month's sheet in one Sheets call. */
export async function readPackingMonth(spreadsheetId: string): Promise<{ orders: PackedOrder[]; days: number[] }> {
  const tabs = await readTabsValues(spreadsheetId, (title) => DAY_TAB.test(title));
  const orders: PackedOrder[] = [];
  const days: number[] = [];
  for (const t of tabs) {
    const day = Number(t.title.trim());
    const parsed = parsePackingTab(t.values, day);
    if (parsed.length) days.push(day);
    orders.push(...parsed);
  }
  return { orders, days: days.sort((a, b) => a - b) };
}
