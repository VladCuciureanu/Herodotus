import type { ScheduleConfig } from "./types";
import { seededRandom, gaussianRandom } from "./random";

const MIN_GAP_MS = 2 * 60 * 1000; // 2 minutes
const MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

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
 * Redistribute an array of unix timestamps (seconds) into realistic work hours.
 * Returns new timestamps in the same order.
 */
export function redistributeTimestamps(
  timestamps: number[],
  schedule: ScheduleConfig,
  seed: number,
): number[] {
  if (timestamps.length === 0) return [];
  if (timestamps.length === 1) {
    const d = advanceToWorkSlot(new Date(timestamps[0] * 1000), schedule);
    return [Math.floor(d.getTime() / 1000)];
  }

  const rng = seededRandom(seed);
  const workDayMinutes = schedule.end - schedule.start;
  const workDayMs = workDayMinutes * 60 * 1000;

  // Compute original gaps
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(Math.max(0, (timestamps[i] - timestamps[i - 1]) * 1000));
  }

  // Clamp gaps
  const clampedGaps = gaps.map((g) => {
    const clamped = Math.max(MIN_GAP_MS, Math.min(MAX_GAP_MS, g));
    // Add some jitter
    const jitter = gaussianRandom(rng, 0, clamped * 0.08);
    return Math.max(MIN_GAP_MS, clamped + jitter);
  });

  // Build new timeline
  const result: number[] = [];
  let current = advanceToWorkSlot(new Date(timestamps[0] * 1000), schedule);
  result.push(Math.floor(current.getTime() / 1000));

  for (let i = 0; i < clampedGaps.length; i++) {
    let next = new Date(current.getTime() + clampedGaps[i]);

    // If we've gone past end of work day, advance to next work slot
    if (!isInWorkWindow(next, schedule)) {
      next = advanceToWorkSlot(next, schedule);
      // Add a small random offset so we don't always start exactly at work start
      const offsetMs = Math.floor(rng() * 30 * 60 * 1000); // 0-30 min
      next = new Date(next.getTime() + offsetMs);
      // Re-check after offset
      if (!isInWorkWindow(next, schedule)) {
        next = advanceToWorkSlot(next, schedule);
      }
    }

    result.push(Math.floor(next.getTime() / 1000));
    current = next;
  }

  // Shift entire timeline back so the last commit lands on a valid past slot
  if (!schedule.futureDates && result.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    const last = result[result.length - 1];
    if (last > now) {
      // Find the latest valid work slot at or before now
      const anchor = retreatToWorkSlot(new Date(now * 1000), schedule);
      const shift = last - Math.floor(anchor.getTime() / 1000);
      for (let i = 0; i < result.length; i++) {
        result[i] -= shift;
      }
    }
  }

  return result;
}
