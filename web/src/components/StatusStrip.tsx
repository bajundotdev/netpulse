import { memo } from "react";
import { slotTitle, slotVariant, stripSummary } from "@/features/history";
import type { SlotStatus } from "@/types";

type Props = {
  slots: SlotStatus[];
  startIso: string;
  bucketSeconds: number;
  rangeLabel: string;
  height?: number;
};

function StatusStrip({ slots, startIso, bucketSeconds, rangeLabel, height = 24 }: Props) {
  return (
    <div
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}
      role="img"
      aria-label={stripSummary(slots, rangeLabel)}
    >
      {slots.map((status, i) => (
        <div
          key={i}
          className={`${slotVariant(status)} rounded-xs`}
          style={{ height }}
          title={slotTitle(startIso, bucketSeconds, i, status)}
        />
      ))}
    </div>
  );
}

export default memo(StatusStrip);
