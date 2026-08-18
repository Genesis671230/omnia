// scripts/test-order-extractor.ts
import { extractOrderNumber } from "@/lib/finance/extract-order-number";

// Real samples from Aug 17 probe + memory-noted patterns
const cases: Array<[string, string | null]> = [
  // From your probe
  ["3422 Reem Al", "3422"],
  ["803297 Doaa Hussein", "803297"],
  ["WA55444 Shama Alnuaimi", "WA55444"],
  ["WA55443 مها عبدالله رمضان ال علي", "WA55443"],
  ["803221 NDK88 PREMERA NADA", "803221"],
  ["SA3834 ريم الشدوخي", "SA3834"],
  // From memory / prior work
  ["SA3544 روعه العنزي", "SA3544"],
  ["802914 Sara Khan", "802914"],
  ["3311 Ahmed Al-Habsi", "3311"],
  // Edge cases — must return null
  ["روعه العنزي", null],                    // no leading number
  ["Walk-in Customer", null],                // Zoho's default
  ["", null],
  ["  ", null],
  ["12 Foo", null],                          // 2 digits, too short
  ["1234567 Foo", null],                     // 7 digits, too long
];

let pass = 0, fail = 0;
for (const [input, want] of cases) {
  const got = extractOrderNumber(input);
  const ok = got === want;
  console.log(`${ok ? "✓" : "✗"} "${input}" → ${JSON.stringify(got)}  (want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} passed`);