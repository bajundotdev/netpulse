import { describe, expect, test } from "vitest";
import { singleFlight } from "./singleFlight.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("singleFlight", () => {
  test("calls during a run share one trailing run instead of overlapping", async () => {
    const runs = [];
    let active = 0, maxActive = 0;
    const fn = singleFlight(() => {
      const d = deferred();
      runs.push(d);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return d.promise.finally(() => { active -= 1; });
    });
    const a = fn();
    const b = fn();
    const c = fn();
    expect(runs).toHaveLength(1);
    expect(b).toBe(c);
    runs[0].resolve("first");
    expect(await a).toBe("first");
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toHaveLength(2);
    runs[1].resolve("second");
    expect(await b).toBe("second");
    expect(maxActive).toBe(1);
  });

  test("a failed run rejects its caller and does not block the next", async () => {
    let n = 0;
    const fn = singleFlight(async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return n;
    });
    await expect(fn()).rejects.toThrow("boom");
    expect(await fn()).toBe(2);
  });
});
