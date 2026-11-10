import { describe, expect, test } from "vitest";
import { initialState, monitorReducer } from "./monitorReducer.js";

const cfg = (id, extra = {}) => ({
  id, name: `d${id}`, host: `10.0.0.${id}`, kind: "other", enabled: true,
  interval_s: 5, fail_threshold: 2, timeout_ms: 1000, liveness: "ping",
  liveness_port: null, snmp: null, notes: null, checks: [], ...extra,
});
const st = (id, extra = {}) => ({
  device_id: id, name: `d${id}`, status: "UP", since: "2026-01-01T00:00:00Z",
  consecutive_failures: 0, results: [], latency: [], ...extra,
});
const ev = (id) => ({ id, device_id: 1, severity: "info", kind: "status_change", message: `e${id}` });
const snap = (devices, statuses, events = []) =>
  monitorReducer(initialState, { type: "SNAPSHOT", devices, statuses, events });

describe("monitorReducer", () => {
  test("SNAPSHOT replaces devices and events", () => {
    const a = { type: "SNAPSHOT", devices: [cfg(1)], statuses: [st(1)], events: [ev(1)] };
    const s1 = monitorReducer(initialState, a);
    const s2 = monitorReducer(s1, { ...a, events: [ev(2), ev(1)] });
    expect(s2.events.map((e) => e.id)).toEqual([2, 1]);
    expect(s2.order).toEqual([1]);
  });

  test("SNAPSHOT merges config and status; missing status is UNKNOWN", () => {
    const s = snap([cfg(1), cfg(2)], [st(1, { latency: [3, 4] })]);
    expect(s.devices[1]).toMatchObject({ host: "10.0.0.1", status: "UP", latency: [3, 4] });
    expect(s.devices[2]).toMatchObject({ host: "10.0.0.2", status: "UNKNOWN", results: [], latency: [] });
    expect(s.order).toEqual([1, 2]);
  });

  test("STATUS updates status, since and failures", () => {
    const s0 = snap([cfg(1)], [st(1)]);
    const s = monitorReducer(s0, {
      type: "STATUS",
      payload: { device_id: 1, status: "DOWN", previous_status: "UP", since: "2026-02-02T00:00:00Z", consecutive_failures: 3 },
    });
    expect(s.devices[1]).toMatchObject({ status: "DOWN", since: "2026-02-02T00:00:00Z", consecutive_failures: 3 });
  });

  test("RESULT appends latency capped at 60", () => {
    let s = snap([cfg(1)], [st(1)]);
    for (let i = 1; i <= 61; i++) {
      s = monitorReducer(s, { type: "RESULT", payload: { device_id: 1, results: [{ ok: true }], latency_ms: i } });
    }
    expect(s.devices[1].latency).toHaveLength(60);
    expect(s.devices[1].latency.at(-1)).toBe(61);
    expect(s.devices[1].results).toEqual([{ ok: true }]);
  });

  test("EVENT prepends and ignores an id already present", () => {
    const s0 = snap([cfg(1)], [st(1)], [ev(1)]);
    const s1 = monitorReducer(s0, { type: "EVENT", event: ev(2) });
    expect(s1.events.map((e) => e.id)).toEqual([2, 1]);
    expect(monitorReducer(s1, { type: "EVENT", event: ev(2) })).toBe(s1);
  });

  test("events capped at 500", () => {
    let s = initialState;
    for (let i = 1; i <= 501; i++) s = monitorReducer(s, { type: "EVENT", event: ev(i) });
    expect(s.events).toHaveLength(500);
    expect(s.events[0].id).toBe(501);
  });

  test("DEVICE_REMOVED drops device and order entry", () => {
    const s = monitorReducer(snap([cfg(1), cfg(2)], [st(1), st(2)]), { type: "DEVICE_REMOVED", id: 1 });
    expect(s.devices[1]).toBeUndefined();
    expect(s.order).toEqual([2]);
  });

  test("EVENT_ACKED and EVENTS_CLEARED", () => {
    const s0 = snap([cfg(1)], [st(1)], [ev(2), ev(1)]);
    const s1 = monitorReducer(s0, { type: "EVENT_ACKED", id: 1 });
    expect(s1.events.find((e) => e.id === 1).acknowledged).toBe(true);
    expect(s1.events.find((e) => e.id === 2).acknowledged).toBeFalsy();
    expect(monitorReducer(s1, { type: "EVENTS_CLEARED" }).events).toEqual([]);
  });

  test("STATUS and RESULT for unknown device are ignored", () => {
    const s = snap([cfg(1)], [st(1)]);
    expect(monitorReducer(s, { type: "STATUS", payload: { device_id: 9, status: "DOWN" } })).toBe(s);
    expect(monitorReducer(s, { type: "RESULT", payload: { device_id: 9, results: [], latency_ms: 1 } })).toBe(s);
  });

  test("CONNECTED and DISCONNECTED toggle connected", () => {
    const s = monitorReducer(initialState, { type: "CONNECTED" });
    expect(s.connected).toBe(true);
    expect(monitorReducer(s, { type: "DISCONNECTED" }).connected).toBe(false);
  });
});
