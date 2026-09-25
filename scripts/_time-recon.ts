import "dotenv/config";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { getReconLines } from "@/lib/reconciliation/snapshot";
(async () => {
  let s = Date.now(); await runReconciliation(); console.log("run #1", Date.now() - s);
  s = Date.now(); await runReconciliation(); console.log("run #2 warm", Date.now() - s);
  for (let i = 0; i < 3; i++) { s = Date.now(); await getReconLines(); console.log("read", Date.now() - s); }
  process.exit(0);
})();
