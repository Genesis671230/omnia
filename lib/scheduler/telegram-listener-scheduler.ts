// Starts one long-poll loop per configured bot persona (ops/@omnia_cos_bot,
// cfo/@omnia_cfo_bot). Unlike the interval-based schedulers, these are
// continuous loops (each getUpdates call blocks server-side up to 25s) —
// fire-and-forget once, guarded against a second start on Next.js dev
// hot-reload the same way the interval schedulers guard their timers.

import { buildPersonas, runListenerLoop } from "@/lib/telegram/listener";

const g = globalThis as unknown as { __telegramListenersStarted?: boolean };

export function startTelegramListeners() {
  if (g.__telegramListenersStarted) return;
  g.__telegramListenersStarted = true;

  const personas = buildPersonas();
  if (personas.length === 0) {
    console.log("[telegram-listener] no bot tokens configured — listener not starting");
    return;
  }
  for (const persona of personas) {
    void runListenerLoop(persona, () => false);
  }
}
