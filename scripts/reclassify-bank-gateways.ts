// Re-run gateway classification over stored bank lines.
//
// gateway_guess is written once, at import, and the reconciler reads that
// stored value — so a fix to the classification rules does nothing for rows
// already in the table. This replays classifyBankCredit() over every bank line
// and updates the ones whose answer changed.
//
// Written for the Shopify/Stripe fix: both rails settle through NETWORK
// INTERNATIONAL LLC, the "NETWORK" rule matched first, and every Shopify
// Payments credit was stored as Stripe.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/reclassify-bank-gateways.ts
//   npx tsx --env-file=.env.local scripts/reclassify-bank-gateways.ts --write
//
// Dry run by default. Confirmed credits are reported but never touched without
// --include-confirmed: changing the provider under a confirmed row would move
// it away from the payout a human already signed off on.

import { classifyBankCredit } from "@/lib/gateways";
import { supabase } from "@/lib/supabase";

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const includeConfirmed = args.includes("--include-confirmed");

  const { data: lines, error } = await supabase
    .from("bank_lines")
    .select("id, description, amount, statement_date, gateway_guess, confidence");
  if (error) throw new Error(`bank_lines select failed: ${error.message}`);

  const { data: confirmedRows } = await supabase
    .from("recon_lines")
    .select("bank_line_id")
    .not("confirmed_by", "is", null);
  const confirmed = new Set((confirmedRows ?? []).map((r) => r.bank_line_id));

  const changes: {
    id: string; date: string; amount: number; from: string; to: string;
    confidence: string; locked: boolean; description: string;
  }[] = [];

  for (const l of lines ?? []) {
    const next = classifyBankCredit(l.description || "");
    const before = l.gateway_guess || "Unclassified";
    if (next.provider === before && next.confidence === (l.confidence || "unknown")) continue;
    changes.push({
      id: l.id,
      date: String(l.statement_date ?? "").slice(0, 10),
      amount: Number(l.amount),
      from: before,
      to: next.provider,
      confidence: next.confidence,
      locked: confirmed.has(l.id),
      description: String(l.description ?? "").slice(0, 90),
    });
  }

  const providerMoves = changes.filter((c) => c.from !== c.to);
  console.log(
    `${(lines ?? []).length} bank lines · ${changes.length} differ · ${providerMoves.length} change provider\n`,
  );

  const tally = new Map<string, number>();
  for (const c of providerMoves) {
    const key = `${c.from} -> ${c.to}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  for (const [move, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${move}`);
  }

  const locked = providerMoves.filter((c) => c.locked);
  if (locked.length > 0) {
    console.log(`\n${locked.length} of those sit on a CONFIRMED credit:`);
    for (const c of locked) console.log(`   ${c.date} | ${c.amount} | ${c.from} -> ${c.to}`);
    if (!includeConfirmed) console.log("   (left untouched — pass --include-confirmed to move them too)");
  }

  if (!write) {
    console.log("\nDry run. Pass --write to apply.");
    return;
  }

  const toApply = changes.filter((c) => includeConfirmed || !c.locked);
  let applied = 0;
  for (const c of toApply) {
    const { error: upErr } = await supabase
      .from("bank_lines")
      .update({ gateway_guess: c.to, confidence: c.confidence })
      .eq("id", c.id);
    if (upErr) {
      console.error(`   failed ${c.id}: ${upErr.message}`);
      continue;
    }
    applied += 1;
  }
  console.log(`\napplied ${applied} of ${toApply.length} updates`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
