import HttpChips from "./HttpChips";
import PortChips from "./PortChips";
import Sparkline from "./Sparkline";
import StatusBadge, { STATUS_RING } from "./StatusBadge";
import { Card } from "@/components/ui/card";
import { KIND_LABELS, formatDuration, formatUptime, parseTs, statusVariant } from "@/features/format";
import { cn } from "@/lib/utils";
import type { LiveDevice } from "@/types";

type Props = { device: LiveDevice; now: number; onOpen: (id: number) => void };

export default function DeviceCard({ device, now, onOpen }: Props) {
  const variant = statusVariant(device.status);
  const last = device.latency.length ? device.latency[device.latency.length - 1] : null;
  const since = parseTs(device.since);
  const uptime = (device.results ?? []).find((r) => r.type === "snmp_uptime" && r.ok && r.value != null);
  const showDuration = since && (device.status === "UP" || device.status === "DEGRADED" || device.status === "DOWN");

  return (
    <Card
      size="sm"
      className={cn(
        "h-full cursor-pointer gap-0 outline-none focus-visible:ring-3 focus-visible:ring-ring",
        STATUS_RING[variant],
      )}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(device.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(device.id);
        }
      }}
    >
      <div className="px-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">{device.name}</div>
            <div className="truncate font-mono text-sm text-muted-foreground">{device.host}</div>
          </div>
          <StatusBadge tone={variant}>{device.status}</StatusBadge>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <span className="text-xl font-semibold">{last == null ? "-" : Math.round(last)}</span>
            {last != null && <span className="text-sm text-muted-foreground"> ms</span>}
          </div>
          <Sparkline values={device.latency} variant={variant} />
        </div>
        <PortChips device={device} />
        <HttpChips device={device} />
        {uptime && <div className="mt-1 text-sm text-muted-foreground">Uptime {formatUptime(uptime.value as number | string)}</div>}
        <div className="mt-1 flex justify-between text-sm text-muted-foreground">
          <span>{KIND_LABELS[device.kind] ?? device.kind}</span>
          {showDuration && (
            <span className={device.status === "DOWN" ? "font-semibold text-red-500" : ""}>
              {device.status} for {formatDuration(now - since.getTime())}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
