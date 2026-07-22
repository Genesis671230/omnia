import { readFileSync } from "fs";
const t = readFileSync(".api/pdf-text.txt", "utf8");
for (const needle of ["FT26202HNZB", "FT26201C02Q", "AEL260721", "AC-0012043598001/FT2620"]) {
  let i = -1, n = 0;
  while ((i = t.indexOf(needle, i + 1)) !== -1 && n++ < 6) {
    console.log("=== " + needle + " @" + i + " ===");
    console.log(JSON.stringify(t.slice(Math.max(0, i - 300), i + 220)));
    console.log();
  }
}
