// Dubai-calendar day arithmetic. Pure, no dependencies, so anything that has
// to bucket by "what day was it for the founder" can import it without
// dragging Supabase along.
//
// The Gulf runs UTC+4 with no daylight saving, so a fixed offset is correct
// here in a way it would not be for most timezones. order_date is stored and
// queried in UTC, so every day boundary has to be shifted before comparison —
// without that, anything placed between 20:00 and midnight Dubai time lands in
// the following UTC day and "today's sales" silently undercounts the evening.

export const DUBAI_OFFSET_MINUTES = 4 * 60;

const DAY_MS = 24 * 60 * 60_000;

function offsetMs(): number {
  return DUBAI_OFFSET_MINUTES * 60_000;
}

/** UTC instant (ms) at which the given Dubai calendar day begins. */
export function dubaiDayStartUtcMs(dateIsoDay: string): number {
  return new Date(`${dateIsoDay}T00:00:00Z`).getTime() - offsetMs();
}

/** Midnight-to-midnight Dubai day as the UTC bounds order_date is queried in. */
export function dubaiDayBoundsUtc(dateIsoDay: string): { fromUtc: string; toUtc: string } {
  const startMs = dubaiDayStartUtcMs(dateIsoDay);
  return {
    fromUtc: new Date(startMs).toISOString(),
    toUtc: new Date(startMs + DAY_MS).toISOString(),
  };
}

/** Inclusive of both the fromDay and toDay Dubai calendar days. */
export function dubaiRangeBoundsUtc(
  fromDay: string,
  toDay: string,
): { fromUtc: string; toUtc: string } {
  const fromMs = dubaiDayStartUtcMs(fromDay);
  const toMs = dubaiDayStartUtcMs(toDay) + DAY_MS;
  return { fromUtc: new Date(fromMs).toISOString(), toUtc: new Date(toMs).toISOString() };
}

/**
 * The Dubai calendar day (YYYY-MM-DD) a UTC instant falls on.
 * Returns null for a missing or unparseable timestamp rather than guessing,
 * so callers have to decide what an order with no date means.
 */
export function dubaiDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + offsetMs()).toISOString().slice(0, 10);
}

/** Today's Dubai calendar day. `nowMs` is injectable so tests are not clock-dependent. */
export function dubaiToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + offsetMs()).toISOString().slice(0, 10);
}

/** Shift a Dubai calendar day by whole days. Negative goes backwards. */
export function addDubaiDays(dateIsoDay: string, delta: number): string {
  const ms = new Date(`${dateIsoDay}T00:00:00Z`).getTime() + delta * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * First and last day of the calendar month `monthsBack` before the one
 * containing `dateIsoDay`. 0 is the current month, 1 the previous one.
 * Built from the year/month parts rather than by subtracting 30 days, so
 * "last month" is the real month and not a rolling window that drifts.
 */
export function dubaiMonthBounds(
  dateIsoDay: string,
  monthsBack = 0,
): { fromDay: string; toDay: string; label: string } {
  const [y, m] = dateIsoDay.split("-").map(Number);
  // Date.UTC normalises an out-of-range month, so month 0 rolls to December
  // of the previous year on its own.
  const first = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return {
    fromDay: first.toISOString().slice(0, 10),
    toDay: last.toISOString().slice(0, 10),
    label: first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/** Whole days from fromDay to toDay inclusive. Never less than 1. */
export function dubaiDayCount(fromDay: string, toDay: string): number {
  const ms =
    new Date(`${toDay}T00:00:00Z`).getTime() - new Date(`${fromDay}T00:00:00Z`).getTime();
  return Math.max(Math.round(ms / DAY_MS) + 1, 1);
}

/** Every Dubai calendar day from fromDay to toDay, both inclusive, ascending. */
export function dubaiDayRange(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  const endMs = new Date(`${toDay}T00:00:00Z`).getTime();
  let ms = new Date(`${fromDay}T00:00:00Z`).getTime();
  // Guard against an inverted range producing an unbounded loop.
  while (ms <= endMs) {
    days.push(new Date(ms).toISOString().slice(0, 10));
    ms += DAY_MS;
  }
  return days;
}
