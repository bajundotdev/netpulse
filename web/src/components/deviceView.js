import { KIND_LABELS } from "./format.js";

export const SORT_OPTIONS = [
  { key: "problems", label: "Problems first" },
  { key: "name", label: "Name" },
  { key: "host", label: "Host" },
  { key: "latency", label: "Latency" },
];

const STATUS_ORDER = ["DOWN", "DEGRADED", "UNKNOWN", "UP", "PAUSED"];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function statusRank(status) {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length : i;
}

function ipv4Parts(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host).trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// IPv4 addresses numerically first, then hostnames alphabetically.
export function compareHosts(a, b) {
  const pa = ipv4Parts(a);
  const pb = ipv4Parts(b);
  if (pa && pb) {
    for (let i = 0; i < 4; i += 1) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  }
  if (pa) return -1;
  if (pb) return 1;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

function latestLatency(device) {
  const list = device.latency ?? [];
  const last = list.length ? list[list.length - 1] : null;
  return typeof last === "number" ? last : null;
}

export function filterDevices(devices, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return devices;
  return devices.filter((d) => {
    const ports = (d.checks ?? []).filter((c) => c.type === "tcp").map((c) => String(c.params.port));
    const fields = [d.name, d.host, KIND_LABELS[d.kind] ?? d.kind, d.status, d.notes];
    return (
      fields.some((f) => f != null && String(f).toLowerCase().includes(q)) || ports.includes(q)
    );
  });
}

export function sortDevices(devices, key) {
  const list = [...devices];
  switch (key) {
    case "name":
      return list.sort(byName);
    case "host":
      return list.sort((a, b) => compareHosts(a.host, b.host) || byName(a, b));
    case "latency":
      return list.sort((a, b) => {
        const la = latestLatency(a);
        const lb = latestLatency(b);
        if (la === null && lb === null) return byName(a, b);
        if (la === null) return 1;
        if (lb === null) return -1;
        return la - lb || byName(a, b);
      });
    default:
      return list.sort((a, b) => statusRank(a.status) - statusRank(b.status) || byName(a, b));
  }
}

export function problemLine(device) {
  const results = device.results ?? [];
  if (device.status === "DOWN") {
    const r = results.find((x) => x.check_id == null && !x.ok);
    return r ? `DOWN (${r.label}: ${r.reason ?? "failed"})` : "DOWN";
  }
  if (device.status === "DEGRADED") {
    const failing = results.filter((x) => x.check_id != null && !x.ok);
    if (failing.length === 0) return "DEGRADED";
    return `DEGRADED: ${failing.map((x) => `${x.label} ${x.reason ?? "failed"}`).join(", ")}`;
  }
  return null;
}

const plural = (n) => (n === 1 ? "device" : "devices");

export function headline(devices) {
  if (devices.length === 0) return { text: "No devices yet", variant: "secondary" };
  const count = (s) => devices.filter((d) => d.status === s).length;
  const down = count("DOWN");
  const degraded = count("DEGRADED");
  const up = count("UP");
  if (down > 0) return { text: `${down} ${plural(down)} down`, variant: "danger" };
  if (degraded > 0) return { text: `${degraded} ${plural(degraded)} degraded`, variant: "warning" };
  const active = devices.filter((d) => d.status !== "PAUSED").length;
  if (active === 0) return { text: "All devices paused", variant: "secondary" };
  if (up > 0 && up === active) return { text: `All ${up} ${plural(up)} up`, variant: "success" };
  return { text: `${up} of ${active} ${plural(active)} up`, variant: "secondary" };
}
