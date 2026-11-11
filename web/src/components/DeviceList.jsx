import { useState } from "react";
import { ListGroup } from "react-bootstrap";
import DeviceRow from "./DeviceRow.jsx";

export default function DeviceList({ devices, history, range, now, onOpen }) {
  const [expanded, setExpanded] = useState(() => new Set());

  if (devices.length === 0) {
    return <p className="text-body-secondary">No devices yet. Use "Add device" to start monitoring.</p>;
  }
  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ListGroup>
      {devices.map((d) => (
        <DeviceRow
          key={d.id}
          device={d}
          history={history}
          range={range}
          now={now}
          expanded={expanded.has(d.id)}
          onToggle={toggle}
          onOpen={onOpen}
        />
      ))}
    </ListGroup>
  );
}
