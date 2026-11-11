import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventLog from "./EventLog";
import type { EventOut, MonitorState } from "@/types";

const { ackEvent, clearEvents, dispatch, monitor } = vi.hoisted(() => ({
  ackEvent: vi.fn(),
  clearEvents: vi.fn(),
  dispatch: vi.fn(),
  monitor: { state: null as unknown as MonitorState },
}));

vi.mock("@/api/client", () => ({ ackEvent, clearEvents }));
vi.mock("@/state/MonitorContext", () => ({
  useMonitor: () => ({ state: monitor.state, dispatch, reload: vi.fn() }),
}));

const ev = (id: number, over: Partial<EventOut> = {}): EventOut => ({
  id,
  ts: "2026-01-01T12:00:00Z",
  device_id: 1,
  check_id: null,
  severity: "info",
  kind: "status",
  message: `event ${id}`,
  status: null,
  previous_status: null,
  acknowledged: false,
  ...over,
});

beforeEach(() => {
  ackEvent.mockReset().mockResolvedValue(undefined);
  clearEvents.mockReset().mockResolvedValue({ cleared: 2 });
  dispatch.mockReset();
  monitor.state = {
    devices: {},
    order: [],
    events: [
      ev(1),
      ev(2, { acknowledged: true }),
      ev(3, { severity: "critical", message: "event 3" }),
    ],
    connected: true,
    stale: false,
    loadError: null,
  };
});

afterEach(() => vi.restoreAllMocks());

describe("EventLog", () => {
  it("offers Ack only on unacknowledged rows and acks through the API", async () => {
    render(<EventLog />);
    expect(screen.getAllByRole("button", { name: "Ack" })).toHaveLength(2);
    const row = screen.getByText("event 1").closest("tr");
    if (!row) throw new Error("row missing");
    await userEvent.click(within(row).getByRole("button", { name: "Ack" }));
    expect(ackEvent).toHaveBeenCalledWith(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "EVENT_ACKED", id: 1 });
    const acked = screen.getByText("event 2").closest("tr");
    if (!acked) throw new Error("row missing");
    expect(within(acked).queryByRole("button", { name: "Ack" })).not.toBeInTheDocument();
  });

  it("filters by severity", async () => {
    render(<EventLog />);
    await userEvent.selectOptions(screen.getByLabelText("Filter by severity"), "critical");
    expect(screen.getByText("event 3")).toBeInTheDocument();
    expect(screen.queryByText("event 1")).not.toBeInTheDocument();
  });

  it("asks before clearing and does nothing when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EventLog />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(confirm).toHaveBeenCalledWith("Clear the whole event log? This cannot be undone.");
    expect(clearEvents).not.toHaveBeenCalled();
  });

  it("clears the log once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EventLog />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearEvents).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "EVENTS_CLEARED" });
  });

  it("shows a placeholder when there are no events", () => {
    monitor.state = { ...monitor.state, events: [] };
    render(<EventLog />);
    expect(screen.getByText("No events.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });
});
