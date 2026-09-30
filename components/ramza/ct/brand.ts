/* RAMZA Corporate Tax site — Tailwind snippets.
 *
 * Brand: deep navy + royal blue, white cards, one light "ice" tint.
 *   navy-950  #050D2B  darkest band (hero, footer)
 *   navy-900  #0A1A4A  dark panels
 *   royal     #2347D9  primary buttons, links, rings
 *   bright    #4C7BFF  highlights on dark
 *   ice       #EEF3FF  light section tint
 *   paper     #F7F9FE  page ground
 *
 * Use as plain strings: <section className={ct.sectionLight}> … */

export const ct = {
  /* ── surfaces ── */
  sectionDark: "relative overflow-x-clip bg-[#050D2B] text-white",
  sectionLight: "relative overflow-x-clip bg-[#F7F9FE] text-[#0A1A4A]",
  sectionIce: "relative overflow-x-clip bg-[#EEF3FF] text-[#0A1A4A]",
  container: "relative mx-auto w-full max-w-[1200px] px-5 sm:px-8",
  card: "rounded-[28px] bg-white p-6 shadow-[0_1px_2px_rgba(10,26,74,0.05),0_24px_60px_-32px_rgba(10,26,74,0.35)] sm:p-8",
  glass: "rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl",

  /* ── type ── */
  eyebrow: "inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#2347D9]",
  eyebrowDark: "inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#8FB0FF]",
  h1: "text-[40px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[56px] lg:text-[64px]",
  h2: "text-[30px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[40px]",
  h3: "text-[19px] font-medium tracking-[-0.01em]",
  lead: "text-[17px] leading-relaxed text-[#4A5680] sm:text-[18px]",
  leadDark: "text-[17px] leading-relaxed text-[#B9C6EE] sm:text-[18px]",
  body: "text-[15px] leading-relaxed text-[#4A5680]",

  /* ── actions ── */
  btnPrimary:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#2347D9] px-6 text-[15px] font-medium text-white shadow-[0_12px_30px_-12px_rgba(35,71,217,0.8)] transition hover:bg-[#1B38B3] disabled:opacity-60",
  btnWhite:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#0A1A4A] transition hover:bg-[#EEF3FF]",
  btnGhostDark:
    "inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium text-white ring-1 ring-white/25 transition hover:bg-white/10",
  link: "font-medium text-[#2347D9] underline-offset-4 hover:underline",

  /* ── form ── */
  label: "mb-1.5 block text-[13px] font-medium text-[#0A1A4A]",
  input:
    "h-12 w-full rounded-2xl border border-[#D9E1F5] bg-white px-4 text-[15px] text-[#0A1A4A] placeholder:text-[#9AA6C8] transition focus:border-[#2347D9] focus:outline-none focus:ring-4 focus:ring-[#2347D9]/15",
  error: "mt-1 text-[12.5px] text-[#C2334D]",
} as const;
