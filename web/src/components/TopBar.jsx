import { Badge, Button, Container, Navbar } from "react-bootstrap";

export default function TopBar({ connected, onAdd }) {
  return (
    <Navbar bg="dark" data-bs-theme="dark" className="mb-3">
      <Container fluid>
        <Navbar.Brand className="fw-semibold">NetPulse</Navbar.Brand>
        <div className="d-flex align-items-center gap-3 ms-auto">
          <Badge bg={connected ? "success" : "warning"} text={connected ? undefined : "dark"} aria-live="polite">
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          <Button size="sm" variant="primary" onClick={onAdd}>
            Add device
          </Button>
        </div>
      </Container>
    </Navbar>
  );
}
