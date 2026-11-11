import type { HistoryOut, Range, SlotStatus } from "@/types";
import type { Variant } from "./format";

const LABELS = {
  UP: "Up",
  DEGRADED: "Degraded",
  DOWN: "Down",
  PAUSED: "Paused",
};

const VARIANTS: Record<string, Variant> = { UP: "success", DEGRADED: "warning", DOWN: "danger" };

export const RANGE_WORDS: Record<Range, string> = { "1h": "hour", "24h": "24 hours", "7d": "7 days" };

const AXIS: Record<Range, string[]> = {
  "1h": ["60m ago", "45m", "30m", "15m", "Now"],
  "24h": ["24h ago", "18h", "12h", "6h", "Now"],
  "7d": ["7d ago", "5d", "4d", "2d", "Now"],
};

const TIME_FMT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
const time = (d: Date) => TIME_FMT.format(d);
const day = (d: Date) => DAY_FMT.format(d);

export function slotTitle(startIso: string, bucketSeconds: number, index: number, status: SlotStatus): string {
  const from = new Date(Date.parse(startIso) + index * bucketSeconds * 1000);
  const to = new Date(from.getTime() + bucketSeconds * 1000);
  const prefix = bucketSeconds >= 7200 ? `${day(from)} ` : "";
  return `${prefix}${time(from)}–${time(to)} · ${(status ? LABELS[status] : undefined) ?? "No data"}`;
}

export const axisLabels = (range: Range): string[] => AXIS[range] ?? AXIS["24h"];

export const slotVariant = (status: SlotStatus): Variant => (status ? VARIANTS[status] : undefined) ?? "secondary";

// A response is only usable for the range it was fetched for.
export const historyForRange = (history: HistoryOut | null | undefined, range: Range): HistoryOut | null => (history?.range === range ? history : null);

export function historyFor(
  history: HistoryOut | null | undefined,
  deviceId: number,
): { buckets: SlotStatus[]; uptime_pct: number | null } | null {
  const row = history?.devices?.find((d) => d.device_id === deviceId);
  return row ? { buckets: row.buckets, uptime_pct: row.uptime_pct } : null;
}

// Returns a guard for fetches: only the most recently started promise settles through it;
// older ones never settle, so a slow stale response cannot overwrite newer data.
export function latestOnly(): <T>(promise: Promise<T>) => Promise<T> {
  let latest = 0;
  return <T>(promise: Promise<T>): Promise<T> => {
    const mine = ++latest;
    return new Promise<T>((resolve, reject) => {
      promise.then(
        (v) => mine === latest && resolve(v),
        (e) => mine === latest && reject(e),
      );
    });
  };
}

// Footer text for a device's uptime over the range ("99.5% uptime"), or a placeholder.
export function uptimeLabel(entry: { uptime_pct: number | null } | null | undefined): string {
  const pct = entry?.uptime_pct;
  if (pct == null) return "No history yet";
  return `${Number(pct.toFixed(2))}% uptime`;
}

// Calls fn once, `ms` after the last call. cancel() drops a pending call.
export function createDebouncer(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
  run.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return run;
}

// Text alternative for a status strip: "24 hours: 2 slots down, 1 degraded".
export function stripSummary(slots: SlotStatus[], rangeLabel: string): string {
  const down = slots.filter((s) => s === "DOWN").length;
  const degraded = slots.filter((s) => s === "DEGRADED").length;
  const parts: string[] = [];
  if (down) parts.push(`${down} ${down === 1 ? "slot" : "slots"} down`);
  if (degraded) parts.push(`${degraded} degraded`);
  return `${rangeLabel}: ${parts.length ? parts.join(", ") : "all up"}`;
}
