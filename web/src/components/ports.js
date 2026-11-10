export const DC_PRESET_PORTS = [53, 88, 135, 389, 445, 636, 3268, 3389];

export function parsePort(text) {
  const s = String(text).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

export function mergePorts(existing, added) {
  return [...new Set([...existing, ...added])].sort((a, b) => a - b);
}

export function portsOf(checks) {
  return mergePorts(
    [],
    (checks ?? []).filter((c) => c.type === "tcp").map((c) => c.params.port),
  );
}

export function diffChecks(original, ports) {
  const tcp = original.filter((c) => c.type === "tcp");
  const have = new Set(tcp.map((c) => c.params.port));
  const want = new Set(ports);
  return {
    add: ports.filter((p) => !have.has(p)),
    remove: tcp.filter((c) => !want.has(c.params.port)),
  };
}

// Finds the latest result for a tcp check: by check_id, falling back to the tcp/<port> label.
export function resultFor(check, results) {
  const list = results ?? [];
  return (
    list.find((r) => r.check_id === check.id) ??
    list.find((r) => r.check_id == null && r.label === `tcp/${check.params.port}`) ??
    null
  );
}

// Applies the port diff one call at a time. On failure the thrown error carries `baseline`:
// the checks as they now stand on the server, so a retry diffs against the real state.
export async function applyPortChanges(deviceId, baseline, ports, api) {
  let working = [...baseline];
  const { add, remove } = diffChecks(working, ports);
  try {
    for (const port of add) {
      const created = await api.addCheck(deviceId, { type: "tcp", params: { port }, enabled: true });
      working = [...working, created];
    }
    for (const check of remove) {
      await api.deleteCheck(check.id);
      working = working.filter((c) => c.id !== check.id);
    }
  } catch (err) {
    err.baseline = working;
    throw err;
  }
  return working;
}
