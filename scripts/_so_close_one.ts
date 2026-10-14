import { close, targetsFor } from "@/lib/sales-orders/so-close.service";
(async () => {
  const { targets, missing } = await targetsFor("2026-10", [process.argv[2]]);
  console.log("missing", missing, "target", JSON.stringify(targets));
  console.log(JSON.stringify(await close(targets, 1), null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
