import type { ScheduleConfig } from "./types.ts";
import { gaussianRandom, seededRandom } from "./random.ts";

const MIN_GAP_MS = 2 * 60 * 1000; // 2 minutes
const MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours
const BASE_MS_PER_CHANGE = 3 * 60 * 1000; // 3 minutes per file change

/**
 * Given a Date, return the local time-of-day in minutes within the given timezone.
 */
function getMinutesInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(parts.find((p) => p.type === "hour")!.value);
  const minute = parseInt(parts.find((p) => p.type === "minute")!.value);
  return hour * 60 + minute;
}

/**
 * Get the day of week (0=Sun, 6=Sat) in the given timezone.
 */
function getDayOfWeekInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "weekday")!.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day];
}

/**
 * Check if a timestamp falls within valid working hours.
 */
function isInWorkWindow(date: Date, schedule: ScheduleConfig): boolean {
  const dow = getDayOfWeekInTz(date, schedule.timezone);
  if (!schedule.allowedDays.includes(dow)) return false;

  const mins = getMinutesInTz(date, schedule.timezone);
  return mins >= schedule.start && mins < schedule.end;
}

/**
 * Advance a Date to the next valid work slot.
 * If already in a valid slot, returns the same date.
 */
function advanceToWorkSlot(date: Date, schedule: ScheduleConfig): Date {
  let d = new Date(date.getTime());

  // Try up to 14 days to find a valid slot
  for (let day = 0; day < 14; day++) {
    const dow = getDayOfWeekInTz(d, schedule.timezone);

    if (schedule.allowedDays.includes(dow)) {
      const mins = getMinutesInTz(d, schedule.timezone);
      if (mins < schedule.end) {
        if (mins < schedule.start) {
          d = new Date(d.getTime() + (schedule.start - mins) * 60 * 1000);
        }
        return d;
      }
    }

    // Jump to next day at work start time
    const mins = getMinutesInTz(d, schedule.timezone);
    const minsUntilMidnight = 24 * 60 - mins;
    d = new Date(
      d.getTime() + (minsUntilMidnight + schedule.start) * 60 * 1000,
    );
  }

  // Fallback: return as-is (shouldn't happen with valid config)
  return d;
}

/**
 * Walk backwards from a Date to find the most recent valid work slot.
 */
function retreatToWorkSlot(date: Date, schedule: ScheduleConfig): Date {
  let d = new Date(date.getTime());

  for (let day = 0; day < 14; day++) {
    const dow = getDayOfWeekInTz(d, schedule.timezone);

    if (schedule.allowedDays.includes(dow)) {
      const mins = getMinutesInTz(d, schedule.timezone);
      if (mins >= schedule.start && mins < schedule.end) {
        return d;
      }
      if (mins >= schedule.end) {
        const diff = (mins - schedule.end + 1) * 60 * 1000;
        return new Date(d.getTime() - diff);
      }
    }

    // Jump to previous day at end of work hours
    const mins = getMinutesInTz(d, schedule.timezone);
    const minsFromMidnight = mins;
    const prevDayEnd = 24 * 60 - schedule.end + minsFromMidnight;
    d = new Date(d.getTime() - (prevDayEnd + 1) * 60 * 1000);
  }

  return d;
}

/**
 * Snap a Date to the start of the work day if it's before work hours,
 * or to the next work day start if it's after.
 */
function snapToWorkStart(date: Date, schedule: ScheduleConfig): Date {
  const mins = getMinutesInTz(date, schedule.timezone);

  if (mins < schedule.start) {
    // Before work: jump to start time
    const diff = (schedule.start - mins) * 60 * 1000;
    return new Date(date.getTime() + diff);
  }

  if (mins >= schedule.end) {
    // After work: jump to next day's start
    const minsUntilMidnight = (24 * 60 - mins) * 60 * 1000;
    const nextDay = new Date(date.getTime() + minsUntilMidnight);
    const diff = schedule.start * 60 * 1000;
    return new Date(nextDay.getTime() + diff);
  }

  return date;
}

/**
 * Build a timeline forwards: place the first commit, then place each later
 * commit at its original offset from the first one, but never closer to its
 * predecessor than the session gap.
 */
function buildTimelineForwards(
  startEpoch: number,
  gaps: number[],
  offsets: number[],
  schedule: ScheduleConfig,
  rng: () => number,
): number[] {
  const result: number[] = [];
  let current = advanceToWorkSlot(new Date(startEpoch * 1000), schedule);
  const base = current.getTime();
  result.push(Math.floor(base / 1000));

  for (let i = 0; i < gaps.length; i++) {
    const target = base + offsets[i + 1];
    let next = new Date(Math.max(current.getTime() + gaps[i], target));
    if (!isInWorkWindow(next, schedule)) {
      next = advanceToWorkSlot(next, schedule);
      const offsetMs = Math.floor(rng() * 30 * 60 * 1000);
      next = new Date(next.getTime() + offsetMs);
      if (!isInWorkWindow(next, schedule)) {
        next = advanceToWorkSlot(next, schedule);
      }
    }
    result.push(Math.floor(next.getTime() / 1000));
    current = next;
  }

  return result;
}

/**
 * Build a timeline backwards from the anchor: place the last commit on the
 * most recent valid slot, then walk backwards placing each earlier commit at
 * its original offset from the last one (or at least the session gap earlier).
 */
function buildTimelineBackwards(
  gaps: number[],
  offsets: number[],
  schedule: ScheduleConfig,
  rng: () => number,
): number[] {
  const last = gaps.length;
  const result: number[] = new Array(last + 1);

  // Place last commit at the latest valid slot at or before the anchor date
  let current = retreatToWorkSlot(schedule.anchor.date, schedule);
  const base = current.getTime();
  result[last] = Math.floor(base / 1000);

  // Walk backwards through gaps
  for (let i = last - 1; i >= 0; i--) {
    const target = base - (offsets[last] - offsets[i]);
    let prev = new Date(Math.min(current.getTime() - gaps[i], target));
    if (!isInWorkWindow(prev, schedule)) {
      prev = retreatToWorkSlot(prev, schedule);
      // Subtract a small random offset to avoid always landing at slot boundary
      const offsetMs = Math.floor(rng() * 20 * 60 * 1000);
      prev = new Date(prev.getTime() - offsetMs);
      if (!isInWorkWindow(prev, schedule)) {
        prev = retreatToWorkSlot(prev, schedule);
      }
    }
    result[i] = Math.floor(prev.getTime() / 1000);
    current = prev;
  }

  return result;
}

/**
 * Redistribute an array of unix timestamps (seconds) into realistic work hours.
 * Returns new timestamps in the same order.
 *
 * The original spacing between commits is preserved: commits that were days
 * apart stay days apart, while commits made in one sitting stay close
 * together. Any timestamp that falls outside the work window is snapped to
 * the nearest valid slot in the direction of travel.
 */
export function redistributeTimestamps(
  timestamps: number[],
  schedule: ScheduleConfig,
  seed: number,
  changeCounts?: number[],
): number[] {
  if (timestamps.length === 0) return [];
  if (timestamps.length === 1) {
    const d = schedule.anchor.type === "start"
      ? advanceToWorkSlot(schedule.anchor.date, schedule)
      : retreatToWorkSlot(schedule.anchor.date, schedule);
    return [Math.floor(d.getTime() / 1000)];
  }

  const rng = seededRandom(seed);

  // offsets[i]: original time since the first commit (ms), made monotonic so
  // out-of-order author dates (e.g. after a rebase) don't move commits back.
  // gaps[i-1]: minimum spacing between commit i-1 and i within a session.
  const offsets: number[] = [0];
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const originalGap = Math.max(0, timestamps[i] - timestamps[i - 1]) * 1000;
    offsets.push(offsets[i - 1] + originalGap);

    let baseGap: number;
    if (originalGap > 0 && originalGap <= MAX_GAP_MS) {
      baseGap = originalGap;
    } else {
      const changes = changeCounts ? Math.max(1, changeCounts[i]) : 1;
      baseGap = changes * BASE_MS_PER_CHANGE;
    }
    const clamped = Math.max(MIN_GAP_MS, Math.min(MAX_GAP_MS, baseGap));
    const jitter = gaussianRandom(rng, 0, clamped * 0.15);
    gaps.push(Math.max(MIN_GAP_MS, clamped + jitter));
  }

  if (schedule.anchor.type === "end") {
    return buildTimelineBackwards(gaps, offsets, schedule, rng);
  }

  return buildTimelineForwards(
    Math.floor(schedule.anchor.date.getTime() / 1000),
    gaps,
    offsets,
    schedule,
    rng,
  );
}
