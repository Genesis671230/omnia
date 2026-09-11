import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  FileCheck2,
  Landmark,
  LineChart,
  MessagesSquare,
  Receipt,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { ConsultationForm } from "@/components/numio/consultation-form";
import { RiskCheck } from "@/components/numio/risk-check";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "numio — accounting, bookkeeping and tax for the UAE",
  description:
    "Senior accountants and AI that never sleeps. numio keeps your books FTA ready every day: bookkeeping, reconciliation, VAT and Corporate Tax filing, checked three times before a single number reaches the FTA.",
  openGraph: {
    title: "numio — accounting & bookkeeping in the UAE",
    description:
      "Books FTA ready every day. Bookkeeping, reconciliation and VAT plus Corporate Tax filing, run by a dedicated team.",
  },
  robots: { index: true, follow: true },
};

const NAV = [
  { label: "Platform", href: "#platform" },
  { label: "Risk check", href: "#risk-check" },
  { label: "Pricing", href: "#pricing" },
  { label: "How it works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
];

const INTEGRATIONS = [
  "Zoho Books", "Stripe", "Network International", "Amazon", "Noon", "Shopify",
  "WooCommerce", "Telr", "Emirates NBD", "Mashreq", "WPS Payroll", "FTA Portal",
];

const STATS = [
  { value: "AED 1.9B+", label: "Transactions reconciled through numio and Zoho Books" },
  { value: "18,000+", label: "VAT and Corporate Tax returns filed on the FTA portal" },
  { value: "0", label: "FTA penalties on returns we prepared and filed" },
  { value: "4 hrs", label: "Median reply time from your accounting team" },
  { value: "100+", label: "Audits and FTA reviews supported by our tax managers" },
];

const SAFETY = [
  {
    icon: Bot,
    role: "numio engine",
    tag: "AI, continuous",
    body: "Captures every invoice, bill and bank line. Categorises, matches, and runs 20 VAT checks and 7 Corporate Tax checks on each one.",
  },
  {
    icon: FileCheck2,
    role: "Your accountant",
    tag: "Human, dedicated",
    body: "Reconciles the bank, acquiring and gateway statements, clears exceptions, chases missing documents, and closes the month.",
  },
  {
    icon: ShieldCheck,
    role: "Tax manager",
    tag: "Human, reviews and files",
    body: "Reviews the reports, confirms VAT and CT treatment against current FTA rules, and files the return. Signs off every submission.",
  },
];

const INCLUDED = [
  {
    icon: MessagesSquare,
    title: "Dedicated accounting team",
    body: "Your accountant and tax manager sit in one group chat and reply within 4 business hours. No ticket queue, no account-manager relay.",
  },
  {
    icon: Receipt,
    title: "Bookkeeping and reconciliation",
    body: "Every transaction captured, categorised and reconciled. AR and AP tracked, payroll and gratuity calculated, month-end closed on a schedule.",
  },
  {
    icon: Landmark,
    title: "VAT and Corporate Tax",
    body: "Quarterly VAT returns, annual Corporate Tax, FTA liaison and reconciliation, plus an hour of tax advice each month when you need it.",
  },
  {
    icon: LineChart,
    title: "numio app and Zoho Books",
    body: "Upload a document or forward an email, watch its status, ask numio for any financial report and read it in a minute.",
  },
];

const PRICING = [
  {
    name: "Starter",
    volume: "0 to 50 transactions per month",
    body: "Just set up. Not enough volume for a full-time accountant, no room to get CT or VAT wrong. All inclusive, and up to 2x cheaper than a typical outsourced firm.",
  },
  {
    name: "Growth",
    volume: "50 to 500 transactions per month",
    body: "Real volume. We automate the repetitive bookkeeping and filing so your in-house finance hire can focus on FP&A, and your cost per transaction falls as you scale.",
    featured: true,
  },
  {
    name: "Enterprise",
    volume: "500+ transactions per month",
    body: "Multi-entity, tax grouping, free zone versus mainland, transfer pricing. We plug into your existing stack and design the controls and reporting around it.",
  },
];

const STEPS = [
  {
    n: "01",
    when: "Day 1, onboarding",
    title: "We learn how you operate",
    body: "An interview on how you buy, sell and get paid. We design your chart of accounts, set up numio and Zoho Books, and open the group chat. You share KYC and grant access to the accounts you want linked.",
  },
  {
    n: "02",
    when: "Day 2 to 30, data collection",
    title: "We post and reconcile",
    body: "We categorise and reconcile transactions and tag each one for VAT and Corporate Tax. You upload bank statements, payouts and invoices, or connect the accounts once and let them sync.",
  },
  {
    n: "03",
    when: "Day 31, clarification",
    title: "One structured query list",
    body: "We send a single list of anything missing or unclear. You reply with the documents or context, with no back and forth email threads.",
  },
  {
    n: "04",
    when: "Day 45, month-end close",
    title: "Books closed, numbers walked",
    body: "We close the month, share the financial reports, and walk the numbers with you, adjusting anything that needs it before you confirm.",
  },
  {
    n: "05",
    when: "Ongoing, filings",
    title: "VAT quarterly, CT annually",
    body: "We prepare and file VAT returns each quarter and Corporate Tax each year, direct to the FTA. You approve, we submit, you pay the FTA.",
  },
];

const WHY = [
  {
    title: "We save your money",
    points: [
      "Non-compliant invoices flagged early. Each fix saves up to 14% of that cost in VAT and CT you would otherwise lose.",
      "FTA penalties do not happen. Every number passes AI, accountant and tax-manager review.",
      "Clean numbers show where to cut. numio pinpoints where you are overspending.",
    ],
  },
  {
    title: "We save your time",
    points: [
      "We collect the paperwork. Bills and bank statements pulled automatically, invoices raised from a text or voice note.",
      "Any report in a minute. Ask numio for the analysis instead of waiting days.",
      "You stop chasing your accountant. We push every deadline to you and reply within 4 business hours.",
    ],
  },
  {
    title: "We save your sanity",
    points: [
      "Systematic, not last minute. Documents processed as they arrive, no filing scramble.",
      "Clear status. What is done, what is pending, what is due.",
      "Plain language. We explain the finance and genuinely care about the answer.",
    ],
  },
];

const TESTIMONIALS = [
  {
    quote:
      "We came in three quarters behind. numio cleared the backlog, filed the overdue VAT, and now the monthly close just happens. I have not opened a spreadsheet since.",
    name: "Layla Haddad",
    role: "Founder, DTC skincare, Dubai",
  },
  {
    quote:
      "The reverse charge on our Amazon and Shopify fees was wrong for a year with our last firm. numio caught it in week one and fixed the filings. That alone paid for the year.",
    name: "Rohan Mehta",
    role: "CFO, cross-border e-commerce, JAFZA",
  },
  {
    quote:
      "I ask numio for a margin-by-channel P&L on a Sunday night and it is there before I finish my coffee. My old accountant took four days.",
    name: "Daniel Foster",
    role: "MD, logistics and trading, DMCC",
  },
];

const PENALTIES: { group: string; rows: [string, string][] }[] = [
  {
    group: "VAT",
    rows: [
      ["Late registration", "AED 10,000"],
      ["Late return filing", "1,000, then 2,000 on repeat"],
      ["Late payment", "2% then 4%, plus 1% per day, capped 300%"],
      ["Incorrect return", "from AED 500"],
      ["Non-compliant tax invoice", "AED 2,500 per instance"],
    ],
  },
  {
    group: "Corporate Tax",
    rows: [
      ["Late registration", "AED 10,000"],
      ["Late return filing", "500 per month, 1,000 after month 12"],
      ["Late payment", "14% per year, monthly"],
      ["Incorrect return", "from AED 500"],
      ["No records kept", "10,000, then 20,000 on repeat"],
    ],
  },
  {
    group: "AML and other",
    rows: [
      ["No goAML registration", "50,000 to 5,000,000"],
      ["WPS non-compliance", "fines plus permit block"],
      ["Missing audited accounts", "where required by licence"],
      ["Deregistration missed", "AED 1,000 per month, capped"],
    ],
  },
];

const FAQ: [string, string][] = [
  [
    "Do you work with our existing Zoho Books file?",
    "Yes. We are Zoho Books partners and most clients stay on their existing file. We clean up the chart of accounts, fix historical entries where needed, and take over the close. If you are on Xero, QuickBooks or Tally we will tell you honestly whether a move is worth it.",
  ],
  [
    "Who actually files our returns?",
    "Your tax manager. Every VAT and Corporate Tax submission is prepared by the numio engine, reconciled by your accountant, then reviewed and filed on the FTA portal by a qualified tax manager who signs off personally.",
  ],
  [
    "We are behind on filings. Can you help?",
    "That is a common starting point. We scope the backlog on the consultation call, give you a fixed plan to clear it, file the overdue periods, and discuss any voluntary-disclosure or waiver route with you before acting.",
  ],
  [
    "What do you need from us each month?",
    "Bank statements, payout reports and invoices, either uploaded or synced once and left to connect. Then one reply to a single structured query list. No email threads, no chasing.",
  ],
  [
    "Is our data secure?",
    "Access is read-only wherever the platform allows it, granted per account by you, and revocable at any time. The compliance risk check on this page runs entirely in your browser and sends nothing.",
  ],
  [
    "How is pricing set?",
    "By monthly transaction volume, with VAT and Corporate Tax filing included in every tier. No per-return surprises. We confirm the band on the consultation call.",
  ],
];

const H2 = "font-display text-3xl leading-tight tracking-tight text-slate-900 sm:text-[2.6rem]";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-blue-600";

export default function NumioPage() {
  return (
    <div
      className={`${fraunces.variable} ${inter.variable} min-h-screen bg-white font-[family-name:var(--font-inter)] text-slate-700 antialiased`}
    >
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="#top" className="font-display text-xl font-semibold tracking-tight text-slate-900">
            numio
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm text-slate-600 transition-colors hover:text-slate-900">
                {n.label}
              </a>
            ))}
          </nav>
          <a
            href="#consultation"
            className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Book a consultation
          </a>
        </div>
      </header>

      {/* Hero */}
      <section
        id="top"
        className="relative overflow-hidden bg-[#0a1a3c] text-white"
        style={{
          backgroundImage:
            "radial-gradient(60rem 40rem at 15% -10%, #16337a 0%, transparent 55%), radial-gradient(50rem 40rem at 110% 20%, #1e3a8a 0%, transparent 50%)",
        }}
      >
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-blue-100">
              <Sparkles className="size-3.5" />
              Accounting &amp; bookkeeping in the United Arab Emirates
            </p>
            <h1 className="mt-6 font-display text-[2.7rem] font-medium leading-[1.05] tracking-tight sm:text-6xl">
              Senior accountants.
              <br />
              <span className="text-blue-300">AI that never sleeps.</span>
              <br />
              Zero tax surprises.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-blue-100/90">
              numio keeps your books FTA ready every day. Bookkeeping, reconciliation and VAT plus
              Corporate Tax filing, run by a dedicated team and checked three times before a single
              number reaches the FTA.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#consultation"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-blue-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
              >
                Start with a free consultation
                <ArrowRight className="size-4" />
              </a>
              <a
                href="#risk-check"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-white/25 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Check your compliance risk
              </a>
            </div>
            <p className="mt-6 text-xs text-blue-200/80">
              ACCA, CPA and Big 4 backgrounds. Zoho Books partners.
            </p>
          </div>

          {/* Reconciliation card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Month-end reconciliation</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                live
              </span>
            </div>
            <div className="mt-4 space-y-px overflow-hidden rounded-xl border border-white/10 text-sm">
              {[
                ["Stripe payout, Feb", "AED 84,120"],
                ["Network Intl. settlement", "AED 41,660"],
                ["Supplier bill INV-4471", "AED 12,900"],
                ["FX on SAR wire", "AED 318"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between bg-white/[0.04] px-4 py-3">
                  <span className="text-blue-100/85">{k}</span>
                  <span className="font-medium tabular-nums text-white">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-500/15 px-4 py-3">
              <span className="text-sm text-blue-100">Bank lines matched</span>
              <span className="font-display text-lg font-semibold tabular-nums text-white">1,281 / 1,284</span>
            </div>
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Reconciles with the tools you already run on
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {INTEGRATIONS.map((name) => (
              <span key={name} className="text-sm font-medium text-slate-500">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-[#0a1a3c] text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:grid-cols-3 lg:grid-cols-5">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="font-display text-3xl font-semibold text-blue-300">{s.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-blue-100/80">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Safety system */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
        <p className={EYEBROW}>The safety system</p>
        <h2 className={`mt-3 max-w-3xl ${H2}`}>
          Every number is checked three times before it reaches the FTA.
        </h2>
        <p className="mt-4 max-w-2xl text-slate-500">
          One data engine, two people, one sign off. Nothing is filed on a single pair of eyes.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SAFETY.map((s) => (
            <div key={s.role} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <s.icon className="size-6 text-blue-600" />
              <h3 className="mt-4 font-display text-xl text-slate-900">{s.role}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.body}</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-blue-600">{s.tag}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-6 py-4">
          <MessagesSquare className="size-5 shrink-0 text-blue-600" />
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">Your numio pod.</span> Accountant and tax
            manager, in one group chat with you.
          </p>
        </div>
      </section>

      {/* Books in motion */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className={EYEBROW}>Your books, in motion</p>
          <h2 className={`mt-3 max-w-3xl ${H2}`}>You run the shop. numio runs the books.</h2>
          <p className="mt-4 max-w-2xl text-slate-500">
            Retail, e-commerce, trading or services. We post and reconcile as the transactions land,
            so the close is a review, not a scramble.
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              "Marketplace payouts and gateway settlements reconciled line by line",
              "Inventory, landed cost and COGS handled in Zoho Books",
              "Month-end reports on day 45, filings prepared on schedule",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What's included */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
        <p className={EYEBROW}>What&apos;s included</p>
        <h2 className={`mt-3 max-w-3xl ${H2}`}>One package. Accounting and tax, both handled.</h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {INCLUDED.map((c) => (
            <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <c.icon className="size-6 text-blue-600" />
              <h3 className="mt-4 font-display text-xl text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="scroll-mt-20 border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <p className={EYEBROW}>The platform</p>
          <h2 className={`mt-3 max-w-3xl ${H2}`}>
            The AI does the lifting. You see the position, always.
          </h2>
          <p className="mt-4 max-w-2xl text-slate-500">
            No waiting for month-end to know where you stand. numio keeps the numbers live.
          </p>

          <div className="mt-14 space-y-14">
            <PlatformBlock
              icon={ScrollText}
              title="Tax clarity, built in"
              lead="Every transaction is tagged for VAT and Corporate Tax the moment it lands. Automated checks run on every invoice, so nothing non-compliant slips into a filing."
              points={[
                "20 VAT checks and 7 Corporate Tax checks per invoice",
                "Reverse charge on foreign platform fees, handled automatically",
                "Missing or non-compliant invoices flagged the same day",
              ]}
              panel={
                <MockPanel title="Transactions, March 2026" subtitle="VAT and CT">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="pb-2 font-medium">Date</th>
                        <th className="pb-2 font-medium">Description</th>
                        <th className="pb-2 text-right font-medium">AED</th>
                        <th className="pb-2 text-right font-medium">Tag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        ["03-04", "Noon marketplace payout", "18,240", "Std 5%"],
                        ["03-06", "Amazon FBA referral fees", "2,110", "RCM"],
                        ["03-09", "DEWA utilities", "1,430", "Recoverable"],
                        ["03-11", "Client dinner, no TRN", "560", "Blocked"],
                        ["03-14", "Export sale, KSA", "9,800", "Zero-rated"],
                      ].map((r) => (
                        <tr key={r[0]} className="text-slate-600">
                          <td className="py-2 tabular-nums">{r[0]}</td>
                          <td className="py-2">{r[1]}</td>
                          <td className="py-2 text-right tabular-nums">{r[2]}</td>
                          <td className="py-2 text-right">
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                              {r[3]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </MockPanel>
              }
            />

            <PlatformBlock
              icon={Wallet}
              title="Your filing position, live"
              lead="VAT and Corporate Tax balances update continuously as transactions post. Open the app and see exactly what you owe and when it's due."
              points={[
                "Quarterly VAT balance, always current",
                "Corporate Tax estimate with reliefs applied",
                "Deadline countdown pushed to your group chat",
              ]}
              reverse
              panel={
                <MockPanel title="Filing position" subtitle="Q1 2026">
                  <dl className="space-y-3 text-sm">
                    {[
                      ["Output VAT collected", "AED 41,900"],
                      ["Input VAT recovered", "AED 29,420"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="tabular-nums text-slate-700">{v}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-3">
                      <dt className="font-semibold text-slate-900">Net VAT payable</dt>
                      <dd className="font-display text-lg font-semibold tabular-nums text-slate-900">
                        AED 12,480
                      </dd>
                    </div>
                    <div className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2">
                      <dt className="text-emerald-700">Corporate Tax, FY25 estimate</dt>
                      <dd className="font-medium text-emerald-700">AED 0, SBR</dd>
                    </div>
                  </dl>
                </MockPanel>
              }
            />

            <PlatformBlock
              icon={TrendingUp}
              title="Statements in a minute"
              lead="IFRS P&L, Cash Flow and Balance Sheet on demand. Ask numio for any cut, by channel, by entity, by month, and read it now instead of next week."
              points={[
                "P&L, Cash Flow and Balance Sheet, monthly",
                "Revenue by channel, COGS with landed cost",
                "The cash-flow early warning when P&L and bank disagree",
              ]}
              panel={
                <MockPanel title="Profit and Loss" subtitle="Feb 2026">
                  <dl className="space-y-2.5 text-sm">
                    {[
                      ["Revenue, UAE", "312,400"],
                      ["Revenue, export", "88,100"],
                      ["Cost of goods sold", "(214,700)"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="tabular-nums text-slate-700">{v}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-2.5">
                      <dt className="text-slate-600">Gross margin</dt>
                      <dd className="tabular-nums text-slate-800">185,800</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Operating expenses</dt>
                      <dd className="tabular-nums text-slate-700">(121,300)</dd>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2.5">
                      <dt className="font-semibold text-slate-900">Net profit</dt>
                      <dd className="font-display text-lg font-semibold tabular-nums text-slate-900">
                        AED 64,500
                      </dd>
                    </div>
                  </dl>
                </MockPanel>
              }
            />
          </div>
        </div>
      </section>

      {/* Risk check */}
      <section id="risk-check" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className={EYEBROW}>Free compliance risk check</p>
            <h2 className={`mt-3 ${H2}`}>Is your setup exposing you to FTA penalties?</h2>
            <p className="mt-4 text-slate-500">
              Answer a few questions about your business. numio maps each one to a real FTA
              requirement and shows where you are exposed. Takes about two minutes.
            </p>
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-900">
                Most penalties come from gaps a business does not know it has. Late registration,
                missed VAT periods, non-compliant invoices, mixed personal spend. Find your risk
                areas before an audit does.
              </p>
            </div>
          </div>
          <RiskCheck ctaHref="#consultation" />
        </div>
      </section>

      {/* Penalty reference */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className={EYEBROW}>Penalty quick reference</p>
          <h2 className={`mt-3 max-w-3xl ${H2}`}>What the gaps cost, per the FTA schedule.</h2>
          <p className="mt-4 max-w-2xl text-sm text-slate-500">
            Indicative figures from the published Federal Tax Authority penalty schedule. Confirm the
            current position and any waiver route with your tax manager.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PENALTIES.map((p) => (
              <div key={p.group} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-display text-lg text-slate-900">{p.group}</p>
                <dl className="mt-3 divide-y divide-slate-100">
                  {p.rows.map(([k, v]) => (
                    <div key={k} className="py-2.5">
                      <dt className="text-sm text-slate-600">{k}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-slate-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-slate-400">
            A full penalty calculator and a personalised compliance calendar are coming to this page.
            Until then, run the risk check above and we will size your exposure on the call.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-24">
        <p className={EYEBROW}>Who it&apos;s for</p>
        <h2 className={`mt-3 max-w-3xl ${H2}`}>
          Priced to your volume, from your first invoice to multi-entity.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PRICING.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col rounded-2xl border p-6 shadow-sm ${
                p.featured
                  ? "border-blue-600 bg-[#0a1a3c] text-white ring-1 ring-blue-600"
                  : "border-slate-200 bg-white"
              }`}
            >
              <p className={`font-display text-2xl ${p.featured ? "text-white" : "text-slate-900"}`}>
                {p.name}
              </p>
              <p className={`mt-1 text-xs font-semibold uppercase tracking-wide ${p.featured ? "text-blue-300" : "text-blue-600"}`}>
                {p.volume}
              </p>
              <p className={`mt-4 flex-1 text-sm leading-relaxed ${p.featured ? "text-blue-100/85" : "text-slate-500"}`}>
                {p.body}
              </p>
              <a
                href="#consultation"
                className={`mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors ${
                  p.featured
                    ? "bg-blue-500 text-white hover:bg-blue-400"
                    : "border border-slate-300 text-slate-800 hover:bg-slate-50"
                }`}
              >
                Book a consultation
                <ArrowRight className="size-4" />
              </a>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500">
          One price, by transaction volume. VAT and Corporate Tax filing included in every tier.
        </p>
      </section>

      {/* How we work */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <p className={EYEBROW}>How we work</p>
          <h2 className={`mt-3 max-w-3xl ${H2}`}>One clear cycle. Your first 45 days, mapped.</h2>
          <ol className="mt-12 space-y-8">
            {STEPS.map((s) => (
              <li key={s.n} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-8">
                <div className="flex items-baseline gap-3 sm:flex-col sm:items-start">
                  <span className="font-display text-3xl font-semibold text-blue-600/40">{s.n}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {s.when}
                  </span>
                </div>
                <div className="border-l border-slate-200 pl-6 sm:pl-8">
                  <h3 className="font-display text-xl text-slate-900">{s.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why numio */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
        <p className={EYEBROW}>Why numio</p>
        <h2 className={`mt-3 max-w-3xl ${H2}`}>Built to save you more than we cost.</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.title}>
              <h3 className="font-display text-xl text-slate-900">{w.title}</h3>
              <ul className="mt-4 space-y-3">
                {w.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className={EYEBROW}>In their words</p>
          <h2 className={`mt-3 max-w-3xl ${H2}`}>Founders who stopped thinking about their books.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure key={t.name} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-sm text-amber-500">★★★★★</div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA + form */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className={EYEBROW}>Get started</p>
            <h2 className={`mt-3 ${H2}`}>One free consultation. Then your books just run.</h2>
            <p className="mt-4 text-slate-500">
              Tell us how you sell and where things stand. We come back within 4 business hours to
              book a 30-minute call, map your exposure, and quote your volume band.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "A dedicated accountant and tax manager, not a ticket queue",
                "VAT and Corporate Tax filing included, checked three times",
                "Up to 2x cheaper than a typical outsourced firm at low volume",
              ].map((t) => (
                <li key={t} className="flex gap-3 text-sm text-slate-600">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-3 text-xs text-slate-400">
              <Building2 className="size-4" />
              ACCA, CPA and Big 4 backgrounds. Zoho Books partners.
              <Clock className="ml-2 size-4" />
              4-hour median reply
            </div>
          </div>
          <ConsultationForm id="consultation" />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <p className={EYEBROW}>FAQ</p>
          <h2 className={`mt-3 ${H2}`}>The questions we get before the call.</h2>
          <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900">
                  {q}
                  <span className="text-blue-600 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a1a3c] text-blue-100/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg font-semibold text-white">numio</p>
            <p className="mt-1 text-xs">Accounting, bookkeeping and tax for the United Arab Emirates.</p>
          </div>
          <p className="text-xs text-blue-200/60">
            Not a substitute for formal tax advice. Penalty figures are indicative of the FTA
            schedule and change over time.
          </p>
        </div>
      </footer>
    </div>
  );
}

function PlatformBlock({
  icon: Icon,
  title,
  lead,
  points,
  panel,
  reverse,
}: {
  icon: typeof ScrollText;
  title: string;
  lead: string;
  points: string[];
  panel: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className={`grid gap-8 lg:grid-cols-2 lg:items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div>
        <Icon className="size-6 text-blue-600" />
        <h3 className="mt-3 font-display text-2xl text-slate-900">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">{lead}</p>
        <ul className="mt-4 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm text-slate-600">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      {panel}
    </div>
  );
}

function MockPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <span className="text-xs text-slate-400">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}
