import { describe, expect, it } from "vitest";
import type { CheckIn, CheckOut } from "@/types";
import {
  DC_PRESET_PORTS, applyPortChanges, diffChecks, mergePorts, parsePort, portsOf, withPendingPort,
} from "./ports";
import type { BaselineError } from "./ports";

const tcp = (id: number, port: number): CheckOut => ({
  id, device_id: 1, type: "tcp", params: { port }, enabled: true, created_at: "",
});
const uptime = (id: number): CheckOut => ({
  id, device_id: 1, type: "snmp_uptime", params: {}, enabled: true, created_at: "",
});
const failure = async (promise: Promise<unknown>): Promise<BaselineError> => {
  try {
    await promise;
  } catch (e) {
    return e as BaselineError;
  }
  throw new Error("expected the call to fail");
};

describe("mergePorts", () => {
  it("merges, sorts and de-duplicates", () => {
    expect(mergePorts([389, 53], DC_PRESET_PORTS)).toEqual([53, 88, 135, 389, 445, 636, 3268, 3389]);
  });
});

describe("parsePort", () => {
  it("accepts integers 1-65535 only", () => {
    expect(parsePort("389")).toBe(389);
    expect(parsePort(" 65535 ")).toBe(65535);
    for (const bad of ["", "0", "65536", "1.5", "abc", "-1", "1e3"]) expect(parsePort(bad)).toBeNull();
  });
});

describe("portsOf", () => {
  it("returns sorted tcp ports only", () => {
    const checks = [tcp(1, 88), uptime(2), tcp(3, 22)];
    expect(portsOf(checks)).toEqual([22, 88]);
  });
});

describe("diffChecks", () => {
  it("adds new ports and removes dropped tcp checks", () => {
    const original = [tcp(7, 22)];
    expect(diffChecks(original, [389])).toEqual({ add: [389], remove: [original[0]] });
  });
  it("never removes non-tcp checks", () => {
    const original = [uptime(9)];
    expect(diffChecks(original, [])).toEqual({ add: [], remove: [] });
  });
  it("keeps unchanged ports", () => {
    const original = [tcp(7, 22)];
    expect(diffChecks(original, [22])).toEqual({ add: [], remove: [] });
  });
});

describe("applyPortChanges", () => {
  const makeApi = (failOn: (number | string)[] = []) => {
    let next = 100;
    const calls: [string, number][] = [];
    return {
      calls,
      addCheck: async (_deviceId: number, body: CheckIn) => {
        if (body.type !== "tcp") throw new Error("only tcp checks expected");
        calls.push(["add", body.params.port]);
        if (failOn.includes(body.params.port)) throw new Error(`add ${body.params.port} failed`);
        return tcp(next++, body.params.port);
      },
      deleteCheck: async (id: number) => {
        calls.push(["delete", id]);
        if (failOn.includes(`del${id}`)) throw new Error(`delete ${id} failed`);
      },
    };
  };

  it("resolves with the final checks list when everything succeeds", async () => {
    const api = makeApi();
    const result = await applyPortChanges(1, [tcp(7, 22)], [80, 443], api);
    expect(portsOf(result)).toEqual([80, 443]);
    expect(result.some((c) => c.id === 7)).toBe(false);
  });

  it("carries the updated baseline on the error after a partial failure", async () => {
    const api = makeApi([443]);
    const err = await failure(applyPortChanges(1, [], [80, 443], api));
    expect(err.message).toBe("add 443 failed");
    expect(portsOf(err.baseline)).toEqual([80]);
  });

  it("retrying with the returned baseline only calls what is left", async () => {
    const err = await failure(applyPortChanges(1, [], [80, 443], makeApi([443])));
    const api = makeApi();
    const result = await applyPortChanges(1, err.baseline ?? [], [80, 443], api);
    expect(api.calls).toEqual([["add", 443]]);
    expect(portsOf(result)).toEqual([80, 443]);
  });

  it("drops deleted checks from the baseline when a later call fails", async () => {
    const api = makeApi(["del8"]);
    const err = await failure(applyPortChanges(1, [tcp(7, 22), tcp(8, 23)], [], api));
    expect(err.baseline?.map((c) => c.id)).toEqual([8]);
  });
});

describe("withPendingPort", () => {
  it("adds a typed but not added port on save", () => {
    expect(withPendingPort([389], " 88 ")).toEqual({ ports: [88, 389], error: null });
  });
  it("leaves ports alone for blank text", () => {
    const ports = [389];
    expect(withPendingPort(ports, "  ")).toEqual({ ports, error: null });
  });
  it("blocks save with the port error for invalid text", () => {
    expect(withPendingPort([389], "70000")).toEqual({ ports: [389], error: "Enter a whole number from 1 to 65535" });
  });
});
