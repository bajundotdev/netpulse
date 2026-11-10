import { Col, Row } from "react-bootstrap";

const ITEMS = [
  ["UP", "Up", "success"],
  ["DEGRADED", "Degraded", "warning"],
  ["DOWN", "Down", "danger"],
  ["PAUSED", "Paused", "secondary"],
];

export default function SummaryStrip({ devices }) {
  const counts = {};
  for (const d of devices) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return (
    <Row className="g-2 mb-3">
      {ITEMS.map(([status, label, variant]) => (
        <Col key={status} xs={6} md={3}>
          <div className={`border border-${variant} rounded px-3 py-2 d-flex justify-content-between align-items-baseline`}>
            <span className="text-body-secondary small text-uppercase">{label}</span>
            <span className="fs-4 fw-semibold lh-1">{counts[status] ?? 0}</span>
          </div>
        </Col>
      ))}
    </Row>
  );
}
