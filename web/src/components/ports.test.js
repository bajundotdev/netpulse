import { describe, expect, it } from "vitest";
import { DC_PRESET_PORTS, diffChecks, mergePorts, parsePort, portsOf } from "./ports.js";

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
    const checks = [
      { id: 1, type: "tcp", params: { port: 88 } },
      { id: 2, type: "snmp", params: {} },
      { id: 3, type: "tcp", params: { port: 22 } },
    ];
    expect(portsOf(checks)).toEqual([22, 88]);
  });
});

describe("diffChecks", () => {
  it("adds new ports and removes dropped tcp checks", () => {
    const original = [{ id: 7, type: "tcp", params: { port: 22 } }];
    expect(diffChecks(original, [389])).toEqual({ add: [389], remove: [original[0]] });
  });
  it("never removes non-tcp checks", () => {
    const original = [{ id: 9, type: "snmp", params: {} }];
    expect(diffChecks(original, [])).toEqual({ add: [], remove: [] });
  });
  it("keeps unchanged ports", () => {
    const original = [{ id: 7, type: "tcp", params: { port: 22 } }];
    expect(diffChecks(original, [22])).toEqual({ add: [], remove: [] });
  });
});
