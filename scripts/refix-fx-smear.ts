/**
 * Repairs orders booked with the old "bank scale" smear.
 *
 * Until 2026-09-16 every order on a cross-border payout was scaled by
 * bankAmount/payoutNet, which spread the remitting bank's one flat wire charge
 * across every order. That understated each gateway fee and overstated each
 * exchange difference — order 804734 was booked as fee 60.02 / FX 23.66 when
 * Tabby actually charged 60.26 and the real difference was 20.08.
 *
 * The payment itself is untouched: it closed the invoice in full and was
 * always right. Only the fee expense and the FX journal move, and the bank's
 * cut is then booked once for the whole credit.
 *
 *   npx tsx scripts/refix-fx-smear.ts --bank-line=<id>            # dry run
 *   npx tsx scripts/refix-fx-smear.ts --bank-line=<id> --apply    # writes
 *
 * Dry run by default, on purpose: these are live books.
 */
import "dotenv/config";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { getAccessToken } from "@/lib/integrations/zoho";
import {
  createJournal,
  fetchDocument,
  findDocumentByReference,
  updateExpense,
  updateJournal,
} from "@/lib/integrations/zoho-settlement-posting";
import {
  buildResidualJournalBody,
  isCrossBorderCurrency,
  planWireResidual,
  wireResidualReference,
} from "@/lib/finance/settlement-posting";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const APPLY = process.argv.includes("--apply");

const bankLineId = arg("bank-line");
if (!bankLineId) {
  console.error("Usage: npx tsx scripts/refix-fx-smear.ts --bank-line=<id> [--apply]");
  process.exit(1);
}

const bareRef = (r: string) => r.replace(/^#/, "").replace(/^(WA|UAE|KSA|WOO|SA)/i, "");

async function main() {

  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) throw new Error(`No reconciliation line ${bankLineId}`);
  if (!line.payout) throw new Error("That credit has no matched payout file.");

  const crossBorder = isCrossBorderCurrency(line.payout.currency);
  const sharesAtBankRate = line.payout.fxSource === "bank";
  if (!crossBorder || !sharesAtBankRate) {
    console.log("Nothing to repair: the smear only ever applied to a cross-border payout whose narration quoted a rate.");
    process.exit(0);
  }

  // The scale the old code used, and therefore what the stored figures mean.
  const oldScale = line.bankAmount / line.payout.net;
  const settlements = await SettlementsRepository.listByBankLineId(bankLineId);

  type Fix = {
    id: string; order: string; paymentAmount: number;
    feeOld: number; feeNew: number; fxOld: number; fxNew: number;
    expenseId?: string | null; journalId?: string | null;
  };
  const fixes: Fix[] = [];

  for (const s of settlements) {
    if (s.fee_aed == null) continue;
    const tx =
      line.transactions.find((t) => !t.isRefund && t.orderNumber === s.order_number) ??
      line.transactions.find((t) => !t.isRefund && bareRef(t.ref) === bareRef(s.order_number));
    if (!tx) { console.warn(`! ${s.order_number}: no payout line, skipped`); continue; }

    const feeOld = Number(s.fee_aed);
    const fxOld = Number(s.fx_difference_aed ?? 0);
    // What the old booking paid the invoice: it is the only unknown, and the
    // three stored figures must add back up to it.
    const netOld = round2(tx.netShare * oldScale);
    const paymentAmount = round2(feeOld + netOld + fxOld);

    const feeNew = round2(Math.abs(tx.feeShare) + Math.abs(tx.vatShare ?? 0));
    const netNew = round2(tx.netShare);
    const fxNew = round2(paymentAmount - feeNew - netNew);

    if (Math.abs(feeNew - feeOld) < 0.005 && Math.abs(fxNew - fxOld) < 0.005) continue;
    fixes.push({
      id: s.id, order: s.order_number, paymentAmount,
      feeOld, feeNew, fxOld, fxNew,
      expenseId: s.zoho_fee_expense_id, journalId: s.zoho_fx_journal_id,
    });
  }

  const wire = planWireResidual({
    crossBorder, bankAmount: line.bankAmount, payoutNet: line.payout.net, sharesAtBankRate,
  });

  console.log(`\n${line.provider} ${line.payout.currency} · credit ${line.reference} · payout ${line.payout.id}`);
  console.log(`bank credited ${line.bankAmount.toFixed(2)} vs payout ${line.payout.net.toFixed(2)} at the quoted rate\n`);
  console.table(
    fixes.map((f) => ({
      order: f.order,
      invoice: f.paymentAmount.toFixed(2),
      "fee was": f.feeOld.toFixed(2), "fee now": f.feeNew.toFixed(2),
      "FX was": f.fxOld.toFixed(2), "FX now": f.fxNew.toFixed(2),
      moved: (f.fxOld - f.fxNew).toFixed(2),
    })),
  );
  console.log(
    `\n${fixes.length} order(s) to correct · FX overstated by ` +
    `${fixes.reduce((n, f) => n + (f.fxOld - f.fxNew), 0).toFixed(2)} in total · ` +
    `fees understated by ${fixes.reduce((n, f) => n + (f.feeNew - f.feeOld), 0).toFixed(2)}`,
  );
  console.log(
    wire.needed
      ? `Plus the bank's wire charge of ${Math.abs(wire.amount).toFixed(2)}, to be booked once for the credit.`
      : "No separate wire charge needed.",
  );

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to correct Zoho and the database.");
    process.exit(0);
  }

  const accessToken = await getAccessToken();

  for (const f of fixes) {
    // Fee expense: re-send what Zoho already holds, with the corrected amount.
    if (f.expenseId && !f.expenseId.startsWith("PENDING:")) {
      const doc = await fetchDocument("expenses", f.expenseId, accessToken);
      if (!doc) {
        // Gone from Zoho. Drop the dead id so the app's normal Record flow
        // posts a fresh expense at the corrected figure.
        console.warn(`! ${f.order}: expense ${f.expenseId} no longer exists in Zoho — clearing it so it can be re-posted`);
        await SettlementsRepository.updatePosting(f.id, { zoho_fee_expense_id: null });
      } else {
        await updateExpense(f.expenseId, { ...doc, amount: f.feeNew }, accessToken);
        console.log(`  ${f.order} expense ${f.expenseId}: ${f.feeOld.toFixed(2)} -> ${f.feeNew.toFixed(2)}`);
      }
    }

    // FX journal: both legs carry the same figure.
    if (f.journalId && !f.journalId.startsWith("PENDING:")) {
      const doc = await fetchDocument("journals", f.journalId, accessToken);
      if (!doc) {
        console.warn(`! ${f.order}: journal ${f.journalId} no longer exists in Zoho — clearing it so it can be re-posted`);
        await SettlementsRepository.updatePosting(f.id, { zoho_fx_journal_id: null });
      } else {
        const lines = (doc.line_items as { amount?: number }[] | undefined) ?? [];
        const amount = Math.abs(f.fxNew);
        // A sign flip would mean swapping which leg is the debit; that is a
        // different journal, so leave it for a person rather than guess.
        if (Math.sign(f.fxNew) !== Math.sign(f.fxOld) && f.fxOld !== 0) {
          console.warn(`! ${f.order}: FX flips sign (${f.fxOld} -> ${f.fxNew}) — correct this one by hand`);
        } else {
          await updateJournal(
            f.journalId,
            { ...doc, line_items: lines.map((l) => ({ ...l, amount })) },
            accessToken,
          );
          console.log(`  ${f.order} journal ${f.journalId}: ${f.fxOld.toFixed(2)} -> ${f.fxNew.toFixed(2)}`);
        }
      }
    }

    await SettlementsRepository.updatePosting(f.id, {
      fee_aed: f.feeNew,
      fx_difference_aed: f.fxNew,
    });
  }

  // The bank's own cut, once for the whole credit.
  if (wire.needed) {
    const reference = wireResidualReference((line.reference || line.id).trim());
    const existing = await findDocumentByReference("journals", reference, accessToken);
    if (existing) {
      console.log(`\nWire charge already booked as journal ${existing}.`);
    } else {
      const first = settlements.find((s) => s.zoho_fx_journal_id && !s.zoho_fx_journal_id.startsWith("PENDING:"));
      const sample = first?.zoho_fx_journal_id
        ? await fetchDocument("journals", first.zoho_fx_journal_id, accessToken)
        : null;
      const legs = (sample?.line_items as { account_id?: string; debit_or_credit?: string }[] | undefined) ?? [];
      const debit = legs.find((l) => l.debit_or_credit === "debit")?.account_id;
      const credit = legs.find((l) => l.debit_or_credit === "credit")?.account_id;
      if (!debit || !credit) {
        console.warn("\n! Could not read the exchange / clearing accounts from an existing journal — book the wire charge from the app instead.");
      } else {
        const id = await createJournal(
          buildResidualJournalBody({
            amount: wire.amount,
            // An existing per-order FX journal for a loss debits exchange, credits clearing.
            accounts: { depositAccountId: credit, feeAccountId: "", differenceAccountId: debit },
            date: (line.date ?? new Date().toISOString()).slice(0, 10),
            reference,
            description:
              `${line.provider} ${line.payout.currency} wire charge · payout ${line.payout.net.toFixed(2)} at the bank's quoted rate, ` +
              `AED ${line.bankAmount.toFixed(2)} credited`,
          }),
          accessToken,
        );
        console.log(`\nWire charge ${Math.abs(wire.amount).toFixed(2)} booked as journal ${id}.`);
      }
    }
  }

  console.log("\nDone.");

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
