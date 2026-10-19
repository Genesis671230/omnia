/* Reel scripts. Every number and date comes from config/rules.json (passed in as R)
 * or facts.json (F). `say` is what Noor speaks (numbers written out for the TTS),
 * `cap` is the on-screen phrase(s), `visual` is "talk" (Noor on camera) or a path
 * relative to the posts output dir / repo public dir. Talk segments must be ≤ 8.5 s
 * of speech: LeapTalk renders at most 9 s per take. */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(n) {
  if (n === 0) return "zero";
  const parts = [];
  for (const [v, w] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= v) { parts.push(words(Math.floor(n / v)) + " " + w); n %= v; }
  }
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + " hundred"); n %= 100; }
  if (n > 0) parts.push(n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""));
  return parts.join(" ");
}
const ORD = { 1: "first", 2: "second", 3: "third", 21: "twenty-first", 22: "twenty-second", 23: "twenty-third", 31: "thirty-first" };
const ordinal = (d) => ORD[d] ?? (d < 20 ? words(d) + "th" : words(d).replace(/y$/, "ie") + "th").replace("fiveth", "fifth").replace("eightth", "eighth").replace("nineth", "ninth").replace("twelveth", "twelfth");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const sayDate = (iso) => { const [, m, d] = iso.split("-").map(Number); return `the ${ordinal(d)} of ${MONTHS[m - 1]}`; };
const showDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const sayAED = (n) => `${words(n)} dirhams`;
const aed = (n) => "AED " + Number(n).toLocaleString("en-US");
const aedM = (n) => "AED " + String(+(n / 1e6).toFixed(2)) + "m";

export { words, ordinal, sayDate, showDate, sayAED, aed, aedM };

export function reels(R, F) {
  const E = R.einvoicing, P = E.penalties, CT = R.ct, lf = CT.late_filing_penalty;
  return [
    {
      id: "noor-einvoicing-save-5000",
      title: `How to save ${aed(P.asp_late_aed_per_month)} a month`,
      segments: [
        { visual: "talk", say: `If your UAE business turns over ${words(E.large.revenue_gte_aed / 1e6)} million dirhams or more, one date can save you ${sayAED(P.asp_late_aed_per_month)} a month.`,
          cap: [`Revenue ${aedM(E.large.revenue_gte_aed)}+?`, `Save ${aed(P.asp_late_aed_per_month)} a month`] },
        { visual: "posts/01-einvoicing-provider-deadline/slide-1.png", say: `By ${sayDate(E.large.asp_by)}, you need to appoint an accredited e-invoicing provider.`,
          cap: [`Appoint a provider by ${showDate(E.large.asp_by)}`] },
        { visual: "posts/01-einvoicing-provider-deadline/slide-2.png", say: `Miss it, and it's ${sayAED(P.asp_late_aed_per_month)} for every month, or part of a month, you're late.`,
          cap: [`${aed(P.asp_late_aed_per_month)} every month late`] },
        { visual: "talk", say: `The fix is simple. Map where your invoices are created, and sign an accredited provider before the deadline.`,
          cap: ["Map your invoice sources", "Sign before the deadline"] },
        { visual: "posts/01-einvoicing-provider-deadline/slide-4.png", say: `Then send one real test invoice, end to end, before go-live on ${sayDate(E.large.go_live)}.`,
          cap: [`Test before ${showDate(E.large.go_live)}`] },
        { visual: "talk", say: `Comment READY, and we'll send you the free readiness checklist.`,
          cap: ["Comment READY"] },
      ],
      disclaimer: `AI presenter. RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Source: ${P.legal_basis}.`,
    },
    {
      id: "noor-ct-late-filing",
      title: `Every month late adds ${aed(lf.months_1_12_aed)}`,
      segments: [
        { visual: "talk", say: `UAE businesses with a December year end: the corporate tax return was due on ${sayDate(CT.deadlines[0].due)}.`,
          cap: ["Dec 2025 year end?", `Return was due ${showDate(CT.deadlines[0].due)}`] },
        { visual: "posts/03-ct-late-filing-meter/slide-2.png", say: `If it's still unfiled, the penalty is ${sayAED(lf.months_1_12_aed)} for every month or part of a month, and ${sayAED(lf.month_13_plus_aed)} from month thirteen.`,
          cap: [`${aed(lf.months_1_12_aed)} a month`, `${aed(lf.month_13_plus_aed)} from month 13`] },
        { visual: "talk", say: `So the real saving is time. Every month you file sooner is ${sayAED(lf.months_1_12_aed)} you keep.`,
          cap: [`File sooner, keep ${aed(lf.months_1_12_aed)} a month`] },
        { visual: "posts/03-ct-late-filing-meter/slide-4.png", say: `RAMZA closes your books, and our licensed partner files the return, for one fixed fee.`,
          cap: [`${aed(R.pricing.one_off.late_filing_rescue_aed)} one-off`] },
        { visual: "talk", say: `Comment RESCUE, and we'll tell you what your return needs.`, cap: ["Comment RESCUE"] },
      ],
      disclaimer: `AI presenter. Penalties are estimates from ${lf.legal_basis}. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}.`,
    },
  ];
}
