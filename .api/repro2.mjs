import { parseBankStatement } from "../lib/parsers/bank.ts";
// synthesized 21_07-style segments (ref trailing digit glued before real amount pair)
const cases = [
  "20/07/2026 FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2607210004075 ntsub.UvM1Do0/SppLEGm SHOPIFY- MJXZTIV865OZ6NWD9XV/FT26202HNZB1 FT26202HNZB1 FT26202HNZB1 2,345.67 890,123.45 ",
  "19/07/2026 Tax Amount Payable/ AC-0012043598001/FT26201C02Q9 FT26201C02Q FT26201C02Q9 -0.02 779,850.60 ",
  "19/07/2026 Outward SWIFT Charges/ DSZ26201CGC0JHK0 DSZ26201CGC0JHK0 -50.00 807,931.79 ",
];
for (const c of cases) {
  const r = parseBankStatement(c);
  const all = [...r.credits, ...r.debits];
  console.log(all.length ? `${all[0].direction} AED ${all[0].amount} ref=${all[0].reference}` : "NO MATCH", "| narr tail:", all[0]?.narration.slice(-40));
}
