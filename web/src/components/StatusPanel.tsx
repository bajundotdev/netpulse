import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import ProblemsChart from "./ProblemsChart";
import StatusStrip from "./StatusStrip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { headline } from "@/features/deviceView";
import type { Variant } from "@/features/format";
import { RANGE_WORDS, axisLabels } from "@/features/history";
import { cn } from "@/lib/utils";
import type { HistoryOut, LiveDevice, Range } from "@/types";

const RANGES: Range[] = ["1h", "24h", "7d"];

const ICONS: Record<Variant, typeof CircleCheck> = {
  danger: CircleX,
  warning: TriangleAlert,
  success: CircleCheck,
  secondary: CircleCheck,
};

const TEXT: Record<Variant, string> = {
  danger: "text-red-500",
  warning: "text-amber-500",
  success: "text-emerald-500",
  secondary: "text-muted-foreground",
};

type Props = {
  devices: LiveDevice[];
  history: HistoryOut | null | undefined;
  range: Range;
  onRange: (range: Range) => void;
  error?: unknown; // any truthy value (the history fetch error) means the fetch failed
  stale?: boolean;
};

export default function StatusPanel({ devices, history, range, onRange, error, stale }: Props) {
  const { text, variant } = headline(devices);
  const Icon = ICONS[variant];
  const n = history?.problems_last_hour;
  const sub = n == null ? null : `${n} ${n === 1 ? "problem" : "problems"} in the last hour`;
  return (
    <div
      className={cn(
        "mb-3 rounded-xl border bg-linear-to-br from-sky-50 to-emerald-50 p-4 dark:from-sky-950 dark:to-emerald-950",
        stale && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={TEXT[variant]}>
            <Icon className="size-10" strokeWidth={2} aria-hidden="true" />
          </span>
          <div>
            <div className="text-3xl leading-none font-bold text-foreground">{text}</div>
            {sub && <div className="mt-1 text-muted-foreground">{sub}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {history && Boolean(error) && <span className="text-sm text-muted-foreground">History may be out of date</span>}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={range}
            onValueChange={(v) => v && onRange(v as Range)}
            aria-label="History range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r}>
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      {history ? (
        <div className="mt-3">
          <ProblemsChart
            values={history.overall.problems}
            label={`Devices with problems over the last ${RANGE_WORDS[range]}`}
          />
          <div className="flex justify-between text-sm text-muted-foreground">
            {axisLabels(range).map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div className="mt-2 mb-1 text-sm text-muted-foreground">Status</div>
          <StatusStrip
            slots={history.overall.status}
            startIso={history.start}
            bucketSeconds={history.bucket_seconds}
            rangeLabel={RANGE_WORDS[range]}
            height={20}
          />
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">{error ? "History unavailable" : "Loading history…"}</div>
      )}
    </div>
  );
}
