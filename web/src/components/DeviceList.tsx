import { useState } from "react";
import DeviceRow from "./DeviceRow";
import type { HistoryOut, LiveDevice, Range } from "@/types";

type Props = {
  devices: LiveDevice[];
  history: HistoryOut | null | undefined;
  range: Range;
  now: number;
  onOpen: (id: number) => void;
};

export default function DeviceList({ devices, history, range, now, onOpen }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  if (devices.length === 0) {
    return <p className="text-muted-foreground">No devices yet. Use "Add device" to start monitoring.</p>;
  }
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {devices.map((d) => (
        <DeviceRow
          key={d.id}
          device={d}
          history={history}
          range={range}
          now={now}
          expanded={expanded.has(d.id)}
          onToggle={toggle}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
