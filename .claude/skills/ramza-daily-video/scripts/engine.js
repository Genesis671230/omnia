/* Tiny deterministic motion engine on GSAP. Each video builds one paused
 * master timeline; the renderer seeks it frame by frame, so motion is exact
 * at any frame rate. Sound cues are logged with their times for the mixer. */
window.SFX = [];
const E = {
  tl: gsap.timeline({ paused: true }),
  sfx(type, at, opts = {}) { window.SFX.push({ type, t: at, ...opts }); },
  /** show a scene between start and end (cut or crossfade handled by caller) */
  scene(sel, start, end) {
    const el = document.querySelector(sel);
    E.tl.set(el, { visibility: "visible", zIndex: 1 }, start);
    if (end != null) E.tl.set(el, { visibility: "hidden" }, end);
    return el;
  },
  /** masked line reveal: each .line > span rises into view */
  lines(sel, at, { stagger = 0.09, dur = 0.9, from = 110 } = {}) {
    const spans = document.querySelectorAll(`${sel} .line > span`);
    E.tl.fromTo(spans, { yPercent: from }, { yPercent: 0, duration: dur, ease: "expo.out", stagger }, at);
  },
  linesOut(sel, at, { dur = 0.5 } = {}) {
    const spans = document.querySelectorAll(`${sel} .line > span`);
    E.tl.to(spans, { yPercent: -110, duration: dur, ease: "expo.in", stagger: 0.04 }, at);
  },
  /** wipe a scene in from the right with a clip-path (solid, no fade) */
  wipe(sel, at, dur = 0.9, dir = "left") {
    const el = document.querySelector(sel);
    const from = dir === "left" ? "inset(0 0 0 100%)" : dir === "up" ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)";
    E.tl.set(el, { visibility: "visible", zIndex: 2 }, at);
    E.tl.fromTo(el, { clipPath: from }, { clipPath: "inset(0 0% 0 0%)", duration: dur, ease: "expo.inOut" }, at);
    E.sfx("whoosh", at + 0.05);
  },
  kenBurns(img, at, dur, { from = 1.14, to = 1.0, x = 0, y = 0 } = {}) {
    E.tl.fromTo(img, { scale: from, xPercent: x, yPercent: y }, { scale: to, xPercent: 0, yPercent: 0, duration: dur, ease: "none" }, at);
  },
  count(el, at, to, { dur = 1.4, fmt = (v) => Math.round(v).toLocaleString("en-US"), from = 0 } = {}) {
    const o = { v: from };
    E.tl.fromTo(o, { v: from }, { v: to, duration: dur, ease: "power3.out", onUpdate: () => { el.textContent = fmt(o.v); } }, at);
    E.sfx("tick", at, { dur });
  },
  draw(path, at, dur = 1) {
    const len = path.getTotalLength();
    E.tl.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: dur, ease: "power2.inOut" }, at);
  },
};
window.E = E;
window.__seek = (t) => { E.tl.seek(t, false); };
