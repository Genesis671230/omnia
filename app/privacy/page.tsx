import type { Metadata } from "next";
import { RamzaShell } from "@/components/ramza/ramza-shell";
import { Wordmark } from "@/components/ramza/wordmark";
import { PRIVACY_INTRO } from "@/lib/ramza/copy";

export const metadata: Metadata = {
  title: "Privacy — RAMZA",
  description: "How RAMZA handles the files and data you share for a payout audit.",
  robots: { index: false, follow: true },
};

const SECTIONS: { h: string; body: string }[] = [
  {
    h: "What we collect",
    body: "The contact details you submit in the audit form (name, WhatsApp number, work email, store URL), the payout files and bank statement you choose to send us, and standard analytics on how you reached this page.",
  },
  {
    h: "Why we hold it",
    body: "Your files are used only to reconcile your account and produce the audit report you asked for. Contact details are used to send the report and arrange a call.",
  },
  {
    h: "Retention",
    body: "Audit files are held only while the audit is open and for 12 months afterwards so the reconciliation can be re-checked, then deleted. Contact details are kept until you ask us to remove them. You can request deletion of everything we hold at any time and we action it within 30 days.",
  },
  {
    h: "Sharing",
    body: "We do not sell your data. We sign an NDA before you send any files. Analytics data may be shared with Meta for ad measurement in a hashed form.",
  },
  {
    h: "Your choices",
    body: `Ask us to delete your data at any time by emailing the address in the footer.`,
  },
];

export default function PrivacyPage() {
  return (
    <RamzaShell>
      <div className="mx-auto max-w-3xl px-5 py-16">
        <a href="/ramza" aria-label="RAMZA home">
          <Wordmark />
        </a>
        <h1 className="r-h1 mt-10">Privacy</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--ink-60)" }}>
          {PRIVACY_INTRO}
        </p>

        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
                {s.h}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-60)" }}>
                {s.body}
              </p>
            </section>
          ))}
        </div>

        <p className="mt-12 text-xs" style={{ color: "var(--ink-60)" }}>
          <a href="/ramza" className="hover:underline">
            Back to RAMZA
          </a>
        </p>
      </div>
    </RamzaShell>
  );
}
