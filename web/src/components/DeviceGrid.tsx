import DeviceCard from "./DeviceCard";
import type { LiveDevice } from "@/types";

type Props = { devices: LiveDevice[]; now: number; onOpen: (id: number) => void };

export default function DeviceGrid({ devices, now, onOpen }: Props) {
  if (devices.length === 0) {
    return <p className="text-muted-foreground">No devices yet. Use "Add device" to start monitoring.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {devices.map((d) => (
        <DeviceCard key={d.id} device={d} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}
