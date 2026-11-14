import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeviceDetail from "./DeviceDetail";
import type { LiveDevice } from "@/types";

const { deleteDevice, testDevice, updateDevice, dispatch, reload } = vi.hoisted(() => ({
  deleteDevice: vi.fn(),
  testDevice: vi.fn(),
  updateDevice: vi.fn(),
  dispatch: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/api/client", () => ({ deleteDevice, testDevice, updateDevice }));
vi.mock("@/state/MonitorContext", () => ({ useMonitor: () => ({ state: {}, dispatch, reload }) }));

const device: LiveDevice = {
  id: 7,
  name: "dc01",
  host: "10.0.0.1",
  kind: "dc",
  enabled: true,
  interval_s: 30,
  fail_threshold: 3,
  timeout_ms: 1000,
  liveness: "tcp",
  liveness_port: 389,
  url: null,
  snmp: null,
  notes: "rack 4",
  checks: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: "DOWN",
  since: null,
  consecutive_failures: 3,
  results: [{ type: "tcp", label: "tcp/389", ok: false, check_id: 1, latency_ms: 12.4, reason: "refused" }],
  latency: [],
};

function setup(props: Partial<React.ComponentProps<typeof DeviceDetail>> = {}) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  render(<DeviceDetail device={device} onClose={onClose} onEdit={onEdit} {...props} />);
  return { onClose, onEdit, dialog: screen.getByRole("dialog") };
}

beforeEach(() => {
  for (const f of [deleteDevice, testDevice, updateDevice, dispatch, reload]) f.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("DeviceDetail", () => {
  it("shows the device facts and latest results", () => {
    const { dialog } = setup();
    expect(within(dialog).getByRole("heading", { name: /dc01/ })).toBeInTheDocument();
    expect(within(dialog).getByText("10.0.0.1")).toHaveClass("font-mono");
    expect(within(dialog).getByText("Domain controller")).toBeInTheDocument();
    expect(within(dialog).getByText(/TCP port 389, every 30s, down after 3 failures, 1000 ms timeout/)).toBeInTheDocument();
    expect(within(dialog).getByText("rack 4")).toBeInTheDocument();
    expect(within(dialog).getByText("FAIL")).toBeInTheDocument();
    expect(within(dialog).getByText("12 ms")).toBeInTheDocument();
    expect(within(dialog).getByText("refused")).toBeInTheDocument();
  });

  it("runs Test now and lists the answer", async () => {
    testDevice.mockResolvedValue([{ type: "tcp", label: "tcp/389", ok: true, check_id: 1, latency_ms: 3 }]);
    const { dialog } = setup();
    await userEvent.click(within(dialog).getByRole("button", { name: "Test now" }));
    expect(testDevice).toHaveBeenCalledWith(7);
    expect(await within(dialog).findByRole("heading", { name: "Test now" })).toBeInTheDocument();
    expect(within(dialog).getByText("OK")).toBeInTheDocument();
  });

  it("pauses the device and reloads", async () => {
    const { dialog } = setup();
    await userEvent.click(within(dialog).getByRole("button", { name: "Pause" }));
    expect(updateDevice).toHaveBeenCalledWith(7, { enabled: false });
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("offers Resume for a paused device", () => {
    const { dialog } = setup({ device: { ...device, enabled: false } });
    expect(within(dialog).getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("hands the device to onEdit", async () => {
    const { dialog, onEdit } = setup();
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(device);
  });

  it("deletes only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { dialog, onClose } = setup();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteDevice).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDevice).toHaveBeenCalledWith(7));
    expect(confirm).toHaveBeenCalledWith("Delete dc01? Its checks are removed too.");
    expect(dispatch).toHaveBeenCalledWith({ type: "DEVICE_REMOVED", id: 7 });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows API errors in a dismissible alert", async () => {
    testDevice.mockRejectedValue(new Error("boom"));
    const { dialog } = setup();
    await userEvent.click(within(dialog).getByRole("button", { name: "Test now" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("boom");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close alert" }));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
