import { describe, expect, test } from "vitest";
import { compareHosts, filterDevices, headline, problemLine, sortDevices } from "./deviceView.js";

const dev = (o) => ({
  id: 1, name: "x", host: "10.0.0.1", kind: "server", status: "UP", notes: null,
  checks: [], results: [], latency: [], ...o,
});

const ds = [
  dev({ id: 1, name: "dc01", host: "10.0.0.1", kind: "dc", status: "UP", notes: "Primary site",
    checks: [{ id: 11, type: "tcp", params: { port: 389 } }], latency: [5, 7] }),
  dev({ id: 2, name: "Switch-A", host: "10.0.0.20", kind: "switch", status: "DOWN", latency: [null] }),
  dev({ id: 3, name: "printer", host: "10.0.0.3", kind: "printer", status: "PAUSED" }),
];

describe("filterDevices", () => {
  test("matches name, host, kind label, status, notes and port", () => {
    expect(filterDevices(ds, "switch-a").map((d) => d.id)).toEqual([2]);
    expect(filterDevices(ds, "10.0.0.3").map((d) => d.id)).toEqual([3]);
    expect(filterDevices(ds, "domain controller").map((d) => d.id)).toEqual([1]);
    expect(filterDevices(ds, "down").map((d) => d.id)).toEqual([2]);
    expect(filterDevices(ds, "PRIMARY").map((d) => d.id)).toEqual([1]);
    expect(filterDevices(ds, "389").map((d) => d.id)).toEqual([1]);
  });

  test("trims and treats regex characters literally", () => {
    expect(filterDevices(ds, "  10.0.0.1 ")).toHaveLength(1);
    expect(() => filterDevices(ds, "(")).not.toThrow();
    expect(filterDevices(ds, "dc*")).toEqual([]);
  });

  test("blank query returns everything", () => {
    expect(filterDevices(ds, "   ")).toHaveLength(3);
  });
});

describe("sortDevices", () => {
  test("problems sort: DOWN, DEGRADED, UNKNOWN, UP, PAUSED, then name", () => {
    const list = [
      dev({ id: 1, name: "b", status: "UP" }),
      dev({ id: 2, name: "a", status: "PAUSED" }),
      dev({ id: 3, name: "c", status: "DEGRADED" }),
      dev({ id: 4, name: "d", status: "DOWN" }),
      dev({ id: 5, name: "e", status: "UNKNOWN" }),
      dev({ id: 6, name: "A", status: "UP" }),
      dev({ id: 7, name: "z", status: "STOPPED" }),
    ];
    expect(sortDevices(list, "problems").map((d) => d.id)).toEqual([4, 3, 5, 6, 1, 2, 7]);
  });

  test("returns a new array and sorts by name", () => {
    const sorted = sortDevices(ds, "name");
    expect(sorted).not.toBe(ds);
    expect(sorted.map((d) => d.name)).toEqual(["dc01", "printer", "Switch-A"]);
  });

  test("host sort", () => {
    expect(sortDevices(ds, "host").map((d) => d.host)).toEqual(["10.0.0.1", "10.0.0.3", "10.0.0.20"]);
  });

  test("latency sort puts missing samples last", () => {
    const list = [
      dev({ id: 1, name: "none", latency: [] }),
      dev({ id: 2, name: "slow", latency: [1, 90] }),
      dev({ id: 3, name: "null", latency: [4, null] }),
      dev({ id: 4, name: "fast", latency: [30, 2] }),
    ];
    expect(sortDevices(list, "latency").map((d) => d.id)).toEqual([4, 2, 1, 3]);
  });
});

test("compareHosts orders IPv4 numerically and hostnames after IPs", () => {
  expect(["10.0.0.12", "dc01", "10.0.0.9"].sort(compareHosts)).toEqual(["10.0.0.9", "10.0.0.12", "dc01"]);
  expect(["srv-b", "Srv-a"].sort(compareHosts)).toEqual(["Srv-a", "srv-b"]);
});

describe("problemLine", () => {
  test("DOWN uses the failing liveness result", () => {
    const d = dev({
      status: "DOWN",
      results: [
        { type: "ping", label: "ping", ok: false, check_id: null, reason: "timeout" },
        { type: "tcp", label: "tcp/389", ok: false, check_id: 5, reason: "refused" },
      ],
    });
    expect(problemLine(d)).toBe("DOWN (ping: timeout)");
    expect(problemLine(dev({ status: "DOWN", results: [] }))).toBe("DOWN");
  });

  test("DEGRADED lists failing non-liveness results", () => {
    const d = dev({
      status: "DEGRADED",
      results: [
        { type: "ping", label: "ping", ok: true, check_id: null },
        { type: "tcp", label: "tcp/389", ok: false, check_id: 5, reason: "refused" },
        { type: "tcp", label: "tcp/88", ok: false, check_id: 6, reason: "timeout" },
        { type: "tcp", label: "tcp/53", ok: true, check_id: 7 },
        { type: "tcp", label: "tcp/445", ok: false, check_id: 8 },
      ],
    });
    expect(problemLine(d)).toBe("DEGRADED: tcp/389 refused, tcp/88 timeout, tcp/445 failed");
  });

  test("other statuses give null", () => {
    expect(problemLine(dev({ status: "UP" }))).toBeNull();
    expect(problemLine(dev({ status: "PAUSED" }))).toBeNull();
  });
});

describe("headline", () => {
  const s = (...statuses) => statuses.map((status) => dev({ status }));
  test("wording and variants", () => {
    expect(headline([])).toEqual({ text: "No devices yet", variant: "secondary" });
    expect(headline(s("UP", "UP", "PAUSED"))).toEqual({ text: "All 2 devices up", variant: "success" });
    expect(headline(s("UP"))).toEqual({ text: "All 1 device up", variant: "success" });
    expect(headline(s("UP", "DOWN", "DOWN", "DEGRADED"))).toEqual({ text: "2 devices down", variant: "danger" });
    expect(headline(s("UP", "DEGRADED", "DEGRADED"))).toEqual({ text: "2 devices degraded", variant: "warning" });
  });
  test("singular wording", () => {
    expect(headline(s("DOWN", "UP")).text).toBe("1 device down");
    expect(headline(s("DEGRADED")).text).toBe("1 device degraded");
  });
  test("not all checked yet is neutral", () => {
    expect(headline(s("UP", "UNKNOWN"))).toEqual({ text: "1 of 2 devices up", variant: "secondary" });
  });
});
