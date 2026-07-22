import { readFileSync } from "fs";
const t = readFileSync(".api/pdf-text.txt", "utf8");
for (const needle of ["NETWORK INTERNATIONAL", "Tax Amount Payable"]) {
  let i = -1, n = 0;
  while ((i = t.indexOf(needle, i + 1)) !== -1 && n++ < 4) {
    console.log("=== @" + i + " ===");
    console.log(JSON.stringify(t.slice(Math.max(0, i - 260), i + 340)));
    console.log();
  }
}
