import type { ScheduleConfig } from "./types";
import { seededRandom, gaussianRandom } from "./random";

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
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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
 * Build a timeline forwards: place first commit, then advance by each gap.
 */
function buildTimelineForwards(
  startEpoch: number,
  gaps: number[],
  schedule: ScheduleConfig,
  rng: () => number,
): number[] {
  const result: number[] = [];
  let current = advanceToWorkSlot(new Date(startEpoch * 1000), schedule);
  result.push(Math.floor(current.getTime() / 1000));

  for (const gap of gaps) {
    let next = new Date(current.getTime() + gap);
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
 * Build a timeline backwards from now: place last commit on the most recent
 * valid slot, then walk backwards placing each earlier commit on a valid slot.
 */
function buildTimelineBackwards(
  gaps: number[],
  schedule: ScheduleConfig,
  rng: () => number,
): number[] {
  const now = new Date(Date.now());
  const result: number[] = new Array(gaps.length + 1);

  // Place last commit at the latest valid slot at or before now
  let current = retreatToWorkSlot(now, schedule);
  result[gaps.length] = Math.floor(current.getTime() / 1000);

  // Walk backwards through gaps
  for (let i = gaps.length - 1; i >= 0; i--) {
    let prev = new Date(current.getTime() - gaps[i]);
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
 */
export function redistributeTimestamps(
  timestamps: number[],
  schedule: ScheduleConfig,
  seed: number,
  changeCounts?: number[],
): number[] {
  if (timestamps.length === 0) return [];
  if (timestamps.length === 1) {
    const d = advanceToWorkSlot(new Date(timestamps[0] * 1000), schedule);
    return [Math.floor(d.getTime() / 1000)];
  }

  const rng = seededRandom(seed);

  // Compute gaps based on change counts of the next commit
  const clampedGaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const changes = changeCounts ? Math.max(1, changeCounts[i]) : 1;
    const baseGap = changes * BASE_MS_PER_CHANGE;
    const clamped = Math.max(MIN_GAP_MS, Math.min(MAX_GAP_MS, baseGap));
    const jitter = gaussianRandom(rng, 0, clamped * 0.15);
    clampedGaps.push(Math.max(MIN_GAP_MS, clamped + jitter));
  }

  if (!schedule.futureDates) {
    // Build timeline backwards from now so every commit lands on a valid day
    return buildTimelineBackwards(clampedGaps, schedule, rng);
  }

  // Build timeline forwards from the first commit's date
  return buildTimelineForwards(timestamps[0], clampedGaps, schedule, rng);
}
