/* Reel kit helpers (2026-10-20). Markup for the RAMZA agent (the logo as a character) and
 * small UI pieces; the scenes animate them with GSAP via E.tl, and the agent's own CSS
 * keyframes (agent.css) are clock-driven by engine.js __seek through data-t0. */
const KIT = {
  BLUE: "#3A55E6",
  /* the 200-unit head; l/r are eye classes from agent.css */
  head: (l = "ra-eye ra-idle-l", r = "ra-eye ra-idle-r", fill = "#3A55E6") =>
    `<rect x="20" y="20" width="160" height="160" rx="54" fill="${fill}"/>` +
    `<rect class="${l}" x="68" y="72" width="22" height="50" rx="11" fill="#fff"/>` +
    `<rect class="${r}" x="110" y="72" width="22" height="50" rx="11" fill="#fff"/>`,
  /* small static/idle mark (notification icon, app header, avatar) */
  mark: (idle = true) => `<svg viewBox="20 20 160 160">${KIT.head(idle ? "ra-eye ra-idle-l" : "", idle ? "ra-eye ra-idle-r" : "")}</svg>`,
  /* the agent standing on its shadow; animate it in with KIT.dropIn. Eyes idle from data-t0
     (blink, glance, then "=" at 3.5–5 s after t0). */
  body: (shadow = "#07090D") => `<svg viewBox="0 -40 200 250" overflow="visible" class="ra-motion">
    <ellipse class="ag-sh" cx="100" cy="196" rx="62" ry="7" fill="${shadow}" fill-opacity=".14"/>
    <g class="ag-hd">${KIT.head()}</g></svg>`,
  /* spring drop, played once with GSAP (the CSS version loops and flies away) */
  dropIn(wrap, t) {
    const { tl } = E, hd = wrap.querySelector(".ag-hd"), sh = wrap.querySelector(".ag-sh");
    KIT.startAt(wrap, t + 0.5);
    tl.set(hd, { transformOrigin: "50% 100%", transformBox: "fill-box" }, 0);
    tl.fromTo(hd, { y: -520, scaleX: 1, scaleY: 1, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: "power2.in" }, t);
    tl.to(hd, { scaleX: 1.18, scaleY: 0.8, duration: 0.08, ease: "power1.out" }, t + 0.42);
    tl.to(hd, { y: -40, scaleX: 0.94, scaleY: 1.07, duration: 0.2, ease: "power2.out" }, t + 0.5);
    tl.to(hd, { y: 0, scaleX: 1, scaleY: 1, duration: 0.3, ease: "bounce.out" }, t + 0.7);
    tl.fromTo(sh, { scaleX: 0.3, opacity: 0, transformOrigin: "50% 50%", transformBox: "fill-box" }, { scaleX: 1, opacity: 1, duration: 0.45 }, t);
    E.sfx("impact", t + 0.42);
  },
  /* payout feed: Stripe/Tabby/Tamara/COD chips fly in, eyes track, then "=" (8 s) */
  feed: (shadow = "#07090D") => `<svg viewBox="-160 -20 520 230" overflow="visible" class="ra-motion">
    <ellipse cx="100" cy="196" rx="62" ry="7" fill="${shadow}" fill-opacity=".12"/>
    ${[["l1", -150, 48, "#7B5CFF", "Stripe", "#fff"], ["r1", 212, 124, "#2CD9A5", "Tabby", "#07090D"], ["l2", -150, 124, "#FF4D8D", "Tamara", "#fff"], ["r2", 212, 48, "#FFB547", "COD", "#07090D"]]
      .map(([c, x, y, f, t, ink]) => `<g class="ra-ch ra-ch-${c}"><rect x="${x}" y="${y}" width="78" height="28" rx="14" fill="${f}"/><text x="${x + 39}" y="${y + 19}" text-anchor="middle" font-size="13" font-weight="600" fill="${ink}" font-family="IBM Plex Sans">${t}</text></g>`).join("")}
    <g class="ra-f-head">${KIT.head("ra-f-l", "ra-f-r")}</g></svg>`,
  /* sticker: wobbles, winks, pops a "books = bank" tag (6 s) */
  sticker: (drop = "#07090D") => `<svg viewBox="-40 -30 290 260" overflow="visible" class="ra-motion">
    <path class="ra-st-spk" d="M-12,6 C-10,18 -6,22 6,24 C-6,26 -10,30 -12,42 C-14,30 -18,26 -30,24 C-18,22 -14,18 -12,6 Z" fill="#fff"/>
    <path class="ra-st-spk ra-st-spk2" d="M212,150 C213.5,159 216.5,162 225,163.5 C216.5,165 213.5,168 212,177 C210.5,168 207.5,165 199,163.5 C207.5,162 210.5,159 212,150 Z" fill="#FF6A1A"/>
    <g class="ra-st-wob"><rect x="20" y="20" width="160" height="160" rx="54" fill="${drop}" transform="translate(10,10)"/><rect x="11" y="11" width="178" height="178" rx="62" fill="#fff"/>${KIT.head("ra-eye ra-st-l", "ra-eye ra-st-r")}</g>
    <g class="ra-st-pill"><rect x="104" y="166" width="120" height="36" rx="18" fill="#fff" stroke="#FF6A1A" stroke-width="3"/><text x="164" y="189.5" text-anchor="middle" font-size="16" font-weight="700" fill="#07090D" font-family="Urbanist">books = bank</text></g></svg>`,
  tick: `<svg viewBox="0 0 60 60"><path class="tk" d="M12 31 L25 44 L48 17" stroke="#1F7A4D" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  /* start an element's CSS keyframes at time t (seconds) */
  startAt(el, t) { (typeof el === "string" ? document.querySelector(el) : el).dataset.t0 = t; },
  /* checklist row reveal + tick draw at time t */
  checkRow(row, t) {
    const { tl } = E;
    tl.fromTo(row, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, t - 0.35);
    const p = row.querySelector(".tk");
    if (p) E.draw(p, t, 0.35);
    tl.to(row.querySelector(".bx"), { borderColor: "#1F7A4D", duration: 0.2 }, t);
    E.sfx("pop", t);
  },
  /* camera: crash-zoom an element (scale from big to 1, or 1 to big) */
  crash(el, t, from = 1.25, dur = 0.5) {
    E.tl.fromTo(el, { scale: from }, { scale: 1, duration: dur, ease: "expo.out" }, t);
  },
  punch(el, t, s = 1.06) {
    E.tl.fromTo(el, { scale: 1 }, { scale: s, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" }, t);
  },
};
window.KIT = KIT;
