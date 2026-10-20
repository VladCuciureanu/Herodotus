import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redistributeTimestamps } from "../src/timeline.ts";
import type { ScheduleConfig } from "../src/types.ts";

const schedule: ScheduleConfig = {
  start: 9 * 60, // 09:00
  end: 18 * 60, // 18:00
  timezone: "UTC",
  allowedDays: [1, 2, 3, 4, 5],
  anchor: { type: "start", date: new Date("2024-01-08T09:00:00Z") },
};

describe("redistributeTimestamps", () => {
  it("empty array returns empty", () => {
    assert.deepEqual(redistributeTimestamps([], schedule, 42), []);
  });

  it("single timestamp is moved to work hours", () => {
    const ts = Math.floor(new Date("2024-01-08T03:00:00Z").getTime() / 1000);
    const result = redistributeTimestamps([ts], schedule, 42);

    const resultDate = new Date(result[0] * 1000);
    const hours = resultDate.getUTCHours();
    assert.ok(hours >= 9);
    assert.ok(hours < 18);
  });

  it("preserves commit order", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 1200, base + 1800];
    const result = redistributeTimestamps(timestamps, schedule, 42);

    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i - 1]);
    }
  });

  it("all results fall within work hours", () => {
    const base = Math.floor(new Date("2024-01-08T02:00:00Z").getTime() / 1000);
    const timestamps = Array.from({ length: 20 }, (_, i) => base + i * 3600);
    const result = redistributeTimestamps(timestamps, schedule, 42);

    for (const ts of result) {
      const d = new Date(ts * 1000);
      const hours = d.getUTCHours();
      const day = d.getUTCDay();
      assert.ok(hours >= 9);
      assert.ok(hours < 18);
      assert.notEqual(day, 0);
      assert.notEqual(day, 6);
    }
  });

  it("reproducible with same seed", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 7200];
    const r1 = redistributeTimestamps(timestamps, schedule, 123);
    const r2 = redistributeTimestamps(timestamps, schedule, 123);
    assert.deepEqual(r1, r2);
  });

  it("different seeds produce different results", () => {
    const base = Math.floor(new Date("2024-01-08T10:00:00Z").getTime() / 1000);
    const timestamps = [base, base + 600, base + 7200];
    const r1 = redistributeTimestamps(timestamps, schedule, 123);
    const r2 = redistributeTimestamps(timestamps, schedule, 456);
    assert.equal(
      r1.some((v, i) => v !== r2[i]),
      true,
    );
  });
});

describe("redistributeTimestamps preserves commit density", () => {
  const DAY = 24 * 3600;
  // One commit a day at 03:00 UTC for ~3 months
  const base = Math.floor(new Date("2024-01-01T03:00:00Z").getTime() / 1000);
  const timestamps = Array.from({ length: 90 }, (_, i) => base + i * DAY);

  function distinctDays(result: number[]): number {
    return new Set(result.map((ts) => new Date(ts * 1000).toISOString().slice(0, 10))).size;
  }

  it("keeps months of history spread across days (forward)", () => {
    const result = redistributeTimestamps(timestamps, schedule, 42);
    const spanDays = (result[result.length - 1] - result[0]) / DAY;
    assert.ok(spanDays >= 80, `span was ${spanDays.toFixed(1)} days`);
    assert.ok(distinctDays(result) >= 60, `${distinctDays(result)} days`);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i - 1]);
    }
  });

  it("keeps months of history spread across days (backward)", () => {
    const backward: ScheduleConfig = {
      ...schedule,
      anchor: { type: "end", date: new Date("2024-06-28T17:00:00Z") },
    };
    const result = redistributeTimestamps(timestamps, backward, 42);
    const spanDays = (result[result.length - 1] - result[0]) / DAY;
    assert.ok(spanDays >= 80, `span was ${spanDays.toFixed(1)} days`);
    assert.ok(distinctDays(result) >= 60, `${distinctDays(result)} days`);
    assert.ok(result[result.length - 1] <= backward.anchor.date.getTime() / 1000);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i - 1]);
    }
  });

  it("keeps a burst of commits within the same session", () => {
    // Five commits ten minutes apart in the middle of the night
    const night = Math.floor(new Date("2024-01-09T02:00:00Z").getTime() / 1000);
    const burst = Array.from({ length: 5 }, (_, i) => night + i * 600);
    const result = redistributeTimestamps(burst, schedule, 42);
    assert.ok(result[4] - result[0] < 3 * 3600);
  });
});

describe("redistributeTimestamps in a non-UTC timezone", () => {
  it("places commits within local work hours on local allowed days", () => {
    const tz = "America/New_York";
    const local: ScheduleConfig = {
      ...schedule,
      timezone: tz,
      anchor: { type: "start", date: new Date("2024-03-08T14:00:00Z") },
    };
    // Spans the US DST change on 2024-03-10
    const base = Math.floor(new Date("2024-03-08T02:00:00Z").getTime() / 1000);
    const timestamps = Array.from({ length: 40 }, (_, i) => base + i * 3 * 3600);
    const result = redistributeTimestamps(timestamps, local, 42);

    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    for (const ts of result) {
      const parts = fmt.formatToParts(new Date(ts * 1000));
      // biome-ignore lint/style/noNonNullAssertion: the formatter always emits these parts
      const get = (t: string) => parts.find((p) => p.type === t)!.value;
      const mins = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
      assert.ok(mins >= 9 * 60 && mins < 18 * 60, `local ${get("hour")}:${get("minute")}`);
      assert.ok(!["Sat", "Sun"].includes(get("weekday")), get("weekday"));
    }
  });
});
