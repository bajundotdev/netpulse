import { Badge } from "@/components/ui/badge";
import { resultFor } from "@/features/ports";
import type { LiveDevice, TcpCheckOut } from "@/types";

const CHIP = "font-normal text-white";

export default function PortChips({ device }: { device: LiveDevice }) {
  const tcpChecks = (device.checks ?? []).filter((c): c is TcpCheckOut => c.type === "tcp");
  if (tcpChecks.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tcpChecks.map((check) => {
        const r = resultFor(check, device.results);
        const port = check.params.port;
        if (!r) {
          return (
            <Badge key={check.id} className={`${CHIP} bg-zinc-500`}>
              {port} …
            </Badge>
          );
        }
        return (
          <Badge
            key={check.id}
            className={`${CHIP} ${r.ok ? "bg-emerald-500" : "bg-red-500"}`}
            title={r.ok ? undefined : (r.reason ?? undefined)}
          >
            {port} {r.ok ? "✓" : "✗"}
            {!r.ok && r.reason && <span className="sr-only"> {r.reason}</span>}
          </Badge>
        );
      })}
    </div>
  );
}
