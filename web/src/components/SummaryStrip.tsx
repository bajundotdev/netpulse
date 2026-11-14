import type { DeviceStatus, LiveDevice } from "@/types";

const ITEMS: readonly { status: DeviceStatus; label: string; border: string }[] = [
  { status: "UP", label: "Up", border: "border-emerald-500" },
  { status: "DEGRADED", label: "Degraded", border: "border-amber-500" },
  { status: "DOWN", label: "Down", border: "border-red-500" },
  { status: "PAUSED", label: "Paused", border: "border-zinc-300 dark:border-zinc-700" },
];

export default function SummaryStrip({ devices }: { devices: LiveDevice[] }) {
  const counts: Partial<Record<DeviceStatus, number>> = {};
  for (const d of devices) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
      {ITEMS.map(({ status, label, border }) => (
        <div
          key={status}
          className={`flex items-baseline justify-between rounded-md border px-3 py-2 ${border}`}
        >
          <span className="text-xs uppercase text-muted-foreground">{label}</span>
          <span className="text-2xl leading-none font-semibold">{counts[status] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
