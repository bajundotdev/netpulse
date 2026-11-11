import { Badge, Button, ListGroup } from "react-bootstrap";
import KindIcon from "./KindIcon.jsx";
import PortChips from "./PortChips.jsx";
import StatusStrip from "./StatusStrip.jsx";
import { problemLine } from "./deviceView.js";
import { formatDuration, formatUptime, parseTs, statusVariant } from "./format.js";
import { axisLabels, historyFor, uptimeLabel } from "./history.js";

const STATUS_WORDS = {
  UP: "Up",
  DEGRADED: "Degraded",
  DOWN: "Down",
  PAUSED: "Paused",
};

const ICON_PATHS = {
  UP: <path d="M3 8.5l3.2 3L13 4.5" />,
  DEGRADED: <path d="M8 3v6M8 12.5h.01" />,
  DOWN: <path d="M4 4l8 8M12 4l-8 8" />,
  PAUSED: <path d="M5.5 3.5v9M10.5 3.5v9" />,
};

function StatusIcon({ status }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[status] ?? <path d="M6 6.2a2 2 0 113 1.7c-.7.4-1 .8-1 1.6M8 12h.01" />}
    </svg>
  );
}

const LEGEND = [
  ["bg-success", "Up"],
  ["bg-warning", "Degraded"],
  ["bg-danger", "Down"],
  ["bg-secondary-subtle", "Paused / no data"],
];

function Chevron({ expanded }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 text-body-secondary"
      style={{ transform: expanded ? "rotate(90deg)" : undefined }}
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export default function DeviceRow({ device, history, range, now, expanded, onToggle, onOpen }) {
  const variant = statusVariant(device.status);
  const bodyId = `device-row-body-${device.id}`;
  const problem = problemLine(device);
  const entry = history ? historyFor(history, device.id) : null;
  const slots = entry ? entry.buckets : history ? history.overall.status.map(() => null) : null;
  const last = device.latency?.length ? device.latency[device.latency.length - 1] : null;
  const since = parseTs(device.since);
  const snmp = (device.results ?? []).find((r) => r.type === "snmp_uptime" && r.ok && r.value != null);
  const showDuration = since && (device.status === "UP" || device.status === "DEGRADED" || device.status === "DOWN");

  return (
    <ListGroup.Item className="p-0">
      <button
        type="button"
        className="btn w-100 text-start d-flex align-items-center gap-3 py-2 px-3 border-0"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => onToggle(device.id)}
      >
        <Chevron expanded={expanded} />
        <KindIcon kind={device.kind} />
        <span className="flex-grow-1 text-truncate">
          <span className="d-block fw-semibold text-truncate">{device.name}</span>
          {problem ? (
            <span className="d-block small text-body-secondary text-truncate">{problem}</span>
          ) : (
            <span className="d-block small font-monospace text-body-secondary text-truncate">{device.host}</span>
          )}
        </span>
        <Badge bg={variant} text={variant === "warning" ? "dark" : undefined} className="d-inline-flex align-items-center gap-1">
          <StatusIcon status={device.status} />
          {STATUS_WORDS[device.status] ?? "Unknown"}
        </Badge>
      </button>
      {expanded && (
        <div id={bodyId} className="px-3 pb-3">
          {slots ? (
            <>
              <div className="d-flex flex-wrap gap-3 small text-body-secondary mb-1">
                {LEGEND.map(([cls, label]) => (
                  <span key={label} className="d-inline-flex align-items-center gap-1">
                    <span className={`${cls} rounded-1 d-inline-block`} style={{ width: 10, height: 10 }} />
                    {label}
                  </span>
                ))}
              </div>
              <StatusStrip slots={slots} startIso={history.start} bucketSeconds={history.bucket_seconds} height={28} />
              <div className="d-flex justify-content-between small text-body-secondary mt-1">
                <span>{axisLabels(range)[0]}</span>
                <span>{uptimeLabel(entry)}</span>
                <span>Now</span>
              </div>
            </>
          ) : (
            <p className="small text-body-secondary mb-1">History loading…</p>
          )}
          <PortChips device={device} />
          <div className="d-flex flex-wrap align-items-center gap-3 small text-body-secondary mt-2">
            <span>Latency {last === null ? "–" : `${Math.round(last)} ms`}</span>
            {snmp && <span>Uptime {formatUptime(snmp.value)}</span>}
            {showDuration && (
              <span className={device.status === "DOWN" ? "text-danger fw-semibold" : ""}>
                {device.status} for {formatDuration(now - since.getTime())}
              </span>
            )}
            <Button size="sm" variant="outline-secondary" className="ms-auto" onClick={() => onOpen(device.id)}>
              Details
            </Button>
          </div>
        </div>
      )}
    </ListGroup.Item>
  );
}
