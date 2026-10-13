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
};

export const TESTIMONIALS: Testimonial[] = [];
