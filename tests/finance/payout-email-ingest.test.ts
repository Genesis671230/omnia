import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQuery,
  matchSource,
  pickReportAttachments,
  PAYOUT_EMAIL_SOURCES,
} from "@/lib/finance/payout-email-ingest";
import type { GmailMessage } from "@/lib/integrations/gmail";

// Built against a real Tabby payout email. Two traps it exposed:
//
//  1. The message carries TWO attachments — the settlement .xlsx and a decoy
//     "blocked.gif" — so "take the attachment" picks the wrong one.
//  2. The mail reaches the mailbox FORWARDED (Tabby → support@omniastores.com →
//     marketingomniastore@gmail.com), so From: is the forwarder. A
//     sender-only query matches nothing at all.

function msg(headers: Record<string, string>, parts: GmailMessage["payload"]): GmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    payload: {
      ...parts,
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    },
  };
}

const REAL_TABBY_AED = msg(
  {
    From: "marketingomniastore@gmail.com",
    Subject: "Fwd: You're getting a payout from Tabby",
    Date: "Thu, 17 Sep 2026 08:13:35 +0000",
  },
  {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: "" } },
      { mimeType: "image/gif", filename: "blocked.gif", body: { attachmentId: "gif1", size: 43 } },
      {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "2026-09-14 AED settlement report Omniastores UAE Paylink.xlsx",
        body: { attachmentId: "xlsx1", size: 90097 },
      },
    ],
  },
);

test("the settlement workbook is chosen and the decoy gif discarded", () => {
  const picked = pickReportAttachments(REAL_TABBY_AED);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].filename, "2026-09-14 AED settlement report Omniastores UAE Paylink.xlsx");
  assert.equal(picked[0].attachmentId, "xlsx1");
});

test("attachments nested deeper in the MIME tree are still found", () => {
  const nested = msg(
    { Subject: "Tabby Payout Report" },
    {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/related",
          parts: [
            { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "p", size: 1 } },
            {
              mimeType: "application/vnd.ms-excel",
              filename: "report.xls",
              body: { attachmentId: "deep", size: 10 },
            },
          ],
        },
      ],
    },
  );
  const picked = pickReportAttachments(nested);
  assert.deepEqual(picked.map((p) => p.attachmentId), ["deep"]);
});

test("a csv report is accepted, an inline image or pdf is not", () => {
  const m = msg(
    { Subject: "Tabby Payout Report" },
    {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/csv", filename: "settlement.csv", body: { attachmentId: "csv", size: 5 } },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "pdf", size: 5 } },
        { mimeType: "image/jpeg", filename: "banner.jpg", body: { attachmentId: "jpg", size: 5 } },
      ],
    },
  );
  assert.deepEqual(pickReportAttachments(m).map((p) => p.attachmentId), ["csv"]);
});

test("a part with no attachmentId is not downloadable and is ignored", () => {
  const m = msg(
    { Subject: "Tabby Payout Report" },
    {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/csv", filename: "inline.csv", body: { size: 5 } }],
    },
  );
  assert.deepEqual(pickReportAttachments(m), []);
});

test("a forwarded Tabby email still matches, despite From: being the forwarder", () => {
  const source = matchSource(REAL_TABBY_AED);
  assert.ok(source, "a forwarded payout report must still be recognised");
  assert.equal(source.provider, "Tabby");
});

test("the direct (unforwarded) Tabby AED sender matches", () => {
  const direct = msg(
    { From: "Tabby Business <notifications@tabby.ai>", Subject: "You're getting a payout from Tabby" },
    { mimeType: "text/plain" },
  );
  const source = matchSource(direct);
  assert.ok(source);
  assert.equal(source.provider, "Tabby");
  assert.equal(source.currencyHint, "AED");
});

test("the KSA sender and its subject are recognised as the SAR rail", () => {
  const sar = msg(
    { From: "notifications@tabby.sa", Subject: "Tabby Payout Report" },
    { mimeType: "text/plain" },
  );
  const source = matchSource(sar);
  assert.ok(source);
  assert.equal(source.provider, "Tabby");
  assert.equal(source.currencyHint, "SAR");
});

test("unrelated Tabby marketing mail is not treated as a payout report", () => {
  const marketing = msg(
    { From: "discover@mail.tabby.ai", Subject: "Get free transfers abroad 🌍" },
    { mimeType: "text/plain" },
  );
  assert.equal(matchSource(marketing), null);
});

test("an unrelated sender with an unrelated subject does not match", () => {
  const other = msg({ From: "someone@example.com", Subject: "Invoice" }, { mimeType: "text/plain" });
  assert.equal(matchSource(other), null);
});

test("the search query keys on subjects as well as senders, and is newer-bounded", () => {
  const q = buildSearchQuery(30);
  assert.match(q, /has:attachment/);
  assert.match(q, /newer_than:30d/);
  assert.match(q, /notifications@tabby\.ai/);
  assert.match(q, /payout from Tabby/i);
  // Gmail spells OR as {a b}; the braces are what make these alternatives
  // rather than an implicit AND, which would match nothing at all.
  assert.match(q, /^\{.*\}/, "clauses must be wrapped in Gmail's {} OR group");
  assert.match(
    q,
    /subject:"/,
    "sender alone is insufficient — forwarding rewrites From:, so subjects must be ORed in",
  );
});

test("every registered source declares a provider and at least one signal", () => {
  assert.ok(PAYOUT_EMAIL_SOURCES.length > 0);
  for (const s of PAYOUT_EMAIL_SOURCES) {
    assert.ok(s.provider, "source needs a provider");
    assert.ok(s.senders.length > 0 || s.subjects.length > 0, "source needs a sender or subject signal");
  }
});
