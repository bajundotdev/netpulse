import { Col, Row } from "react-bootstrap";
import DeviceCard from "./DeviceCard.jsx";

export default function DeviceGrid({ devices, now, onOpen }) {
  if (devices.length === 0) {
    return <p className="text-body-secondary">No devices yet. Use "Add device" to start monitoring.</p>;
  }
  return (
    <Row xs={1} sm={2} xl={3} className="g-2">
      {devices.map((d) => (
        <Col key={d.id}>
          <DeviceCard device={d} now={now} onOpen={onOpen} />
        </Col>
      ))}
    </Row>
  );
}
