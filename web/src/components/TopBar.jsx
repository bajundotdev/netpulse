import { useState } from "react";
import { Badge, Button, Container, Navbar } from "react-bootstrap";
import { readSoundSetting, writeSoundSetting } from "../alerts.js";

const notificationPermission = () =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

export default function TopBar({ connected, onAdd }) {
  const [soundOn, setSoundOn] = useState(readSoundSetting);
  const [permission, setPermission] = useState(notificationPermission);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundSetting(next);
  };

  const enableNotifications = async () => {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(notificationPermission());
    }
  };

  return (
    <Navbar bg="dark" data-bs-theme="dark" className="mb-3">
      <Container fluid>
        <Navbar.Brand className="fw-semibold">NetPulse</Navbar.Brand>
        <div className="d-flex align-items-center gap-3 ms-auto">
          <Badge bg={connected ? "success" : "warning"} text={connected ? undefined : "dark"} aria-live="polite">
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          {permission === "default" && (
            <Button size="sm" variant="outline-light" onClick={enableNotifications}>
              Enable notifications
            </Button>
          )}
          <Button
            size="sm"
            variant={soundOn ? "light" : "outline-secondary"}
            aria-pressed={soundOn}
            onClick={toggleSound}
          >
            Sound {soundOn ? "on" : "off"}
          </Button>
          <Button size="sm" variant="primary" onClick={onAdd}>
            Add device
          </Button>
        </div>
      </Container>
    </Navbar>
  );
}
