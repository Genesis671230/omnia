# The "agent employee" pattern

A generic blueprint for building an always-on automation that watches external state, keeps a human-facing artifact current, and tells a human channel what happened — distilled from building Omnia's order-sync / dispatch-sheet / payment-confirmation system. Not Omnia-specific: apply this shape to any similar job (an inventory watcher, a support-ticket triager, a shipping-status poller, anything that should run unattended and be trusted).

## The shape

```
persistent scheduler (setInterval, boot once)
  → source-of-truth check (has this already been handled? — dedup ledger)
  → do the work (read external state, decide, write)
  → record what happened (audit trail)
  → tell a human, honestly (channel notification)
```

Every piece below exists because skipping it caused a real, observed failure during this build — not because it's "best practice" in the abstract.

## 1. One boot hook, many schedulers, never inline in a request handler

Start every persistent loop from a single server-boot hook (`instrumentation.ts` in Next.js — the equivalent exists in most frameworks). Never start a `setInterval` from inside a request handler or a React effect; it'll multiply on every hot-reload/re-render, or never survive to the next request in a serverless context.

```ts
const g = globalThis as unknown as { __xTimer?: NodeJS.Timeout };
export function startXScheduler() {
  if (g.__xTimer) return; // idempotent against re-import
  const tick = () => { void runCycle(); };
  setTimeout(tick, INITIAL_DELAY_MS); // let the process finish booting first
  g.__xTimer = setInterval(tick, intervalMs);
}
```

**The gotcha that costs the most time:** in a framework with hot-reload (Next.js dev, etc.), editing a file that a *running* scheduler already imported does NOT update that scheduler's in-memory code — HMR only affects code paths reached through a fresh HTTP request. A scheduler booted 20 hours ago is still running whatever code existed at boot, even though every file on disk has since been fixed. **After editing anything on a scheduler's import chain, restart the process and verify the fresh boot log lists it.** This single issue produced a full night of "the fix isn't working" reports that were actually "nobody restarted the server."

## 2. Dedup before any side effect, not after

Any action with a visible side effect (post to a channel, write a row, call a paid API) needs a dedup check **before** it runs, keyed on something stable (an order UID, a message ID) — not a timestamp, not "did I see this in the last N minutes."

```ts
async function alreadyProcessed(provider: string, id: string): Promise<boolean> {
  const { error } = await db.from("processed_ledger").insert({ provider, id }); // unique constraint on (provider, id)
  if (!error) return false; // first time — proceed
  return error.code === "23505"; // unique violation = already handled
}
```

Insert-then-check (not check-then-insert) closes the race between two overlapping cycles. Mark **before** the side effect, not after — but if the side effect then fails, roll the mark back, or the item is silently never retried:

```ts
if (await alreadyProcessed("channel-post", id)) return;
const result = await postToChannel(...);
if (!result.ok) await db.from("processed_ledger").delete().eq("provider", "channel-post").eq("id", id); // let next cycle retry
```

**Use a separate dedup key per side effect**, not one shared key for "did I handle this item at all." An order needs independent tracking for "posted to chat," "written to sheet," "payment confirmed" — coupling them means a transient failure in one blocks or duplicates the other.

## 3. Audit trail, not just logs

Console logs disappear on restart and nobody but the operator ever sees them. A `sync_runs`-style table (trigger, started/finished timestamps, per-target results, error) that every cycle writes to — success or failure — survives restarts, is queryable, and can be the backing data for a status dashboard later at zero extra cost.

## 4. Never let a structural assumption fail silently

Any write that depends on the target's structure existing (a specific column, a specific field) needs an explicit precondition check that **throws** rather than degrading. The alternative — mapping by a header/field lookup that quietly returns nothing when the structure is missing — produces the worst kind of bug: no error, no crash, just data going in blank or wrong forever until someone happens to notice the *output*, not the *cause*.

```ts
const targetCol = headers.findIndex((h) => h === "Order #");
if (targetCol === -1) throw new Error(`"${target}" has no "Order #" column — header row may be missing or corrupted`);
```

This is especially important when the target is a **shared, human-edited artifact** (a spreadsheet, a CRM record) — its structure can change out from under you at any time, from outside your system entirely.

## 5. Fuzzy matching needs a tolerance band, not exact equality — and the band should be evidence-based, not guessed

When matching two records from different systems that *should* represent the same event (a payment gateway's transaction vs. an order total), exact equality is usually too strict — legitimate small drift is real (FX conversion spread, rounding, fee timing). But a wide-open tolerance risks matching two genuinely different events.

**Don't guess the number. Run it against real data first**, then look at the distribution:
- Genuine matches cluster tightly (in this build: 0.2%–2% off, from FX spread).
- Wrong matches (coincidental ref collisions) are wildly off (90%+).

A percentage-based tolerance sized to sit cleanly between those two clusters (here, 3% with a small absolute floor for tiny amounts) auto-confirms the real matches and rejects the wrong ones — with zero per-case judgment calls once it's calibrated. If a decision like this has real financial/business consequences, surface the calibration choice to a human with the actual observed distribution before picking a number — don't silently pick one and ship it.

## 6. Every human-facing status message must be honest about what actually happened

Never conflate "automation ran" with "automation succeeded." If a downstream write can fail or be skipped, the message a human sees must distinguish success from every other outcome — otherwise the human stops double-checking, and a real gap goes unnoticed indefinitely.

```ts
// Wrong: only the success path adds a note; every other outcome looks the same as success
const note = result === "updated" ? " — done" : "";

// Right: success is the one bit that gets celebrated; everything else says "go check"
const note = result === "updated" ? " — done" : " — could not confirm, check manually";
```

## 7. Keep the pure decision logic separate from the I/O

Anything that decides *what* to write (which cell, which column, which value) should be a pure function taking already-fetched data and returning a plan — separate from the function that actually performs the network calls. This is what makes rules like #4 and #5 unit-testable without mocking a network client, and it's what let this build catch real bugs (wrong column math, wrong tolerance) in milliseconds instead of by watching a live cycle run against production data.

```ts
// pure — unit-testable
function computeUpdates(headers, rows, key, value): Update[] | "not-found" | null { ... }

// I/O shell — thin, untested-in-detail (or integration-tested separately)
async function applyUpdate(...) {
  const { headers, rows } = await fetchCurrentState(...);
  const plan = computeUpdates(headers, rows, ...);
  if (plan is a no-op signal) return plan;
  await writeUpdates(plan.updates);
}
```
