/* Tailwind snippets for the dashboard — one place to read (and change) the look.
 *
 * The look follows the founder's reference shot: a soft grey-blue page, white
 * borderless cards, light-weight big numbers, small grey labels, round icon
 * buttons, underline tabs, one dark pill for the main action.
 *
 * Use them as plain strings:  <div className={ui.card}> … </div>
 * or combine:                 <div className={`${ui.card} xl:col-span-8`}>
 */

export const ui = {
  /** Page background (set once on the app shell). Cool grey so white cards stand out. */
  page: "bg-[#F1F3F7]",

  /** Card: white, no border, soft long shadow, very round corners, roomy padding. */
  card: "rounded-[28px] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-24px_rgba(15,23,42,0.18)]",

  /** Small uppercase grey label at the top of a card ("DAILY SALES"). */
  label: "text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400",

  /** The one headline number on a card — big and light, like "$1,6m" in the reference. */
  bigNumber: "text-[44px] font-light leading-none tracking-[-0.04em] text-slate-900 tabular-nums",

  /** A secondary number (KPI cards, day card). */
  number: "text-[28px] font-light leading-tight tracking-[-0.03em] text-slate-900 tabular-nums",

  /** Grey caption under a number ("Income", "65% of sales"). */
  caption: "text-[13px] text-slate-500",

  /** Faint helper text (hints, footnotes). */
  hint: "text-[12px] text-slate-400",

  /** Round icon button (40px circle) — top bar and card corners. */
  iconButton:
    "inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70 transition hover:bg-slate-900 hover:text-white hover:ring-slate-900 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-700",

  /** The main action: dark pill ("Export", "Open the day"). */
  darkPill:
    "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-slate-900 px-5 text-[13px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-50",

  /** Underline tabs ("Week  Month  Quarter") — text only, active one underlined. */
  tab: "relative pb-1 text-[13px] text-slate-400 transition-colors hover:text-slate-700",
  tabActive: "text-slate-900",

  /** Table header cell and body cell. */
  th: "px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400",
  td: "px-3 py-3 border-t border-slate-100 tabular-nums",
} as const;
