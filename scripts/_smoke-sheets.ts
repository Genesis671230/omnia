import "dotenv/config";
import { listTabNames, readHeaderRow } from "@/lib/integrations/google-sheets";

async function main() {
  const tabs = await listTabNames();
  console.log("tabs:", tabs);
  for (const tab of tabs) {
    try {
      const headers = await readHeaderRow(tab);
      console.log(`\n${tab}:`, headers);
    } catch (e) {
      console.log(`\n${tab}: ERROR —`, (e as Error).message);
    }
  }
}

main();
