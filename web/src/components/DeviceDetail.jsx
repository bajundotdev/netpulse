import { useState } from "react";
import { Alert, Badge, Button, Modal, Table } from "react-bootstrap";
import { deleteDevice, testDevice, updateDevice } from "../api.js";
import { useMonitor } from "../state/MonitorContext.jsx";
import { KIND_LABELS, formatResultValue, statusVariant } from "./format.js";

function ResultsTable({ results }) {
  if (!results || results.length === 0) return <p className="text-body-secondary small mb-0">No results yet.</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead>
        <tr>
          <th>Check</th>
          <th>Result</th>
          <th className="text-end">Latency</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r, i) => (
          <tr key={`${r.check_id ?? r.type}-${i}`}>
            <td>{r.label}</td>
            <td>
              <Badge bg={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "FAIL"}</Badge>
            </td>
            <td className="text-end font-monospace">{r.latency_ms == null ? "-" : `${Math.round(r.latency_ms)} ms`}</td>
            <td className="small">{r.reason ?? formatResultValue(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function DeviceDetail({ device, onClose, onEdit }) {
  const { dispatch, reload } = useMonitor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tested, setTested] = useState(null);
  const variant = statusVariant(device.status);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(typeof err.detail === "string" ? err.detail : (err.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = () =>
    run(async () => {
      await updateDevice(device.id, { enabled: !device.enabled });
      await reload();
    });

  const onTest = () =>
    run(async () => {
      setTested(await testDevice(device.id));
    });

  const onDelete = () => {
    if (!window.confirm(`Delete ${device.name}? Its checks are removed too.`)) return;
    run(async () => {
      await deleteDevice(device.id);
      dispatch({ type: "DEVICE_REMOVED", id: device.id });
      onClose();
      await reload();
    });
  };

  return (
    <Modal show onHide={onClose} size="lg">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5 d-flex align-items-center gap-2">
          {device.name}
          <Badge bg={variant} text={variant === "warning" ? "dark" : undefined}>
            {device.status}
          </Badge>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <dl className="row small mb-3">
          <dt className="col-4 col-sm-3">Host</dt>
          <dd className="col-8 col-sm-9 font-monospace">{device.host}</dd>
          <dt className="col-4 col-sm-3">Kind</dt>
          <dd className="col-8 col-sm-9">{KIND_LABELS[device.kind] ?? device.kind}</dd>
          <dt className="col-4 col-sm-3">Liveness</dt>
          <dd className="col-8 col-sm-9">
            {device.liveness === "tcp" ? `TCP port ${device.liveness_port}` : "Ping"}, every {device.interval_s}s, down after{" "}
            {device.fail_threshold} failures, {device.timeout_ms} ms timeout
          </dd>
          {device.notes && (
            <>
              <dt className="col-4 col-sm-3">Notes</dt>
              <dd className="col-8 col-sm-9">{device.notes}</dd>
            </>
          )}
        </dl>
        <h3 className="h6">Latest results</h3>
        <ResultsTable results={device.results} />
        {tested && (
          <>
            <h3 className="h6 mt-3">Test now</h3>
            <ResultsTable results={tested} />
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <Button variant="outline-danger" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={() => onEdit(device)} disabled={busy}>
            Edit
          </Button>
          <Button variant="outline-secondary" onClick={togglePause} disabled={busy}>
            {device.enabled ? "Pause" : "Resume"}
          </Button>
          <Button variant="primary" onClick={onTest} disabled={busy}>
            {busy ? "Working..." : "Test now"}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
