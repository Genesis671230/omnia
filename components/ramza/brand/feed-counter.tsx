"use client";

import { useEffect, useState } from "react";

/* Ticks once per payout chip in the "Payout feed" logo direction: the four
   chips land at 14/24/34/44% of the 8s loop (agent.css ra-ch-*). Counts up
   from zero across loops; under reduced motion it just shows one loop's four. */
const LOOP_MS = 8000;
const LANDS = [0.14, 0.24, 0.34, 0.44];

export function FeedCounter() {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(LANDS.length);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const loops = Math.floor(elapsed / LOOP_MS);
      const phase = (elapsed % LOOP_MS) / LOOP_MS;
      setN(loops * LANDS.length + LANDS.filter((p) => phase >= p).length);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  return <>{n.toLocaleString("en-US")}</>;
}
