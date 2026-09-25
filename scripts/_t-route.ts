import "dotenv/config";
import { GET } from "@/app/api/reconcile/route";
(async () => {
  for (const qs of ["", "?from=2026-09-01&to=2026-09-25", ""]) {
    const s = Date.now();
    const res = await GET(new Request(`http://x/api/reconcile${qs}`));
    const j: any = await res.json();
    console.log(qs || "(all)", res.status, Date.now() - s, "ms", "lines", j.lines?.length, "unmatched", j.unmatchedPayouts?.length, "computedAt", j.computedAt, "stale", j.stale, "KB", Math.round(JSON.stringify(j).length / 1024));
  }
  process.exit(0);
})();
