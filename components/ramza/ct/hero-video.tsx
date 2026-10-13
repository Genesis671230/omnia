"use client";

/* The RAMZA intro film in the hero.
 *
 *   <HeroVideoBackdrop />  muted, looping, no-audio cut behind the hero copy
 *                          (public/ramza/video/intro-loop.mp4, ~3.4 MB). Paused
 *                          for prefers-reduced-motion; the poster shows instead.
 *   <WatchFilmButton />    opens the full film with sound in a lightbox
 *                          (intro-film.mp4). Esc / backdrop click closes it.
 *
 * Both are re-encodes of /rama-intro.mp4 (1080p, 53 MB) at 1280px, so the
 * hero stays light. Re-encode with ffmpeg if the master changes. */

import { AnimatePresence, motion } from "framer-motion";
import { Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "@/lib/ramza/track";

const V = "/ramza/video";

export function HeroVideoBackdrop() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) v.pause();
    else v.play().catch(() => {});
  }, []);
  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover"
      src={`${V}/intro-loop.mp4`}
      poster={`${V}/intro-poster.jpg`}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-hidden
    />
  );
}

export function WatchFilmButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); track("ViewContent", { placement: "hero", content: "intro-film" }); }}
        className={`group inline-flex items-center gap-3 text-[14px] font-medium text-white ${className}`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 backdrop-blur transition group-hover:bg-white group-hover:text-[#14131C]">
          <Play size={15} className="ml-0.5" fill="currentColor" />
        </span>
        Watch the film <span className="text-[#A19EA6]">0:47</span>
      </button>
      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              role="dialog" aria-modal="true" aria-label="RAMZA intro film"
            >
              <motion.div
                className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-black ring-1 ring-white/10"
                initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <video className="block aspect-video w-full" src={`${V}/intro-film.mp4`} poster={`${V}/intro-poster.jpg`} controls autoPlay playsInline />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close film" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 hover:bg-black">
                  <X size={16} />
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
