// Restore payouts that were lost to the statement-number collision.
//
// Tabby numbers a settlement statement by date and currency only
// ("Tabby20260914AED") but issues one report per store, and payouts.id is that
// statement number — so the second store's report overwrote the first. Against
// the real files, 13 distinct payouts collapsed onto 5 primary keys. Known
// casualties: AED 41,080.84 (Omniastores UAE, 2026-09-07) and SAR 12,505.79
// (Omniastores KSA, behind the AED 12,188.81 credit of 2026-09-09).
//
// lib/finance/payout-identity.ts now gives a colliding report its own id, so
// re-ingesting the original files restores them without touching the payouts
// that displaced them.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/restore-collided-payouts.ts <file>...
//   npx tsx --env-file=.env.local scripts/restore-collided-payouts.ts --write <file>...
//
// Dry run by default: parses, resolves the id each file would claim, and prints
// the plan without writing. Pass --write to store them.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parsePayoutFile } from "@/lib/parsers/payouts";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";
import { supabase } from "@/lib/supabase";

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const files = args.filter((a) => !a.startsWith("--"));

  if (files.length === 0) {
    console.error("Give at least one settlement report path.");
    process.exit(1);
  }

  console.log(write ? "MODE: writing to the database\n" : "MODE: dry run (pass --write to store)\n");

  for (const path of files) {
    const name = basename(path);
    let buf: Buffer;
    try {
      buf = readFileSync(path);
    } catch (e) {
      console.log(`SKIP  ${name} — ${(e as Error).message}`);
      continue;
    }

    let parsed;
    try {
      parsed = parsePayoutFile(buf, name);
    } catch (e) {
      console.log(`SKIP  ${name} — parse failed: ${(e as Error).message}`);
      continue;
    }

    for (const p of parsed) {
      const statementNo = p.statementNo ?? p.id;
      const { data: holder } = await supabase
        .from("payouts")
        .select("id, net_amount, store")
        .eq("id", statementNo)
        .maybeSingle();

      console.log(
        `${name}\n` +
          `   parsed   net ${p.net} · ${p.orderRefs.length} orders · store ${p.store ?? "?"} (${p.merchantCode ?? "?"})\n` +
          `   statement ${statementNo}` +
          (holder
            ? ` is held by net ${holder.net_amount} · store ${holder.store ?? "?"}`
            : " is unclaimed"),
      );

      if (!write) {
        console.log("   would store under a non-colliding id\n");
        continue;
      }

      const ids = await PayoutsRepository.upsertPayoutsWithIds([p]);
      const storedAs = ids.get(p.id) ?? p.id;
      console.log(`   STORED as ${storedAs}${storedAs === statementNo ? "" : "  (disambiguated)"}`);

      try {
        await FilesRepository.save({
          kind: "payout",
          provider: p.provider,
          filename: name,
          content: buf,
          parseSummary: `${storedAs} · net AED ${p.net.toFixed(2)} · ${p.orderRefs.length} orders`,
        });
      } catch (e) {
        // the payout is stored; archiving the raw file is best-effort
        console.log(`   (archive failed: ${(e as Error).message})`);
      }
      console.log();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
