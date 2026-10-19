import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(r1.some((v, i) => v !== r2[i]), true);
  });
});
