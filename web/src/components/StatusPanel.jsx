import { Button, ButtonGroup } from "react-bootstrap";
import ProblemsChart from "./ProblemsChart.jsx";
import StatusStrip from "./StatusStrip.jsx";
import { headline } from "./deviceView.js";
import { RANGE_WORDS, axisLabels } from "./history.js";

const RANGES = ["1h", "24h", "7d"];

function Icon({ variant }) {
  const common = {
    width: 40,
    height: 40,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (variant === "danger") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg {...common}>
        <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export default function StatusPanel({ devices, history, range, onRange, error, stale }) {
  const { text, variant } = headline(devices);
  const n = history?.problems_last_hour;
  const sub = n == null ? null : `${n} ${n === 1 ? "problem" : "problems"} in the last hour`;
  const labels = axisLabels(range);
  return (
    <div className={`np-status-panel rounded-3 p-3 mb-3${stale ? " opacity-50" : ""}`}>
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div className="d-flex align-items-center gap-3">
          <span className={`text-${variant}`}>
            <Icon variant={variant} />
          </span>
          <div>
            <div className="fs-2 fw-bold lh-1" style={{ color: "var(--bs-emphasis-color)" }}>
              {text}
            </div>
            {sub && (
              <div className="mt-1" style={{ color: "var(--bs-secondary-color)" }}>
                {sub}
              </div>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          {history && error && (
            <span className="small" style={{ color: "var(--bs-secondary-color)" }}>
              History may be out of date
            </span>
          )}
          <ButtonGroup size="sm" aria-label="History range">
            {RANGES.map((r) => (
              <Button
                key={r}
                variant="outline-secondary"
                active={r === range}
                aria-pressed={r === range}
                onClick={() => onRange(r)}
              >
                {r}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>
      {history ? (
        <div className="mt-3">
          <ProblemsChart
            values={history.overall.problems}
            label={`Devices with problems over the last ${RANGE_WORDS[range]}`}
          />
          <div className="d-flex justify-content-between small" style={{ color: "var(--bs-secondary-color)" }}>
            {labels.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div className="small mt-2 mb-1" style={{ color: "var(--bs-secondary-color)" }}>
            Status
          </div>
          <StatusStrip
            slots={history.overall.status}
            startIso={history.start}
            bucketSeconds={history.bucket_seconds}
            rangeLabel={RANGE_WORDS[range]}
            height={20}
          />
        </div>
      ) : (
        <div className="small mt-3" style={{ color: "var(--bs-secondary-color)" }}>
          {error ? "History unavailable" : "Loading history…"}
        </div>
      )}
    </div>
  );
}
