import { useState } from "react";
import { Alert, Button, Col, Form, Modal, Row, Tab, Tabs } from "react-bootstrap";
import { ApiError, addCheck, createDevice, deleteCheck, updateCheck, updateDevice } from "../api.js";
import { KIND_LABELS } from "./format.js";
import PortsTab from "./PortsTab.jsx";
import SnmpTab from "./SnmpTab.jsx";
import { applyPortChanges, portsOf } from "./ports.js";
import { applySnmpChanges, buildSnmpPayload, desiredSnmpChecks, snmpFormOf } from "./snmp.js";

const DEFAULTS = {
  name: "",
  host: "",
  kind: "other",
  liveness: "ping",
  liveness_port: "",
  interval_s: "5",
  fail_threshold: "2",
  timeout_ms: "1000",
  notes: "",
};

function toForm(device) {
  if (!device) return DEFAULTS;
  return {
    name: device.name,
    host: device.host,
    kind: device.kind,
    liveness: device.liveness,
    liveness_port: device.liveness_port == null ? "" : String(device.liveness_port),
    interval_s: String(device.interval_s),
    fail_threshold: String(device.fail_threshold),
    timeout_ms: String(device.timeout_ms),
    notes: device.notes ?? "",
  };
}

function toBody(f) {
  return {
    name: f.name,
    host: f.host.trim(),
    kind: f.kind,
    liveness: f.liveness,
    liveness_port: f.liveness === "tcp" && f.liveness_port !== "" ? Number(f.liveness_port) : null,
    interval_s: Number(f.interval_s),
    fail_threshold: Number(f.fail_threshold),
    timeout_ms: Number(f.timeout_ms),
    notes: f.notes.trim() === "" ? null : f.notes,
  };
}

// Splits a FastAPI error into per-field messages and a general message.
function parseError(err) {
  if (!(err instanceof ApiError)) return { fields: {}, general: err.message ?? String(err) };
  if (Array.isArray(err.detail)) {
    const fields = {};
    const general = [];
    for (const item of err.detail) {
      const loc = item.loc ?? [];
      const field = loc.length > 1 ? loc[loc.length - 1] : null;
      const msg = String(item.msg ?? "Invalid value").replace(/^Value error, /, "");
      if (typeof field === "string" && field in DEFAULTS) fields[field] = fields[field] ? `${fields[field]}; ${msg}` : msg;
      else general.push(msg);
    }
    return { fields, general: general.join("; ") || null };
  }
  return { fields: {}, general: typeof err.detail === "string" ? err.detail : err.message };
}

export default function DeviceForm({ device, onSaved, onClose }) {
  const [form, setForm] = useState(() => toForm(device));
  const [errors, setErrors] = useState({ fields: {}, general: null });
  const [ports, setPorts] = useState(() => portsOf(device?.checks));
  const [snmp, setSnmp] = useState(() => snmpFormOf(device));
  const [baseline, setBaseline] = useState(() => device?.checks ?? []);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({ fields: {}, general: null });
    let working = baseline;
    try {
      const body = toBody(form);
      const desired = desiredSnmpChecks(snmp);
      const payload = buildSnmpPayload(snmp);
      let saved;
      if (device) {
        const snmpApi = { addCheck, updateCheck, deleteCheck };
        if (payload === null && device.snmp) {
          // The backend refuses to drop SNMP while SNMP checks exist: delete them first.
          working = await applySnmpChanges(device.id, working, [], snmpApi);
          saved = await updateDevice(device.id, { ...body, snmp: null });
        } else {
          saved = await updateDevice(device.id, payload ? { ...body, snmp: payload } : body);
          working = await applySnmpChanges(
            device.id,
            await applyPortChanges(device.id, working, ports, { addCheck, deleteCheck }),
            desired,
            snmpApi,
          );
        }
        if (payload === null && device.snmp) {
          working = await applyPortChanges(device.id, working, ports, { addCheck, deleteCheck });
        }
        setBaseline(working);
      } else {
        const checks = [
          ...ports.map((port) => ({ type: "tcp", params: { port }, enabled: true })),
          ...desired.map((c) => ({ ...c, enabled: true })),
        ];
        saved = await createDevice({ ...body, ...(payload ? { snmp: payload } : {}), checks });
      }
      await onSaved(saved);
    } catch (err) {
      setBaseline(err.baseline ?? working);
      setErrors(parseError(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, props = {}) => (
    <Form.Group className="mb-3" controlId={`device-${key}`}>
      <Form.Label>{label}</Form.Label>
      <Form.Control value={form[key]} onChange={set(key)} isInvalid={!!errors.fields[key]} {...props} />
      <Form.Control.Feedback type="invalid">{errors.fields[key]}</Form.Control.Feedback>
    </Form.Group>
  );

  return (
    <Modal show onHide={onClose} backdrop="static">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            {device ? `Edit ${device.name}` : "Add device"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {errors.general && <Alert variant="danger">{errors.general}</Alert>}
          <Tabs defaultActiveKey="general" className="mb-3">
            <Tab eventKey="general" title="General">
              {field("name", "Name", { required: true, autoFocus: true })}
              {field("host", "Host or IP", { required: true, className: "font-monospace", placeholder: "dc01.corp.local or 10.0.0.5" })}
              <Form.Group className="mb-3" controlId="device-kind">
                <Form.Label>Kind</Form.Label>
                <Form.Select value={form.kind} onChange={set("kind")} isInvalid={!!errors.fields.kind}>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{errors.fields.kind}</Form.Control.Feedback>
              </Form.Group>
              <Row>
                <Col xs={6}>
                  <Form.Group className="mb-3" controlId="device-liveness">
                    <Form.Label>Liveness check</Form.Label>
                    <Form.Select value={form.liveness} onChange={set("liveness")} isInvalid={!!errors.fields.liveness}>
                      <option value="ping">Ping</option>
                      <option value="tcp">TCP port</option>
                    </Form.Select>
                    <Form.Control.Feedback type="invalid">{errors.fields.liveness}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={6}>
                  {form.liveness === "tcp" &&
                    field("liveness_port", "Liveness port", { type: "number", min: 1, max: 65535 })}
                </Col>
              </Row>
              <Row>
                <Col xs={4}>{field("interval_s", "Interval (s)", { type: "number", min: 2, max: 3600 })}</Col>
                <Col xs={4}>{field("fail_threshold", "Fail threshold", { type: "number", min: 1, max: 10 })}</Col>
                <Col xs={4}>{field("timeout_ms", "Timeout (ms)", { type: "number", min: 200, max: 10000 })}</Col>
              </Row>
              {field("notes", "Notes", { as: "textarea", rows: 2 })}
            </Tab>
            <Tab eventKey="ports" title={`Ports${ports.length ? ` (${ports.length})` : ""}`}>
              <PortsTab ports={ports} onChange={setPorts} />
            </Tab>
            <Tab eventKey="snmp" title={`SNMP${snmp.version === "off" ? "" : ` (${snmp.version})`}`}>
              <SnmpTab value={snmp} onChange={setSnmp} current={device?.snmp} />
            </Tab>
          </Tabs>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
