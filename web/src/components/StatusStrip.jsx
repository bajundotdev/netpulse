import { slotTitle, slotVariant } from "./history.js";

const BG = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  secondary: "bg-secondary-subtle",
};

export default function StatusStrip({ slots, startIso, bucketSeconds, height = 24 }) {
  return (
    <div
      className="np-strip"
      style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}
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
