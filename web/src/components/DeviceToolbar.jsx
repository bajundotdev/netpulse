import { Button, ButtonGroup, Form } from "react-bootstrap";
import { SORT_OPTIONS } from "@/features/deviceView";

const LIST_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z" />
  </svg>
);
const CARD_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M1 2h6v5H1zM9 2h6v5H9zM1 9h6v5H1zM9 9h6v5H9z" />
  </svg>
);

export default function DeviceToolbar({ total, shown, query, onQuery, sort, onSort, view, onView }) {
  const noun = total === 1 ? "device" : "devices";
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
      <Form.Control
        type="search"
        className="w-auto flex-grow-1"
        style={{ maxWidth: "24rem" }}
        aria-label="Search devices"
        placeholder="Search name, IP, port, status"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <Form.Select className="w-auto" aria-label="Sort devices" value={sort} onChange={(e) => onSort(e.target.value)}>
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </Form.Select>
      <ButtonGroup>
        <Button variant="outline-secondary" active={view === "list"} aria-pressed={view === "list"} onClick={() => onView("list")}>
          {LIST_ICON}
          <span className="visually-hidden">List view</span>
        </Button>
        <Button variant="outline-secondary" active={view === "cards"} aria-pressed={view === "cards"} onClick={() => onView("cards")}>
          {CARD_ICON}
          <span className="visually-hidden">Card view</span>
        </Button>
      </ButtonGroup>
      <span className="text-body-secondary small ms-auto">
        {shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total}`}
      </span>
    </div>
  );
}
