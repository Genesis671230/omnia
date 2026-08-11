import "dotenv/config";
import { syncAllStores } from "@/lib/sync/order-sync.service";

async function main() {
  const results = await syncAllStores(3);
  console.log(JSON.stringify(results, null, 2));
}

main();
