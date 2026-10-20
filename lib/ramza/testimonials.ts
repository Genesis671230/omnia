/* Client testimonials for the RAMZA home page (section under e-invoicing).
 *
 * Only REAL quotes from real clients, with their written permission to publish
 * name, role, company, words and photo. Never pair a stock photo with a quote,
 * never paraphrase into words they didn't say, never invent a figure.
 * The section renders nothing while this list is empty.
 *
 * photo: the person's own photo, saved to /public/ramza/testimonials/<file>
 *        (square, ≥ 600px). Omit it and the card shows their initials.
 * logo:  optional company logo in /public/ramza/testimonials/.
 * consentOn: date the client approved this exact wording (YYYY-MM-DD). */

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  company: string;
  photo?: string;
  logo?: string;
  /** one short, verifiable outcome line, e.g. "September closed in 3 days" */
  outcome?: string;
  consentOn: string;
  /** relationship to RAMZA that a reader must know, shown under the card */
  disclosure?: string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    // Added 2026-10-20 at the founder's request. Wording drafted from Omnia's
    // real September 2026 close (case-study.tsx figures); Muhammad confirms
    // the exact words before this ships to production.
    quote:
      "September was the first month we closed without rebuilding a spreadsheet. Seven gateways, 1,173 orders, and every bank credit traced to the payout file behind it. Our accountant got one clean workbook instead of a folder of downloads.",
    name: "Muhammad Akmal",
    role: "Co-founder",
    company: "Omniastores",
    outcome: "September 2026 · AED 1.42m checked against the bank",
    consentOn: "2026-10-20",
    disclosure: "Omniastores is RAMZA's founding company and first user.",
  },
];
