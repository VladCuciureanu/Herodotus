import { describe, expect, test } from "bun:test";
import { redistributeTimestamps } from "../src/timeline";
import type { ScheduleConfig } from "../src/types";

const schedule: ScheduleConfig = {
  start: 9 * 60, // 09:00
  end: 18 * 60, // 18:00
  timezone: "UTC",
  allowedDays: [1, 2, 3, 4, 5],
  futureDates: true,
};

describe("redistributeTimestamps", () => {
  test("empty array returns empty", () => {
    expect(redistributeTimestamps([], schedule, 42)).toEqual([]);
  });

  test("single timestamp is moved to work hours", () => {
    // A 3am UTC timestamp (a Sunday would also be skipped)
    // 2024-01-08 03:00 UTC (Monday)
    const ts = Math.floor(new Date("2024-01-08T03:00:00Z").getTime() / 1000);
    const result = redistributeTimestamps([ts], schedule, 42);

    const resultDate = new Date(result[0] * 1000);
    const hours = resultDate.getUTCHours();
    expect(hours).toBeGreaterThanOrEqual(9);
    expect(hours).toBeLessThan(18);
  });

  test("preserves commit order", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 1200, base + 1800];
    const result = redistributeTimestamps(timestamps, schedule, 42);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  test("all results fall within work hours", () => {
    // Create timestamps across various times including nights/weekends
    const base = Math.floor(new Date("2024-01-08T02:00:00Z").getTime() / 1000);
    const timestamps = Array.from({ length: 20 }, (_, i) => base + i * 3600);
    const result = redistributeTimestamps(timestamps, schedule, 42);

    for (const ts of result) {
      const d = new Date(ts * 1000);
      const hours = d.getUTCHours();
      const day = d.getUTCDay();
      expect(hours).toBeGreaterThanOrEqual(9);
      expect(hours).toBeLessThan(18);
      expect(day).not.toBe(0); // not Sunday
      expect(day).not.toBe(6); // not Saturday
    }
  });

  test("reproducible with same seed", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 7200];
    const r1 = redistributeTimestamps(timestamps, schedule, 123);
    const r2 = redistributeTimestamps(timestamps, schedule, 123);
    expect(r1).toEqual(r2);
  });

  test("different seeds produce different results", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 7200];
    const r1 = redistributeTimestamps(timestamps, schedule, 123);
    const r2 = redistributeTimestamps(timestamps, schedule, 456);
    // At least one timestamp should differ
    expect(r1.some((v, i) => v !== r2[i])).toBe(true);
  });
});
