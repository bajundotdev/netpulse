import { describe, expect, it } from "vitest";
import { formatResultValue, formatUptime } from "./format.js";
import { applySnmpChanges, buildSnmpPayload, desiredSnmpChecks, snmpFormOf, EMPTY_SNMP } from "./snmp.js";

describe("formatUptime", () => {
  it("formats ticks as days/hours, hours/minutes or minutes", () => {
    expect(formatUptime(27360000)).toBe("3d 4h");
    expect(formatUptime(5 * 3600 * 100 + 12 * 60 * 100)).toBe("5h 12m");
    expect(formatUptime(42 * 60 * 100)).toBe("42m");
  });
});

describe("formatResultValue", () => {
  it("summarises interface maps and scalars", () => {
    expect(formatResultValue({ 1: { name: "Gi1", status: "up" } })).toBe("Gi1 up");
    expect(formatResultValue(42)).toBe("42");
    expect(formatResultValue(null)).toBe("");
  });
});

describe("buildSnmpPayload", () => {
  it("is null when off", () => {
    expect(buildSnmpPayload({ ...EMPTY_SNMP, version: "off" })).toBeNull();
  });
  it("omits blank secrets so the backend keeps them", () => {
    const p = buildSnmpPayload({ ...EMPTY_SNMP, version: "v3", user: "mon", authProto: "SHA", authKey: "", privProto: "AES128", privKey: "" });
    expect(p).toEqual({ version: "v3", port: 161, user: "mon", auth_proto: "SHA", priv_proto: "AES128" });
    expect("auth_key" in p).toBe(false);
    expect("priv_key" in p).toBe(false);
  });
  it("sends a typed v2c community and omits a blank one", () => {
    expect(buildSnmpPayload({ ...EMPTY_SNMP, version: "v2c", community: "public" }).community).toBe("public");
    expect("community" in buildSnmpPayload({ ...EMPTY_SNMP, version: "v2c" })).toBe(false);
  });
});

describe("snmpFormOf", () => {
  it("never carries secrets", () => {
    const f = snmpFormOf({ snmp: { version: "v2c", port: 161, has_community: true }, checks: [{ id: 1, type: "snmp_uptime", params: {} }] });
    expect(f.community).toBe("");
    expect(f.uptime).toBe(true);
  });
});

describe("applySnmpChanges", () => {
  const form = { ...EMPTY_SNMP, version: "v2c", uptime: true, interfaces: true, ifIndexes: "2, 1", oids: [{ oid: "1.3.6.1.2.1.1.5.0", label: "", mode: "change", op: ">", value: "" }] };

  it("builds desired checks", () => {
    expect(desiredSnmpChecks(form)).toEqual([
      { type: "snmp_uptime", params: {} },
      { type: "snmp_if", params: { if_indexes: [1, 2] } },
      { type: "snmp_oid", params: { oid: "1.3.6.1.2.1.1.5.0", label: "1.3.6.1.2.1.1.5.0", mode: "change" } },
    ]);
  });

  it("adds, updates and deletes, leaving tcp alone", async () => {
    const calls = [];
    const api = {
      addCheck: async (_, b) => (calls.push(["add", b.type]), { id: 9, device_id: 1, ...b }),
      updateCheck: async (id, b) => (calls.push(["update", id]), { id, device_id: 1, ...b }),
      deleteCheck: async (id) => calls.push(["delete", id]),
    };
    const baseline = [
      { id: 1, type: "tcp", params: { port: 80 } },
      { id: 2, type: "snmp_if", params: {} },
      { id: 3, type: "snmp_oid", params: { oid: "1.3.6.1.9", label: "x", mode: "change" } },
    ];
    const result = await applySnmpChanges(1, baseline, desiredSnmpChecks(form), api);
    expect(calls).toEqual([["delete", 3], ["update", 2], ["add", "snmp_uptime"], ["add", "snmp_oid"]]);
    expect(result.map((c) => c.id).sort()).toEqual([1, 2, 9, 9]);
  });

  it("reports the real baseline when a call fails", async () => {
    const api = {
      addCheck: async () => { throw new Error("boom"); },
      updateCheck: async () => ({}),
      deleteCheck: async () => {},
    };
    const baseline = [{ id: 3, type: "snmp_uptime", params: {} }];
    await expect(applySnmpChanges(1, baseline, [], api)).resolves.toEqual([]);
    const err = await applySnmpChanges(1, [], [{ type: "snmp_uptime", params: {} }], api).catch((e) => e);
    expect(err.baseline).toEqual([]);
  });
});
