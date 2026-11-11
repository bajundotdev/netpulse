import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HistoryOut } from "@/types";
import {
  axisLabels,
  createDebouncer,
  historyFor,
  historyForRange,
  latestOnly,
  slotTitle,
  slotVariant,
  stripSummary,
  uptimeLabel,
} from "./history";

const EMPTY_HISTORY: HistoryOut = {
  range: "24h", start: "", end: "", bucket_seconds: 900, problems_last_hour: 0,
  overall: { problems: [], status: [] }, devices: [],
};

const START = "2026-11-11T04:00:00+00:00";
const hm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

describe("slotTitle", () => {
  test("renders the slot's local-time range and status", () => {
    const t0 = Date.parse(START) + 3 * 900_000;
    expect(slotTitle(START, 900, 3, "DOWN")).toBe(`${hm(t0)}–${hm(t0 + 900_000)} · Down`);
  });
  test("null status reads No data", () => {
    const t0 = Date.parse(START);
    expect(slotTitle(START, 900, 0, null)).toBe(`${hm(t0)}–${hm(t0 + 900_000)} · No data`);
  });
  test("7d slots carry a date prefix", () => {
    const t0 = new Date(Date.parse(START) + 7200_000);
    const day = t0.toLocaleDateString([], { month: "short", day: "numeric" });
    expect(slotTitle(START, 7200, 1, "UP")).toContain(`${day} `);
    expect(slotTitle(START, 7200, 1, "UP")).toContain("· Up");
  });
});

describe("axisLabels", () => {
  test("five labels per range", () => {
    expect(axisLabels("1h")).toEqual(["60m ago", "45m", "30m", "15m", "Now"]);
    expect(axisLabels("24h")).toEqual(["24h ago", "18h", "12h", "6h", "Now"]);
    expect(axisLabels("7d")).toEqual(["7d ago", "5d", "4d", "2d", "Now"]);
  });
});

describe("slotVariant", () => {
  test("maps statuses", () => {
    expect(slotVariant("UP")).toBe("success");
    expect(slotVariant("DEGRADED")).toBe("warning");
    expect(slotVariant("DOWN")).toBe("danger");
    expect(slotVariant("PAUSED")).toBe("secondary");
    expect(slotVariant(null)).toBe("secondary");
  });
});

describe("historyFor", () => {
  const history: HistoryOut = { ...EMPTY_HISTORY, devices: [{ device_id: 2, buckets: ["UP"], uptime_pct: 100 }] };
  test("finds a device", () => {
    expect(historyFor(history, 2)).toEqual({ buckets: ["UP"], uptime_pct: 100 });
  });
  test("returns null for unknown device or no history", () => {
    expect(historyFor(history, 9)).toBeNull();
    expect(historyFor(null, 2)).toBeNull();
  });
});

describe("latestOnly", () => {
  test("drops stale responses", async () => {
    const guard = latestOnly();
    const defer = () => {
      let resolve!: (value: string) => void;
      const promise = new Promise<string>((r) => (resolve = r));
      return { promise, resolve };
    };
    const a = defer();
    const b = defer();
    const applied: string[] = [];
    guard(a.promise).then((v) => applied.push(v));
    guard(b.promise).then((v) => applied.push(v));
    b.resolve("B");
    a.resolve("A");
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual(["B"]);
  });
});

describe("historyForRange", () => {
  const h: HistoryOut = EMPTY_HISTORY;
  test("returns the history only for a matching range", () => {
    expect(historyForRange(h, "24h")).toBe(h);
    expect(historyForRange(h, "1h")).toBeNull();
    expect(historyForRange(null, "24h")).toBeNull();
  });
});

describe("latestOnly rejections", () => {
  test("swallows a stale rejection and passes the latest one through", async () => {
    const guard = latestOnly();
    const seen: string[] = [];
    guard(Promise.reject(new Error("old"))).catch((e) => seen.push(e.message));
    guard(Promise.reject(new Error("new"))).catch((e) => seen.push(e.message));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["new"]);
  });
});

describe("uptimeLabel", () => {
  test("formats uptime with up to two decimals", () => {
    expect(uptimeLabel({ uptime_pct: 99.5 })).toBe("99.5% uptime");
    expect(uptimeLabel({ uptime_pct: 100 })).toBe("100% uptime");
    expect(uptimeLabel({ uptime_pct: 99.456 })).toBe("99.46% uptime");
    expect(uptimeLabel({ uptime_pct: 0 })).toBe("0% uptime");
  });
  test("reads No history yet without a row or without uptime", () => {
    expect(uptimeLabel(null)).toBe("No history yet");
    expect(uptimeLabel({ uptime_pct: null })).toBe("No history yet");
  });
});

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("collapses calls within the delay into one", () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 2000);
    d();
    vi.advanceTimersByTime(1000);
    d();
    vi.advanceTimersByTime(1999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("cancel prevents the call", () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 2000);
    d();
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("stripSummary", () => {
  test("counts down and degraded slots", () => {
    expect(stripSummary(["UP", "DOWN", "DOWN", "DEGRADED", null], "24 hours")).toBe(
      "24 hours: 2 slots down, 1 degraded",
    );
    expect(stripSummary(["DOWN", "UP"], "hour")).toBe("hour: 1 slot down");
    expect(stripSummary(["DEGRADED"], "hour")).toBe("hour: 1 degraded");
  });
  test("says all up when nothing is wrong", () => {
    expect(stripSummary(["UP", null, "PAUSED"], "7 days")).toBe("7 days: all up");
  });
});
