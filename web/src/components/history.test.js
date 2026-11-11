import { describe, expect, test } from "vitest";
import { axisLabels, historyFor, historyForRange, latestOnly, slotTitle, slotVariant } from "./history.js";

const START = "2026-11-11T04:00:00+00:00";
const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
  const history = { devices: [{ device_id: 2, buckets: ["UP"], uptime_pct: 100 }] };
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
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    };
    const a = defer();
    const b = defer();
    const applied = [];
    guard(a.promise).then((v) => applied.push(v));
    guard(b.promise).then((v) => applied.push(v));
    b.resolve("B");
    a.resolve("A");
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual(["B"]);
  });
});

describe("historyForRange", () => {
  const h = { range: "24h", devices: [] };
  test("returns the history only for a matching range", () => {
    expect(historyForRange(h, "24h")).toBe(h);
    expect(historyForRange(h, "1h")).toBeNull();
    expect(historyForRange(null, "24h")).toBeNull();
  });
});

describe("latestOnly rejections", () => {
  test("swallows a stale rejection and passes the latest one through", async () => {
    const guard = latestOnly();
    const seen = [];
    guard(Promise.reject(new Error("old"))).catch((e) => seen.push(e.message));
    guard(Promise.reject(new Error("new"))).catch((e) => seen.push(e.message));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["new"]);
  });
});
