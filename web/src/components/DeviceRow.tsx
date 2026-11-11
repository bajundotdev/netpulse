import { Check, ChevronRight, CircleQuestionMark, Pause, TriangleAlert, X, type LucideIcon } from "lucide-react";
import KindIcon from "./KindIcon";
import PortChips from "./PortChips";
import StatusBadge from "./StatusBadge";
import StatusStrip from "./StatusStrip";
import { Button } from "@/components/ui/button";
import { problemLine } from "@/features/deviceView";
import { formatDuration, formatUptime, parseTs, statusVariant } from "@/features/format";
import { RANGE_WORDS, axisLabels, historyFor, slotVariant, uptimeLabel } from "@/features/history";
import { cn } from "@/lib/utils";
import type { DeviceStatus, HistoryOut, LiveDevice, Range, SlotStatus } from "@/types";

const STATUS_WORDS: Partial<Record<DeviceStatus, string>> = {
  UP: "Up",
  DEGRADED: "Degraded",
  DOWN: "Down",
  PAUSED: "Paused",
};

const STATUS_ICONS: Partial<Record<DeviceStatus, LucideIcon>> = {
  UP: Check,
  DEGRADED: TriangleAlert,
  DOWN: X,
  PAUSED: Pause,
};

const LEGEND: [SlotStatus, string][] = [
  ["UP", "Up"],
  ["DEGRADED", "Degraded"],
  ["DOWN", "Down"],
  [null, "Paused / no data"],
];

type Props = {
  device: LiveDevice;
  history: HistoryOut | null | undefined;
  range: Range;
  now: number;
  expanded: boolean;
  onToggle: (id: number) => void;
  onOpen: (id: number) => void;
};

export default function DeviceRow({ device, history, range, now, expanded, onToggle, onOpen }: Props) {
  const variant = statusVariant(device.status);
  const StatusIcon = STATUS_ICONS[device.status] ?? CircleQuestionMark;
  const bodyId = `device-row-body-${device.id}`;
  const problem = problemLine(device);
  const entry = history ? historyFor(history, device.id) : null;
  const slots: SlotStatus[] | null = entry ? entry.buckets : history ? history.overall.status.map(() => null) : null;
  const last = device.latency?.length ? device.latency[device.latency.length - 1] : null;
  const since = parseTs(device.since);
  const snmp = (device.results ?? []).find((r) => r.type === "snmp_uptime" && r.ok && r.value != null);
  const showDuration = since && (device.status === "UP" || device.status === "DEGRADED" || device.status === "DOWN");

  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => onToggle(device.id)}
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 text-muted-foreground", expanded && "rotate-90")}
          aria-hidden="true"
        />
        <KindIcon kind={device.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{device.name}</span>
          {problem ? (
            <span className="block truncate text-sm text-muted-foreground">{problem}</span>
          ) : (
            <span className="block truncate font-mono text-sm text-muted-foreground">{device.host}</span>
          )}
        </span>
        <StatusBadge tone={variant}>
          <StatusIcon aria-hidden="true" />
          {STATUS_WORDS[device.status] ?? "Unknown"}
        </StatusBadge>
      </button>
      {expanded && (
        <div id={bodyId} className="px-3 pb-3">
          {slots && history ? (
            <>
              <div className="mb-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                {LEGEND.map(([status, label]) => (
                  <span key={label} className="inline-flex items-center gap-1">
                    <span className={cn(slotVariant(status), "inline-block size-2.5 rounded-xs")} aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>
              <StatusStrip
                slots={slots}
                startIso={history.start}
                bucketSeconds={history.bucket_seconds}
                rangeLabel={`${device.name}, ${RANGE_WORDS[range]}`}
                height={28}
              />
              <div className="mt-1 flex justify-between text-sm text-muted-foreground">
                <span>{axisLabels(range)[0]}</span>
                <span>{uptimeLabel(entry)}</span>
                <span>Now</span>
              </div>
            </>
          ) : (
            <p className="mb-1 text-sm text-muted-foreground">History loading…</p>
          )}
          <PortChips device={device} />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Latency {last == null ? "–" : `${Math.round(last)} ms`}</span>
            {snmp && <span>Uptime {formatUptime(snmp.value as number | string)}</span>}
            {showDuration && (
              <span className={device.status === "DOWN" ? "font-semibold text-red-500" : ""}>
                {device.status} for {formatDuration(now - since.getTime())}
              </span>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => onOpen(device.id)}>
              Details
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
