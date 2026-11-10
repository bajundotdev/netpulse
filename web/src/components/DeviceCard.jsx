import { Badge, Card } from "react-bootstrap";
import { KIND_LABELS, formatDuration, parseTs, statusVariant } from "./format.js";
import Sparkline from "./Sparkline.jsx";
import { resultFor } from "./ports.js";

export default function DeviceCard({ device, now, onOpen }) {
  const variant = statusVariant(device.status);
  const last = device.latency.length ? device.latency[device.latency.length - 1] : null;
  const since = parseTs(device.since);
  const tcpChecks = (device.checks ?? []).filter((c) => c.type === "tcp");
  const showDuration = since && (device.status === "UP" || device.status === "DEGRADED" || device.status === "DOWN");

  return (
    <Card
      className={`h-100 border-2 border-${variant}`}
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
      <Card.Body className="py-2 px-3">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div className="text-truncate">
            <div className="fw-semibold text-truncate">{device.name}</div>
            <div className="font-monospace small text-body-secondary text-truncate">{device.host}</div>
          </div>
          <Badge bg={variant} text={variant === "warning" ? "dark" : undefined}>
            {device.status}
          </Badge>
        </div>
        <div className="d-flex justify-content-between align-items-end mt-2">
          <div>
            <span className="fs-5 fw-semibold">{last === null ? "-" : Math.round(last)}</span>
            {last !== null && <span className="text-body-secondary small"> ms</span>}
          </div>
          <Sparkline values={device.latency} variant={variant} />
        </div>
        {tcpChecks.length > 0 && (
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
        )}
        <div className="d-flex justify-content-between small text-body-secondary mt-1">
          <span>{KIND_LABELS[device.kind] ?? device.kind}</span>
          {showDuration && (
            <span className={device.status === "DOWN" ? "text-danger fw-semibold" : ""}>
              {device.status} for {formatDuration(now - since.getTime())}
            </span>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
