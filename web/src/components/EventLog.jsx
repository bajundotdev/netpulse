import { useState } from "react";
import { Alert, Badge, Button, Card, Form, Table } from "react-bootstrap";
import { ackEvent, clearEvents } from "../api.js";
import { useMonitor } from "../state/MonitorContext.jsx";
import { formatEventTime, severityVariant } from "./format.js";

export default function EventLog() {
  const { state, dispatch } = useMonitor();
  const [deviceFilter, setDeviceFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [error, setError] = useState(null);

  const events = state.events.filter(
    (e) =>
      (deviceFilter === "" || String(e.device_id) === deviceFilter) &&
      (severityFilter === "" || e.severity === severityFilter),
  );

  const fail = (err) => setError(err.message ?? String(err));

  const onAck = async (id) => {
    try {
      await ackEvent(id);
      dispatch({ type: "EVENT_ACKED", id });
    } catch (err) {
      fail(err);
    }
  };

  const onClear = async () => {
    if (!window.confirm("Clear the whole event log? This cannot be undone.")) return;
    try {
      await clearEvents();
      dispatch({ type: "EVENTS_CLEARED" });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Card>
      <Card.Header className="d-flex flex-wrap gap-2 align-items-center">
        <strong className="me-auto">Event log</strong>
        <Form.Select size="sm" style={{ width: "auto" }} aria-label="Filter by device" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
          <option value="">All devices</option>
          {state.order.map((id) => (
            <option key={id} value={id}>
              {state.devices[id].name}
            </option>
          ))}
        </Form.Select>
        <Form.Select size="sm" style={{ width: "auto" }} aria-label="Filter by severity" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </Form.Select>
        <Button size="sm" variant="outline-danger" onClick={onClear} disabled={state.events.length === 0}>
          Clear
        </Button>
      </Card.Header>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="m-2 mb-0">
          {error}
        </Alert>
      )}
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <Table size="sm" hover className="mb-0 align-middle">
          <tbody>
            {events.length === 0 && (
              <tr>
                <td className="text-body-secondary p-3">No events.</td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className={e.acknowledged ? "text-body-secondary" : ""}>
                <td className="text-nowrap small font-monospace">{formatEventTime(e.ts)}</td>
                <td>
                  <Badge bg={severityVariant(e.severity)} text={e.severity === "warning" ? "dark" : undefined}>
                    {e.severity}
                  </Badge>
                </td>
                <td className="small">{e.message}</td>
                <td className="text-end">
                  {!e.acknowledged && (
                    <Button size="sm" variant="outline-secondary" onClick={() => onAck(e.id)}>
                      Ack
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
