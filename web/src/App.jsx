import { useState } from "react";
import { Alert, Col, Container, Row } from "react-bootstrap";
import DeviceDetail from "./components/DeviceDetail.jsx";
import DeviceForm from "./components/DeviceForm.jsx";
import DeviceGrid from "./components/DeviceGrid.jsx";
import EventLog from "./components/EventLog.jsx";
import SummaryStrip from "./components/SummaryStrip.jsx";
import TopBar from "./components/TopBar.jsx";
import { useMonitor } from "./state/MonitorContext.jsx";

export default function App() {
  const { state, reload } = useMonitor();
  const [dismissedError, setDismissedError] = useState(null);
  const [detailId, setDetailId] = useState(null);
  // null = closed, {} = add, {device} = edit
  const [form, setForm] = useState(null);

  const devices = state.order.map((id) => state.devices[id]);
  const detail = detailId !== null ? state.devices[detailId] : null;
  const showError = state.loadError && state.loadError !== dismissedError;

  const onSaved = async () => {
    setForm(null);
    await reload();
  };

  return (
    <>
      <TopBar connected={state.connected} onAdd={() => setForm({})} />
      <Container fluid>
        {showError && (
          <Alert variant="danger" dismissible onClose={() => setDismissedError(state.loadError)}>
            Could not load data from the NetPulse server: {state.loadError}
          </Alert>
        )}
        {state.stale && (
          <Alert variant="warning">
            Lost connection to the NetPulse server — statuses below are stale
          </Alert>
        )}
        <SummaryStrip devices={devices} />
        <Row className="g-3">
          <Col lg={8} className={state.stale ? "opacity-50" : undefined}>
            <DeviceGrid devices={devices} onOpen={setDetailId} />
          </Col>
          <Col lg={4}>
            <EventLog />
          </Col>
        </Row>
      </Container>
      {detail && !form && (
        <DeviceDetail
          device={detail}
          onClose={() => setDetailId(null)}
          onEdit={(device) => setForm({ device })}
        />
      )}
      {form && <DeviceForm device={form.device} onSaved={onSaved} onClose={() => setForm(null)} />}
    </>
  );
}
