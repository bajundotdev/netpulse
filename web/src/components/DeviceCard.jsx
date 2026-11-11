import { Badge, Card } from "react-bootstrap";
import { KIND_LABELS, formatDuration, formatUptime, parseTs, statusVariant } from "./format.js";
import Sparkline from "./Sparkline.jsx";
import PortChips from "./PortChips.jsx";

export default function DeviceCard({ device, now, onOpen }) {
  const variant = statusVariant(device.status);
  const last = device.latency.length ? device.latency[device.latency.length - 1] : null;
  const since = parseTs(device.since);
  const uptime = (device.results ?? []).find((r) => r.type === "snmp_uptime" && r.ok && r.value != null);
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
        <PortChips device={device} />
        {uptime && <div className="small text-body-secondary mt-1">Uptime {formatUptime(uptime.value)}</div>}
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
