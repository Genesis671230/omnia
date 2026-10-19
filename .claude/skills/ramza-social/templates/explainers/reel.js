/* Reel helpers on top of engine.js (E). Reads window.TIMING from data.js:
 *   segs[i] = { start, voice, end, dark, tokens:[{ w, t0, t1, hl }] }
 * Each .scene in DOM order belongs to segment i. RL.build() schedules scene wipes, the
 * progress bars, the chrome colour, word-by-word captions and the closing disclaimer.
 * Scenes animate themselves with RL.at(i, dt) (seconds after the voice starts) or
 * RL.w(i, "word") (when that word is spoken). */
const RL = {
  T: window.TIMING,
  seg: (i) => window.TIMING.segs[i],
  at: (i, dt = 0) => window.TIMING.segs[i].voice + dt,
  w(i, text, which = "t0") {
    const k = window.TIMING.segs[i].tokens.find((x) => x.w.toLowerCase().includes(text.toLowerCase()));
    if (!k) { console.error(`RL.w: "${text}" not in segment ${i}`); return RL.at(i); }
    return k[which];
  },
  chunks(tokens) {
    const out = []; let cur = [];
    for (const k of tokens) {
      const chars = cur.reduce((a, x) => a + x.w.length + 1, 0);
      if (cur.length && (cur.length >= 3 || chars + k.w.length > 17 || /[.,?!:;]$/.test(cur[cur.length - 1].w))) { out.push(cur); cur = []; }
      cur.push(k);
    }
    if (cur.length) out.push(cur);
    return out;
  },
  build() {
    const { tl } = E, T = RL.T, segs = T.segs;
    const scenes = [...document.querySelectorAll(".scene")];
    const chrome = document.createElement("div");
    chrome.id = "chrome";
    /* The agent logo (eyes blink and turn into "=", agent.css) + wordmark, one element that
       recolours with the scene. Sits inside Instagram's 4:5 feed crop (y 285–1635). */
    chrome.innerHTML = `<div class="lock" id="lock"><svg viewBox="20 20 160 160" class="ra-motion"><rect x="20" y="20" width="160" height="160" rx="54" fill="#3A55E6"/><rect class="ra-eye ra-idle-l" x="68" y="72" width="22" height="50" rx="11" fill="#fff"/><rect class="ra-eye ra-idle-r" x="110" y="72" width="22" height="50" rx="11" fill="#fff"/></svg><span>ramza</span></div>
      <div id="bars">${segs.map(() => "<i><b></b></i>").join("")}</div>`;
    const caps = document.createElement("div"); caps.id = "caps";
    const disc = document.createElement("div"); disc.id = "disc"; disc.textContent = window.DISCLAIMER || "";
    const stage = document.querySelector(".stage");
    stage.append(chrome, caps, disc);
    const bars = chrome.querySelectorAll("#bars b");
    segs.forEach((s, i) => {
      const sc = scenes[i];
      if (!sc) return console.error("no scene for segment", i);
      if (i === 0) tl.set(sc, { visibility: "visible", zIndex: 2 }, 0);
      else {
        tl.set(sc, { visibility: "visible", zIndex: 2 }, s.start);
        tl.fromTo(sc, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: 0.55, ease: "expo.inOut" }, s.start);
        tl.set(scenes[i - 1], { visibility: "hidden" }, s.start + 0.6);
        E.sfx("swish", s.start);
      }
      tl.set(chrome, { attr: { class: s.dark ? "dark" : "" } }, s.start + 0.25);
      tl.fromTo(bars[i], { scaleX: 0 }, { scaleX: 1, duration: s.end - s.start, ease: "none" }, s.start);
      RL.chunks(s.tokens).forEach((ch, j, all) => {
        const el = document.createElement("div");
        el.className = "chunk" + (s.dark ? " dark" : "");
        el.innerHTML = ch.map((k) => `<span class="${k.hl ? "hl" : ""}">${k.w}</span>`).join("");
        caps.append(el);
        const from = ch[0].t0 - 0.06;
        const to = j + 1 < all.length ? all[j + 1][0].t0 - 0.06 : Math.min(s.end - 0.05, ch[ch.length - 1].t1 + 0.9);
        tl.set(el, { visibility: "visible" }, from);
        tl.set(el, { visibility: "hidden" }, to);
        el.querySelectorAll("span").forEach((sp, m) => {
          tl.fromTo(sp, { opacity: 0, y: 26, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.16, ease: "back.out(2)" }, ch[m].t0 - 0.04);
          if (ch[m].hl) tl.fromTo(sp, { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" }, ch[m].t0 + 0.1);
        });
      });
    });
    const last = segs[segs.length - 1];
    if (last.dark) disc.classList.add("dark");
    tl.to(disc, { opacity: 1, duration: 0.4 }, last.voice);
    tl.set({}, {}, T.dur);
    window.__DUR = T.dur;
  },
};
window.RL = RL;
