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
