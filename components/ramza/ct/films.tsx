"use client";

/* Video on the RAMZA home (2026-10-20).
 *
 *   <BgVideo>       muted looping background clip; plays only while on screen,
 *                   rests on its poster under prefers-reduced-motion.
 *   <StickyFilm>    a tall section whose video stays pinned while three lines
 *                   scroll over it; the clip changes with the line in view.
 *   <NoorFilms>     the Noor films: "The Interview" large, three Bilal & Noor
 *                   discussions beside it. Tap to play with sound, one at a time.
 *
 * Files in public/ramza/video, re-encoded from the ramza-social renders (720p
 * reels, 1280px background loops cut from the Higgsfield office shots). Every
 * person in them is AI-generated, and each player says so. */

import { Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RamzaAgentMark } from "@/components/ramza/brand/agent";
import { track } from "@/lib/ramza/track";
import { WatchFilmButton } from "./hero-video";

const V = "/ramza/video";

function useOnScreen<T extends Element>(margin = "200px") {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, on] as const;
}

export function BgVideo({ name, className = "", position = "50% 50%" }: { name: string; className?: string; position?: string }) {
  const [ref, on] = useOnScreen<HTMLVideoElement>();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (on && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) v.play().catch(() => {});
    else v.pause();
  }, [on, ref]);
  return (
    <video
      ref={ref}
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
      style={{ objectPosition: position }}
      src={`${V}/${name}.mp4`}
      poster={`${V}/${name}.jpg`}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
    />
  );
}

const SCENES = [
  {
    clip: "bg-night-office",
    eyebrow: "Month end, 11:40 pm",
    title: "Seven payouts landed today. Nobody can say which orders they paid for.",
    body: "Statements, gateway reports and a spreadsheet you rebuild every month, usually by the owner, usually at night.",
  },
  {
    clip: "bg-meeting-room",
    eyebrow: "RAMZA",
    title: "RAMZA runs your operations.",
    body: "Every payout matched to the bank, every invoice issued and chased, your books made e-invoicing ready.",
  },
  {
    clip: "bg-lights-off",
    eyebrow: "Your accountant",
    title: "Your accountant runs your finance.",
    body: "VAT, Corporate Tax and the sign-off stay with them, on clean numbers. You leave on time.",
  },
] as const;

export function StickyFilm() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setActive(Number((e.target as HTMLElement).dataset.i))),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="What RAMZA takes off your desk" className="relative bg-[#050B1F] text-white">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {SCENES.map((s, i) => (
          <div key={s.clip} className="absolute inset-0 transition-opacity duration-700" style={{ opacity: active === i ? 1 : 0 }}>
            <BgVideo name={s.clip} />
          </div>
        ))}
        <div className="absolute inset-0 bg-[#050B1F]/60" />
        <div className="absolute bottom-5 right-5 text-[11px] text-white/60">AI-generated scenes</div>
        <div className="absolute left-1/2 top-24 flex -translate-x-1/2 gap-2" aria-hidden>
          {SCENES.map((s, i) => <span key={s.clip} className={`h-1 w-8 rounded-full transition ${active === i ? "bg-white" : "bg-white/25"}`} />)}
        </div>
      </div>
      <div className="relative -mt-[100svh]">
        {SCENES.map((s, i) => (
          <div key={s.clip} ref={(el) => { refs.current[i] = el; }} data-i={i} className="flex min-h-[100svh] items-center">
            <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
              <div className="max-w-[640px]">
                <div className="flex items-center gap-3">
                  {i > 0 && <RamzaAgentMark size={28} tone="dark" />}
                  <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#C4CAD9]">{s.eyebrow}</span>
                </div>
                <h2 className="mt-4 font-[family-name:var(--font-display)] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[52px]">{s.title}</h2>
                <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-[#D5D9E4] sm:text-[19px]">{s.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const FILMS = [
  { id: "noor-interview", title: "The Interview", sub: "Noor hires RAMZA as Head of Operations", len: "0:43" },
  { id: "noor-bank-says-paid", title: "The bank says paid", sub: "Bilal & Noor on the Zoho gap", len: "0:50" },
  { id: "noor-three-weeks", title: "Books close in 3 weeks", sub: "What's really blocking month end", len: "0:46" },
  { id: "noor-pdf-penalty", title: "Invoices as PDFs", sub: "What e-invoicing changes", len: "0:45" },
] as const;

function Film({ f, big, playing, onPlay }: { f: (typeof FILMS)[number]; big?: boolean; playing: boolean; onPlay: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) { v.muted = false; setMuted(false); v.play().catch(() => {}); }
    else { v.pause(); }
  }, [playing]);
  return (
    <div className={`group relative overflow-hidden rounded-[8px] bg-black ring-1 ${big ? "ring-[#4D66F0]" : "ring-white/10"}`}>
      <video
        ref={ref}
        className="block aspect-[9/16] h-full w-full object-cover"
        src={`${V}/${f.id}.mp4`}
        poster={`${V}/${f.id}.jpg`}
        playsInline
        preload="none"
        muted={muted}
        onEnded={() => ref.current && (ref.current.currentTime = 0)}
      />
      {!playing && (
        <button
          type="button"
          onClick={() => { onPlay(); track("ViewContent", { placement: "noor-films", content: f.id }); }}
          className="absolute inset-0 flex flex-col justify-end bg-black/25 p-4 text-left transition hover:bg-black/10"
          aria-label={`Play ${f.title}`}
        >
          <span className={`mb-auto ml-auto flex items-center justify-center rounded-full bg-white text-[#0B1533] ${big ? "h-14 w-14" : "h-10 w-10"}`}>
            <Play size={big ? 20 : 15} className="ml-0.5" fill="currentColor" />
          </span>
          <span className="rounded-[6px] bg-black/70 p-3">
            <b className={`block font-semibold text-white ${big ? "text-[20px]" : "text-[14px]"}`}>{f.title}</b>
            <span className="text-[12.5px] text-[#C4CAD9]">{f.sub} · {f.len}</span>
          </span>
        </button>
      )}
      {playing && (
        <button type="button" onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white" aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      )}
    </div>
  );
}

export function NoorFilms() {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <section id="films" className="relative scroll-mt-24 overflow-hidden bg-[#050B1F] py-20 text-white sm:py-24">
      <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-center gap-3">
              <RamzaAgentMark size={30} tone="dark" />
              <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#C4CAD9]">Watch · under a minute each</span>
            </div>
            <h2 className="mt-4 max-w-[720px] font-[family-name:var(--font-display)] text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]">
              Meet Noor. She&apos;ll show you what RAMZA does in under a minute.
            </h2>
            <p className="mt-4 max-w-[620px] text-[17px] leading-relaxed text-[#C4CAD9]">
              Short films about the month-end problems owners actually have: payouts nobody can explain, books that close weeks late,
              and invoices that won&apos;t pass e-invoicing.
            </p>
          </div>
          <p className="max-w-[300px] text-[12.5px] text-[#8D95A8]">Noor is RAMZA&apos;s AI presenter. The people and offices in these films are AI-generated.</p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FILMS.map((f, i) => (
            <Film key={f.id} f={f} big={i === 0} playing={playing === f.id} onPlay={() => setPlaying(f.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* Full-bleed band for the RAMZA intro film: the muted loop behind one line,
   the full cut with sound in a lightbox. */
export function FilmBand() {
  return (
    <section aria-label="The RAMZA film" className="relative flex min-h-[70svh] items-center overflow-hidden bg-[#050B1F] text-white">
      <BgVideo name="intro-loop" />
      <div className="absolute inset-0 bg-[#050B1F]/55" />
      <div className="relative mx-auto w-full max-w-[1200px] px-5 py-24 sm:px-8">
        <RamzaAgentMark size={44} tone="dark" />
        <h2 className="mt-5 max-w-[720px] font-[family-name:var(--font-display)] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[52px]">
          Bookkeeping hasn&apos;t changed in fifty years. The month end finally can.
        </h2>
        <WatchFilmButton className="mt-8" />
      </div>
    </section>
  );
}
