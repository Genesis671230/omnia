// Pull payout reports out of Gmail and into the reconciler.
//
// Gateways email a settlement report on every payout; until now someone had to
// notice the mail, download the attachment, and upload it by hand — which is
// why 176 of 238 credits sat in AWAITING_PAYOUT. This walks the configured
// mailboxes, finds the reports, and feeds the bytes to the same
// parsePayoutFile() the manual uploader uses.
//
// Two things a naive version gets wrong, both learned from a real message:
//
//  1. A Tabby payout email carries the settlement .xlsx AND a decoy
//     "blocked.gif", so attachments are selected by type, never by position.
//  2. The mail arrives FORWARDED (Tabby → support@omniastores.com → the
//     ingest mailbox), so From: is the forwarder, not Tabby. Matching keys on
//     sender OR subject, and the real proof is simply that an attachment
//     parses as a settlement report.
//
// Ingested payouts are stored UNPINNED so the existing auto-matcher claims them
// exactly as if they had been uploaded by hand. Every attempt is recorded in
// payout_email_ingests, keyed on the Gmail message id, which makes re-polling a
// no-op and leaves failures visible instead of silent.

import type { Gateway } from "@/lib/gateways";
import {
  flattenParts,
  getAttachment,
  getMessage,
  gmailConfigured,
  gmailMailboxes,
  headerValue,
  searchMessages,
  type GmailMessage,
  type GmailPart,
} from "@/lib/integrations/gmail";
import { parsePayoutFile } from "@/lib/parsers/payouts";
import { FilesRepository } from "@/lib/repositories/files.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { PayoutEmailIngestsRepository } from "@/lib/repositories/payout-email-ingests.repository";

export type PayoutEmailSource = {
  provider: Gateway;
  /** Addresses the report originates from. Matched as a substring of From:. */
  senders: string[];
  /** Subject fragments that identify a payout report. */
  subjects: RegExp[];
  /** Which rail the sender implies. The FILE's own currency always wins; this
   *  is only a cross-check, because a forwarded mail can come from anywhere. */
  currencyHint?: string;
};

export const PAYOUT_EMAIL_SOURCES: PayoutEmailSource[] = [
  {
    provider: "Tabby",
    senders: ["notifications@tabby.ai"],
    subjects: [/you['’]?re getting a payout from tabby/i],
    currencyHint: "AED",
  },
  {
    provider: "Tabby",
    senders: ["notifications@tabby.sa"],
    subjects: [/tabby payout report/i],
    currencyHint: "SAR",
  },
];

/** Spreadsheet types a payout report actually arrives as. Everything else in
 *  the message — tracking pixels, logos, "blocked.gif", PDFs — is ignored. */
const REPORT_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);
const REPORT_EXT = /\.(xlsx|xls|csv)$/i;

export type ReportAttachment = { filename: string; attachmentId: string; mimeType: string };

export function pickReportAttachments(msg: GmailMessage): ReportAttachment[] {
  const out: ReportAttachment[] = [];
  for (const part of flattenParts(msg.payload) as GmailPart[]) {
    const filename = part.filename ?? "";
    const mimeType = part.mimeType ?? "";
    const attachmentId = part.body?.attachmentId;
    if (!attachmentId) continue; // inline, not downloadable
    if (!REPORT_MIME.has(mimeType) && !REPORT_EXT.test(filename)) continue;
    out.push({ filename, attachmentId, mimeType });
  }
  return out;
}

/** Which registered source, if any, a message belongs to. Sender OR subject —
 *  a forwarded report keeps the subject but loses the sender. */
export function matchSource(msg: GmailMessage): PayoutEmailSource | null {
  const from = headerValue(msg, "From").toLowerCase();
  const subject = headerValue(msg, "Subject");

  for (const source of PAYOUT_EMAIL_SOURCES) {
    if (source.senders.some((s) => from.includes(s.toLowerCase()))) return source;
  }
  for (const source of PAYOUT_EMAIL_SOURCES) {
    if (source.subjects.some((re) => re.test(subject))) return source;
  }
  return null;
}

/** Gmail search covering every registered source. Senders alone would miss
 *  forwarded mail, so subjects are ORed in and the result is narrowed by
 *  has:attachment. */
export function buildSearchQuery(days = 30): string {
  const clauses: string[] = [];
  for (const source of PAYOUT_EMAIL_SOURCES) {
    for (const sender of source.senders) clauses.push(`from:${sender}`);
    for (const re of source.subjects) {
      const phrase = re.source
        .replace(/\\(.)/g, "$1")
        .replace(/\[.*?\]/g, "'")
        .replace(/[()^$?*+|]/g, "")
        .trim();
      if (phrase) clauses.push(`subject:"${phrase}"`);
    }
  }
  return `{${clauses.join(" ")}} has:attachment newer_than:${days}d`;
}

export type IngestOutcome = {
  messageId: string;
  mailbox: string;
  subject: string;
  status: "ingested" | "skipped" | "failed";
  payoutId?: string;
  attachmentName?: string;
  error?: string;
};

export type IngestSummary = {
  configured: boolean;
  mailboxes: string[];
  scanned: number;
  ingested: number;
  skipped: number;
  failed: number;
  outcomes: IngestOutcome[];
};

export async function ingestPayoutEmails(options?: { days?: number; max?: number }): Promise<IngestSummary> {
  const days = options?.days ?? 30;
  const max = options?.max ?? 50;
  const mailboxes = gmailMailboxes();
  const summary: IngestSummary = {
    configured: gmailConfigured(),
    mailboxes,
    scanned: 0,
    ingested: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };
  if (!summary.configured || mailboxes.length === 0) return summary;

  const query = buildSearchQuery(days);
  const alreadySeen = await PayoutEmailIngestsRepository.seenMessageIds();

  for (const mailbox of mailboxes) {
    let refs;
    try {
      refs = await searchMessages(mailbox, query, max);
    } catch (e) {
      summary.failed += 1;
      summary.outcomes.push({
        messageId: "-", mailbox, subject: "-", status: "failed",
        error: `search failed: ${(e as Error).message}`,
      });
      continue;
    }

    for (const ref of refs) {
      summary.scanned += 1;
      if (alreadySeen.has(ref.id)) {
        summary.skipped += 1;
        continue; // already handled on an earlier cycle
      }
      const outcome = await ingestOne(mailbox, ref.id);
      summary.outcomes.push(outcome);
      if (outcome.status === "ingested") summary.ingested += 1;
      else if (outcome.status === "skipped") summary.skipped += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

async function ingestOne(mailbox: string, messageId: string): Promise<IngestOutcome> {
  let msg: GmailMessage;
  try {
    msg = await getMessage(mailbox, messageId);
  } catch (e) {
    return { messageId, mailbox, subject: "-", status: "failed", error: (e as Error).message };
  }

  const subject = headerValue(msg, "Subject");
  const sender = headerValue(msg, "From");
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
  const source = matchSource(msg);

  const record = async (o: IngestOutcome, extra?: { provider?: string }) => {
    await PayoutEmailIngestsRepository.record({
      messageId, mailbox, sender, subject, receivedAt,
      provider: extra?.provider ?? source?.provider ?? null,
      attachmentName: o.attachmentName ?? null,
      payoutId: o.payoutId ?? null,
      status: o.status,
      error: o.error ?? null,
    }).catch(() => {
      // the payout is what matters; an audit-row failure must not fail ingest
    });
    return o;
  };

  if (!source) {
    return record({ messageId, mailbox, subject, status: "skipped", error: "no matching payout source" });
  }

  const attachments = pickReportAttachments(msg);
  if (attachments.length === 0) {
    return record({ messageId, mailbox, subject, status: "skipped", error: "no settlement attachment" });
  }

  let lastError = "";
  for (const attachment of attachments) {
    try {
      const buf = await getAttachment(mailbox, messageId, attachment.attachmentId);
      const parsed = parsePayoutFile(buf, attachment.filename, source.provider);
      if (parsed.length === 0) {
        lastError = "parser produced no payouts";
        continue;
      }

      // Unpinned on purpose: the reconciler claims it by provider + amount,
      // exactly as it would a hand-uploaded file.
      const ids = await PayoutsRepository.upsertPayoutsWithIds(parsed);
      const storedIds = parsed.map((p) => ids.get(p.id) ?? p.id);

      for (const p of parsed) {
        const storedAs = ids.get(p.id) ?? p.id;
        if (p.originalCurrency && source.currencyHint && p.originalCurrency !== source.currencyHint) {
          // The file is authoritative; the sender only hinted. Worth saying out
          // loud because it means a rail was routed through an unexpected mailbox.
          console.warn(
            `[payout-email] ${storedAs}: file currency ${p.originalCurrency} != sender hint ${source.currencyHint}`,
          );
        }
        try {
          await FilesRepository.save({
            kind: "payout",
            provider: p.provider,
            filename: attachment.filename,
            content: buf,
            parseSummary: `${storedAs} · net AED ${p.net.toFixed(2)} · ${p.orderRefs.length} orders · via ${mailbox}`,
          });
        } catch {
          // archiving is best-effort; the payout is already stored
        }
      }

      return record({
        messageId, mailbox, subject, status: "ingested",
        payoutId: storedIds.join(","),
        attachmentName: attachment.filename,
      });
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  return record({
    messageId, mailbox, subject, status: "failed",
    attachmentName: attachments[0]?.filename,
    error: lastError || "no attachment could be parsed",
  });
}
