import { Badge, Button, CloseButton, Form, InputGroup } from "react-bootstrap";
import { DC_PRESET_PORTS, mergePorts, withPendingPort } from "./ports.js";

// `text`/`error` live in DeviceForm so Save can pick up a port that was typed but not added.
export default function PortsTab({ ports, onChange, text, onTextChange, error, onErrorChange }) {
  const add = () => {
    const next = withPendingPort(ports, text);
    onErrorChange(next.error);
    if (next.error || next.ports === ports) return;
    onTextChange("");
    onChange(next.ports);
  };

  return (
    <div>
      <Form.Group className="mb-3" controlId="device-port-add">
        <Form.Label>Add TCP port</Form.Label>
        <InputGroup hasValidation>
          <Form.Control
            inputMode="numeric"
            value={text}
            isInvalid={!!error}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="outline-primary" onClick={add}>
            Add
          </Button>
          <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
        </InputGroup>
      </Form.Group>
      <Button variant="outline-secondary" size="sm" className="mb-3" onClick={() => onChange(mergePorts(ports, DC_PRESET_PORTS))}>
        Domain Controller preset
      </Button>
      <div className="d-flex flex-wrap gap-2">
        {ports.length === 0 && <span className="text-body-secondary small">No ports monitored.</span>}
        {ports.map((p) => (
          <Badge key={p} bg="secondary" className="d-inline-flex align-items-center gap-2 fs-6 fw-normal">
            {p}
            <CloseButton variant="white" aria-label={`Remove port ${p}`} onClick={() => onChange(ports.filter((x) => x !== p))} />
          </Badge>
        ))}
      </div>
    </div>
  );
}
