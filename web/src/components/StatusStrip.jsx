import { memo } from "react";
import { slotTitle, slotVariant, stripSummary } from "./history.js";

const BG = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  secondary: "bg-body-secondary",
};

function StatusStrip({ slots, startIso, bucketSeconds, rangeLabel, height = 24 }) {
  return (
    <div
      className="np-strip"
      style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}
      role="img"
      aria-label={stripSummary(slots, rangeLabel)}
    >
      {slots.map((status, i) => (
        <div
          key={i}
          className={`${BG[slotVariant(status)]} rounded-1`}
          style={{ height }}
          title={slotTitle(startIso, bucketSeconds, i, status)}
        />
      ))}
    </div>
  );
}

export default memo(StatusStrip);
