import { Badge } from "react-bootstrap";
import { resultFor } from "@/features/ports";

export default function PortChips({ device }) {
  const tcpChecks = (device.checks ?? []).filter((c) => c.type === "tcp");
  if (tcpChecks.length === 0) return null;
  return (
    <div className="d-flex flex-wrap gap-1 mt-2">
      {tcpChecks.map((check) => {
        const r = resultFor(check, device.results);
        const port = check.params.port;
        if (!r) {
          return (
            <Badge key={check.id} bg="secondary" className="fw-normal">
              {port} …
            </Badge>
          );
        }
        return (
          <Badge key={check.id} bg={r.ok ? "success" : "danger"} className="fw-normal" title={r.ok ? undefined : (r.reason ?? undefined)}>
            {port} {r.ok ? "✓" : "✗"}
            {!r.ok && r.reason && <span className="visually-hidden"> {r.reason}</span>}
          </Badge>
        );
      })}
    </div>
  );
}
