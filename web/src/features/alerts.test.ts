import { afterEach, describe, expect, test, vi } from "vitest";
import type { DeviceStatus } from "@/types";
import { coalesceAlerts, createAlerter, shouldAlert, type AlertEvent } from "./alerts";

const down = (i: number): AlertEvent & { id: number } => ({
  id: i, severity: "critical", kind: "status_change",
  message: `host${i} is DOWN`, status: "DOWN", previous_status: "UP",
});

afterEach(() => vi.useRealTimers());

describe("shouldAlert", () => {
  test("DOWN, reboot, threshold breach, recovery; not DEGRADED or info", () => {
    expect(shouldAlert(down(1))).toBe(true);
    expect(shouldAlert({ severity: "critical", kind: "reboot", message: "rebooted" })).toBe(true);
    expect(shouldAlert({ severity: "critical", kind: "oid_threshold", message: "cpu high" })).toBe(true);
    expect(shouldAlert({ severity: "info", kind: "status_change", message: "x", previous_status: "DOWN", status: "UP" })).toBe(true);
    expect(shouldAlert({ severity: "warning", kind: "status_change", message: "x", previous_status: "UP", status: "DEGRADED" })).toBe(false);
    // DEGRADED -> UP alerts only when the device was DOWN earlier in the session
    expect(shouldAlert({ severity: "info", kind: "status_change", message: "x", previous_status: "DEGRADED", status: "UP" })).toBe(false);
    expect(shouldAlert({ severity: "info", kind: "status_change", message: "x", previous_status: "DEGRADED", status: "UP" }, true)).toBe(true);
    expect(shouldAlert({ severity: "info", kind: "device_added", message: "x" })).toBe(false);
  });
});

describe("coalesceAlerts", () => {
  test("one event uses its message as title", () => {
    expect(coalesceAlerts([down(1)])).toEqual({ title: "host1 is DOWN", body: "" });
  });
  test("many events", () => {
    const r = coalesceAlerts([down(1), down(2), down(3)]);
    expect(r.title).toBe("3 alerts");
    expect(r.body).toBe("host1 is DOWN\nhost2 is DOWN\nhost3 is DOWN");
  });
  test("more than five", () => {
    const r = coalesceAlerts(Array.from({ length: 8 }, (_, i) => down(i)));
    expect(r.title).toBe("8 alerts");
    const lines = r.body.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("…and 3 more");
  });
});

describe("createAlerter", () => {
  test("fires one notification for a burst of 20 DOWN events", () => {
    vi.useFakeTimers();
    const notify = vi.fn(), beep = vi.fn();
    const a = createAlerter({ notify, beep, setTitle: () => {}, isHidden: () => false, soundOn: () => true });
    for (let i = 0; i < 20; i++) a.push(down(i));
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe("20 alerts");
    expect(beep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("no beep when sound is off", () => {
    vi.useFakeTimers();
    const notify = vi.fn(), beep = vi.fn();
    const a = createAlerter({ notify, beep, setTitle: () => {}, isHidden: () => false, soundOn: () => false });
    a.push(down(1));
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(beep).not.toHaveBeenCalled();
  });

  test("title counts unseen while hidden and resets on focus", () => {
    vi.useFakeTimers();
    const setTitle = vi.fn();
    const a = createAlerter({ notify: vi.fn(), beep: vi.fn(), setTitle, isHidden: () => true, soundOn: () => true });
    a.push(down(1));
    expect(setTitle).toHaveBeenLastCalledWith("(1) host1 is DOWN – NetPulse");
    a.push(down(2));
    expect(setTitle).toHaveBeenLastCalledWith("(2) host2 is DOWN – NetPulse");
    a.focus();
    expect(setTitle).toHaveBeenLastCalledWith("NetPulse");
    a.push(down(3));
    expect(setTitle).toHaveBeenLastCalledWith("(1) host3 is DOWN – NetPulse");
  });

  test("focus cancels a pending notification, and later alerts still fire", () => {
    vi.useFakeTimers();
    const notify = vi.fn(), beep = vi.fn(), setTitle = vi.fn();
    const a = createAlerter({ notify, beep, setTitle, isHidden: () => true, soundOn: () => true });
    a.push(down(1));
    vi.advanceTimersByTime(1000);
    a.focus();
    vi.advanceTimersByTime(2000);
    expect(notify).not.toHaveBeenCalled();
    expect(beep).not.toHaveBeenCalled();
    expect(setTitle).toHaveBeenLastCalledWith("NetPulse");
    a.push(down(2));
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe("host2 is DOWN");
    expect(beep).toHaveBeenCalledTimes(1);
  });

  test("title is untouched while visible", () => {
    vi.useFakeTimers();
    const setTitle = vi.fn();
    const a = createAlerter({ notify: vi.fn(), beep: vi.fn(), setTitle, isHidden: () => false, soundOn: () => true });
    a.push(down(1));
    expect(setTitle).not.toHaveBeenCalled();
  });

  const change = (device_id: number, previous_status: DeviceStatus, status: DeviceStatus): AlertEvent => ({
    device_id, kind: "status_change", previous_status, status,
    severity: status === "DOWN" ? "critical" : status === "DEGRADED" ? "warning" : "info",
    message: `dc${device_id} ${status}`,
  });

  test("DOWN, DEGRADED, UP gives one recovery alert on UP", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const a = createAlerter({ notify, beep: vi.fn(), setTitle: () => {}, isHidden: () => false, soundOn: () => false });
    a.push(change(1, "UP", "DOWN"));
    vi.advanceTimersByTime(2000);
    a.push(change(1, "DOWN", "DEGRADED"));
    vi.advanceTimersByTime(2000);
    a.push(change(1, "DEGRADED", "UP"));
    vi.advanceTimersByTime(2000);
    expect(notify.mock.calls.map((c) => c[0].title)).toEqual(["dc1 DOWN", "dc1 UP"]);
    // recovered: a later DEGRADED -> UP on the same device is quiet again
    a.push(change(1, "UP", "DEGRADED"));
    a.push(change(1, "DEGRADED", "UP"));
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test("plain DEGRADED -> UP with no prior DOWN does not alert", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const a = createAlerter({ notify, beep: vi.fn(), setTitle: () => {}, isHidden: () => false, soundOn: () => false });
    a.push(change(2, "UNKNOWN", "DEGRADED"));
    a.push(change(2, "DEGRADED", "UP"));
    a.push(change(1, "UP", "DOWN")); // another device going down does not count
    vi.advanceTimersByTime(2000);
    expect(notify.mock.calls.map((c) => c[0].title)).toEqual(["dc1 DOWN"]);
  });

  test("direct DOWN -> UP still alerts", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const a = createAlerter({ notify, beep: vi.fn(), setTitle: () => {}, isHidden: () => false, soundOn: () => false });
    a.push(change(3, "DOWN", "UP"));
    vi.advanceTimersByTime(2000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("non-alertable events are ignored", () => {
    vi.useFakeTimers();
    const notify = vi.fn(), beep = vi.fn(), setTitle = vi.fn();
    const a = createAlerter({ notify, beep, setTitle, isHidden: () => true, soundOn: () => true });
    a.push({ severity: "info", kind: "device_added", message: "x" });
    vi.advanceTimersByTime(5000);
    expect(notify).not.toHaveBeenCalled();
    expect(beep).not.toHaveBeenCalled();
    expect(setTitle).not.toHaveBeenCalled();
  });
});
