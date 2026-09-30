import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getAccessToken } from "@/lib/integrations/zoho";
import { planPayoutRevert } from "@/lib/finance/revert-payout";
(async () => {
  const p = await planPayoutRevert("a618e4fc-da63-41a1-867c-f7ed28d7e686", await getAccessToken());
  writeFileSync(process.argv[2], JSON.stringify(p, null, 1));
  console.log(p.payoutId, p.payoutSource, "confirmed", p.confirmed, "bank", p.bankAmount, p.bankReference);
  for (const d of p.docs) console.log(d.exists ? "DEL " : "gone", d.kind.padEnd(14), (d.amount ?? "").toString().padStart(9), d.reference.padEnd(38), d.label);
  console.log("skipped", p.skipped); console.log("totals", p.totals, "local", p.localRecords);
  process.exit(0);
})();
