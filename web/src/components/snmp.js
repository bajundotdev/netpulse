export const SNMP_TYPES = ["snmp_uptime", "snmp_if", "snmp_oid"];

export const EMPTY_SNMP = {
  version: "off",
  port: "161",
  community: "",
  user: "",
  authProto: "none",
  authKey: "",
  privProto: "none",
  privKey: "",
  uptime: false,
  interfaces: false,
  ifIndexes: "",
  oids: [],
};

export function newOidRow() {
  return { oid: "", label: "", mode: "change", op: ">", value: "" };
}

// Form state for an existing device. Stored secrets are never read back, only their has_* flags.
export function snmpFormOf(device) {
  const checks = device?.checks ?? [];
  const ifCheck = checks.find((c) => c.type === "snmp_if");
  const s = device?.snmp;
  return {
    ...EMPTY_SNMP,
    version: s ? s.version : "off",
    port: s ? String(s.port) : "161",
    user: s?.user ?? "",
    authProto: s?.auth_proto ?? "none",
    privProto: s?.priv_proto ?? "none",
    uptime: checks.some((c) => c.type === "snmp_uptime"),
    interfaces: !!ifCheck,
    ifIndexes: (ifCheck?.params?.if_indexes ?? []).join(", "),
    oids: checks
      .filter((c) => c.type === "snmp_oid")
      .map((c) => ({
        oid: c.params.oid,
        label: c.params.label ?? "",
        mode: c.params.mode,
        op: c.params.op ?? ">",
        value: c.params.value == null ? "" : String(c.params.value),
      })),
  };
}

export function parseIfIndexes(text) {
  const parts = String(text).split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  return [...new Set(parts.map(Number))].sort((a, b) => a - b);
}

// SnmpIn payload, or null for "Off". Blank secrets are omitted so the backend keeps the stored ones.
export function buildSnmpPayload(form) {
  if (form.version !== "v2c" && form.version !== "v3") return null;
  const payload = { version: form.version, port: Number(form.port || 161) };
  if (form.version === "v2c") {
    if (form.community) payload.community = form.community;
    return payload;
  }
  payload.user = form.user;
  payload.auth_proto = form.authProto;
  payload.priv_proto = form.privProto;
  if (form.authKey && form.authProto !== "none") payload.auth_key = form.authKey;
  if (form.privKey && form.privProto !== "none") payload.priv_key = form.privKey;
  return payload;
}

// Desired SNMP checks as [{type, params}] from the form; throws Error with a message on bad input.
export function desiredSnmpChecks(form) {
  if (form.version === "off") return [];
  const out = [];
  if (form.uptime) out.push({ type: "snmp_uptime", params: {} });
  if (form.interfaces) {
    const idx = parseIfIndexes(form.ifIndexes);
    if (idx === null) throw new Error("Interface indexes must be whole numbers separated by commas");
    out.push({ type: "snmp_if", params: idx.length ? { if_indexes: idx } : {} });
  }
  const seen = new Map();
  for (const row of form.oids) {
    const oid = row.oid.trim();
    if (oid === "" && row.label.trim() === "") continue;
    const params = { oid, label: row.label.trim() || oid, mode: row.mode };
    if (row.mode === "threshold") {
      const value = Number(row.value);
      if (row.value.trim() === "" || Number.isNaN(value)) {
        throw new Error(`OID ${oid || "(blank)"}: threshold needs a numeric value`);
      }
      params.op = row.op;
      params.value = value;
    }
    seen.set(oid, params);
  }
  for (const params of seen.values()) out.push({ type: "snmp_oid", params });
  return out;
}

const keyOf = (type, params) => (type === "snmp_oid" ? `snmp_oid:${params.oid}` : type);

export function diffSnmpChecks(baseline, desired) {
  const have = new Map(
    baseline.filter((c) => SNMP_TYPES.includes(c.type)).map((c) => [keyOf(c.type, c.params), c]),
  );
  const want = new Map(desired.map((d) => [keyOf(d.type, d.params), d]));
  const add = [];
  const update = [];
  for (const [key, d] of want) {
    const cur = have.get(key);
    if (!cur) add.push(d);
    else if (JSON.stringify(cur.params) !== JSON.stringify(d.params)) update.push({ id: cur.id, ...d });
  }
  const remove = [...have].filter(([key]) => !want.has(key)).map(([, c]) => c);
  return { add, update, remove };
}

// Applies the SNMP check diff one call at a time (tcp checks are left alone). On failure the thrown
// error carries `baseline`: the checks as they now stand on the server.
export async function applySnmpChanges(deviceId, baseline, desired, api) {
  let working = [...baseline];
  const { add, update, remove } = diffSnmpChecks(working, desired);
  try {
    for (const c of remove) {
      await api.deleteCheck(c.id);
      working = working.filter((w) => w.id !== c.id);
    }
    for (const u of update) {
      const saved = await api.updateCheck(u.id, { type: u.type, params: u.params, enabled: true });
      working = working.map((w) => (w.id === u.id ? saved : w));
    }
    for (const a of add) {
      const created = await api.addCheck(deviceId, { type: a.type, params: a.params, enabled: true });
      working = [...working, created];
    }
  } catch (err) {
    err.baseline = working;
    throw err;
  }
  return working;
}
