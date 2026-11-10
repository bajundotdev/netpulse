export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function statusVariant(status) {
  switch (status) {
    case "UP":
      return "success";
    case "DEGRADED":
      return "warning";
    case "DOWN":
      return "danger";
    default:
      return "secondary";
  }
}

export function severityVariant(severity) {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "secondary";
  }
}

// Server timestamps are UTC; treat a value without a zone designator as UTC.
export function parseTs(ts) {
  if (!ts) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(ts);
  const d = new Date(hasZone ? ts : `${ts}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEventTime(ts, now = new Date()) {
  const d = parseTs(ts);
  if (!d) return "";
  const time = d.toLocaleTimeString([], { hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString()} ${time}`;
}

export const KIND_LABELS = {
  dc: "Domain controller",
  server: "Server",
  switch: "Switch",
  printer: "Printer",
  other: "Other",
};

// sysUpTime ticks are 1/100 s.
export function formatUptime(ticks) {
  const total = Math.max(0, Math.floor(Number(ticks) / 100));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Detail text for a check result value: interface maps become "name status" lists.
export function formatResultValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    return Object.values(value)
      .map((v) => (v && typeof v === "object" ? `${v.name ?? ""} ${v.status ?? ""}`.trim() : String(v)))
      .join(", ");
  }
  return String(value);
}
