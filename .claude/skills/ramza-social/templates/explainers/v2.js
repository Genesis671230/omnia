/* Shared helpers for the v2 reels. Load after engine.js and data.js. Each page defines its scenes
   (.sc, one per segment, in order) and then calls V.boot({ discFrom, light }) after its own timeline. */
(() => {
  const T = window.TIMING, S = T.segs, tl = E.tl, $ = (s) => document.querySelector(s);
  window.__DUR = T.dur;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");
  /** voice time of the n-th token reading `word` in segment i (end = its end time) */
  function w(i, word, n = 0, end = false) {
    let k = 0;
    for (const t of S[i].tokens) if (norm(t.w) === norm(word) && k++ === n) return end ? t.t1 : t.t0;
    console.error("no word", i, word); return S[i].voice;
  }
  const on = (i) => S[i].start, off = (i) => (i + 1 < S.length ? S[i + 1].start : T.dur);
  const pop = (sel, at, { y = 70, s = 1, d = 0.45, sfx = null, x = 0 } = {}) => {
    tl.fromTo(sel, { autoAlpha: 0, y, x, scale: s }, { autoAlpha: 1, y: 0, x: 0, scale: 1, duration: d, ease: "expo.out", immediateRender: false }, at);
    if (sfx) E.sfx(sfx, at);
  };
  const slam = (sel, at, sfx = "impact") => { tl.fromTo(sel, { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 1, scale: 1, duration: 0.22, ease: "power4.out" }, at); if (sfx) E.sfx(sfx, at); };
  const hide = (sel, at, d = 0.2) => tl.to(sel, { autoAlpha: 0, duration: d, ease: "power2.in" }, at);
  const draw = (sel, at, d = 0.5) => { gsap.set(sel, { opacity: 0 }); tl.set(sel, { opacity: 1 }, at); E.draw($(sel), at, d); E.sfx("swish", at); };
  /** zoom punch on a scene's .in: 100 → 112% in 2 frames, settle back */
  const punch = (i, at, amt = 0.1) => {
    const el = document.querySelectorAll(".sc")[i].querySelector(".in");
    tl.to(el, { scale: `+=${amt}`, duration: 0.07, ease: "power2.out" }, at);
    tl.to(el, { scale: `-=${amt}`, duration: 0.5, ease: "power2.out" }, at + 0.07);
  };
  const flash = (at, d = 0.35, sfx = "flash") => { tl.fromTo("#flash", { opacity: 1 }, { opacity: 0, duration: d, ease: "power2.in", immediateRender: false }, at); if (sfx) E.sfx(sfx, at); };
  const tint = (sel, at, op = 0.55, d = 0.4) => tl.to(sel, { opacity: op, duration: d }, at);
  const fmt2 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const typeIn = (el, text, at, d) => {
    const o = { n: 0 };
    tl.fromTo(o, { n: 0 }, { n: text.length, duration: d, ease: "none", onUpdate: () => { el.textContent = text.slice(0, Math.round(o.n)); } }, at);
    E.sfx("typing", at);
  };

  /** every scene: on at its segment, off at the next; photos get Ken Burns 105 → 112 %, others a slow push */
  function scenes(whooshSkip = []) {
    document.querySelectorAll(".sc").forEach((el, i) => {
      E.scene(`#${el.id}`, on(i), off(i));
      const ph = el.querySelector(".ph"), len = off(i) - on(i);
      if (ph) tl.fromTo(ph, { scale: 1.05 }, { scale: 1.12, duration: len, ease: "none" }, on(i));
      tl.fromTo(el.querySelector(".in"), { scale: 1 }, { scale: 1.03, duration: len, ease: "none" }, on(i));
      if (i && !whooshSkip.includes(i)) E.sfx("whoosh", on(i));
    });
  }

  /** word-by-word caption: phrases of ≤ 4 words, the spoken word highlighted */
  function captions({ skip = [], light = [] } = {}) {
    const cap = $("#cap");
    const groups = [];
    S.forEach((s, i) => {
      if (skip.includes(i)) return;
      let g = [];
      s.tokens.forEach((t, k) => {
        g.push(t);
        const brk = g.length >= 4 || /[.,?!:;]$/.test(t.w) || k === s.tokens.length - 1;
        if (brk) { groups.push({ i, toks: g }); g = []; }
      });
    });
    groups.forEach((g, gi) => {
      const from = g.toks[0].t0 - 0.05;
      const next = groups[gi + 1];
      const to = next && next.i === g.i ? next.toks[0].t0 - 0.05 : Math.min(g.toks.at(-1).t1 + 0.6, off(g.i));
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;inset:0;visibility:hidden";
      g.toks.forEach((t) => { const sp = document.createElement("span"); sp.textContent = t.w.replace(/\*/g, ""); box.appendChild(sp); t.el = sp; });
      cap.appendChild(box);
      tl.set(box, { visibility: "visible" }, from);
      tl.set(box, { visibility: "hidden" }, to);
      tl.fromTo(box, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.16, ease: "power2.out" }, from);
      g.toks.forEach((t) => { tl.set(t.el, { attr: { class: "on" } }, t.t0); tl.set(t.el, { attr: { class: "" } }, t.t1); });
      if (light.includes(g.i)) { tl.set(cap, { attr: { class: "lt" } }, from); } else { tl.set(cap, { attr: { class: "" } }, from); }
    });
  }

  function disclaimer(from, light = []) {
    const el = $("#disc");
    el.textContent = window.DISCLAIMER;
    tl.set(el, { visibility: "visible" }, on(from));
    for (let i = from; i < S.length; i++) tl.set(el, { attr: { class: light.includes(i) ? "lt" : "" } }, on(i));
  }

  window.V = { T, S, tl, $, w, on, off, pop, slam, hide, draw, punch, flash, tint, fmt2, typeIn, scenes, captions, disclaimer, D: window.DATA, F: window.FACTS, R: window.RULES };
})();
