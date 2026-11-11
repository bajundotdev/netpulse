const LABELS = {
  UP: "Up",
  DEGRADED: "Degraded",
  DOWN: "Down",
  PAUSED: "Paused",
};

const VARIANTS = { UP: "success", DEGRADED: "warning", DOWN: "danger" };

const AXIS = {
  "1h": ["60m ago", "45m", "30m", "15m", "Now"],
  "24h": ["24h ago", "18h", "12h", "6h", "Now"],
  "7d": ["7d ago", "5d", "4d", "2d", "Now"],
};

const time = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });

export function slotTitle(startIso, bucketSeconds, index, status) {
  const from = new Date(Date.parse(startIso) + index * bucketSeconds * 1000);
  const to = new Date(from.getTime() + bucketSeconds * 1000);
  const prefix = bucketSeconds >= 7200 ? `${day(from)} ` : "";
  return `${prefix}${time(from)}–${time(to)} · ${LABELS[status] ?? "No data"}`;
}

export const axisLabels = (range) => AXIS[range] ?? AXIS["24h"];

export const slotVariant = (status) => VARIANTS[status] ?? "secondary";

// A response is only usable for the range it was fetched for.
export const historyForRange = (history, range) => (history?.range === range ? history : null);

export function historyFor(history, deviceId) {
  const row = history?.devices?.find((d) => d.device_id === deviceId);
  return row ? { buckets: row.buckets, uptime_pct: row.uptime_pct } : null;
}

// Returns a guard for fetches: only the most recently started promise settles through it;
// older ones never settle, so a slow stale response cannot overwrite newer data.
export function latestOnly() {
  let latest = 0;
  return (promise) => {
    const mine = ++latest;
    return new Promise((resolve, reject) => {
      promise.then(
        (v) => mine === latest && resolve(v),
        (e) => mine === latest && reject(e),
      );
    });
  };
}

// Footer text for a device's uptime over the range ("99.5% uptime"), or a placeholder.
export function uptimeLabel(entry) {
  const pct = entry?.uptime_pct;
  if (pct == null) return "No history yet";
  return `${Number(pct.toFixed(2))}% uptime`;
}
