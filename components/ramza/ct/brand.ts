/* RAMZA site — Tailwind snippets.
 *
 * Brand (2026-10-14 rework): high contrast — white canvas, deep navy for the
 * hero, dark islands and footer, ONE indigo accent, mint for "ready / done".
 * (The earlier warm off-white canvas #FAF9F6 was dropped: it read as generic.)
 *   canvas    #FFFFFF  page ground
 *   ink       #14131C  headings and body ink
 *   navy      #0B1533  dark "island" panels, dark buttons
 *   night     #050B1F  home hero + footer
 *   royal     #4F35E8  primary buttons, links, the one highlight per section
 *   lilac     #B9AEFF  highlight on dark only
 *   mint      #5FE0A8  ready / done on dark
 *   mist      #EEF1F7  chips, quiet fills; hairlines #E3E7F0
 * Display type: Urbanist (--font-display); body: IBM Plex Sans.
 * Photos: real Dubai (Business Bay, DIFC) and office photography, rounded
 * rectangles. Dark panels are inset islands inside the container.
 *
 * Use as plain strings: <section className={ct.sectionLight}> … */

export const ct = {
  /* ── surfaces ── */
  sectionDark: "relative overflow-x-clip bg-[#050B1F] text-white",
  sectionLight: "relative overflow-x-clip text-[#14131C]",
  sectionIce: "relative overflow-x-clip text-[#14131C]",
  /** dark inset panel: use inside ct.container */
  island: "relative overflow-hidden rounded-[36px] bg-[#0B1533] text-white",
  container: "relative mx-auto w-full max-w-[1200px] px-5 sm:px-8",
  card: "rounded-[28px] bg-white p-6 ring-1 ring-[#E3E7F0] shadow-[0_1px_2px_rgba(20,19,28,0.04),0_24px_60px_-40px_rgba(20,19,28,0.25)] sm:p-8",
  glass: "rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl",

  /* ── type ── */
  eyebrow: "inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#4F35E8]",
  eyebrowDark: "inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]",
  h1: "font-[family-name:var(--font-display)] text-[34px] font-medium leading-[1.08] tracking-[-0.03em] sm:text-[44px] lg:text-[48px]",
  h2: "font-[family-name:var(--font-display)] text-[28px] font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[36px]",
  h3: "font-[family-name:var(--font-display)] text-[19px] font-medium tracking-[-0.01em]",
  lead: "text-[17px] leading-relaxed text-[#55525E] sm:text-[18px]",
  leadDark: "text-[17px] leading-relaxed text-[#B8B6C0] sm:text-[18px]",
  body: "text-[15px] leading-relaxed text-[#55525E]",

  /* ── actions ── */
  btnPrimary:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#4F35E8] px-6 text-[15px] font-medium text-white shadow-[0_8px_24px_-12px_rgba(79,53,232,0.6)] transition hover:bg-[#3F26D6] disabled:opacity-60",
  btnWhite:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#14131C] transition hover:bg-[#EEF1F7]",
  btnGhostDark:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium text-white ring-1 ring-white/25 transition hover:bg-white/10",
  link: "font-medium text-[#14131C] underline decoration-[#B3A6FF] decoration-2 underline-offset-4 hover:decoration-[#4F35E8]",

  /* ── form ── */
  label: "mb-1.5 block text-[13px] font-medium text-[#14131C]",
  input:
    "h-12 w-full rounded-2xl border border-[#DDE2EC] bg-white px-4 text-[15px] text-[#14131C] placeholder:text-[#A19EA6] transition focus:border-[#14131C] focus:outline-none focus:ring-4 focus:ring-[#14131C]/10",
  error: "mt-1 text-[12.5px] text-[#C2334D]",
} as const;
