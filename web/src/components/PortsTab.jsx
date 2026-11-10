import { useState } from "react";
import { Badge, Button, CloseButton, Form, InputGroup } from "react-bootstrap";
import { DC_PRESET_PORTS, mergePorts, parsePort } from "./ports.js";

export default function PortsTab({ ports, onChange }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);

  const add = () => {
    if (text.trim() === "") return;
    const port = parsePort(text);
    if (port === null) {
      setError("Enter a whole number from 1 to 65535");
      return;
    }
    setError(null);
    setText("");
    onChange(mergePorts(ports, [port]));
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
            onChange={(e) => setText(e.target.value)}
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
