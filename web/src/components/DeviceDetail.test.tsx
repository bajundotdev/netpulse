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

describe("DeviceDetail website", () => {
  it("shows the URL and the certificate expiry date", () => {
    const { dialog } = setup({
      device: {
        ...device,
        kind: "web",
        url: "https://sts.example.org/adfs",
        liveness: "http",
        liveness_port: null,
        results: [
          { type: "http", label: "GET /adfs", ok: true, check_id: 5, latency_ms: 143, value: { status_code: 200, elapsed_ms: 143, cert_expires: "2027-03-01T00:00:00Z", cert_days: 112, final_url: null } },
        ],
      },
    });
    expect(within(dialog).getByText("https://sts.example.org/adfs")).toHaveClass("font-mono");
    expect(within(dialog).getByText(/HTTP request, every 30s/)).toBeInTheDocument();
    expect(within(dialog).getByText("expires 2027-03-01 (112 days)")).toBeInTheDocument();
  });
});

describe("DeviceDetail focus", () => {
  it("opens with focus on the dialog itself, not on Delete", async () => {
    const { dialog } = setup();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(within(dialog).getByRole("button", { name: "Delete" })).not.toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(deleteDevice).not.toHaveBeenCalled();
  });
});

describe("DeviceDetail HTTP results", () => {
  const cert = { cert_expires: "2027-01-01T00:00:00Z", cert_days: 41, final_url: null };
  const web: LiveDevice = {
    ...device,
    kind: "web",
    host: "sts.example.org",
    url: "https://sts.example.org/",
    liveness: "http",
    liveness_port: null,
    checks: [
      { id: 5, device_id: 7, type: "http", enabled: true, created_at: "", has_secret: false, params: { url: "https://sts.example.org/" } },
      { id: 6, device_id: 7, type: "http", enabled: true, created_at: "", has_secret: false, params: { url: "https://api.example.org/health", name: "api" } },
    ],
    results: [
      { type: "http", label: "GET /", ok: true, check_id: null, latency_ms: 78.73495802050456, value: { status_code: 200, elapsed_ms: 78.73495802050456, ...cert } },
      { type: "http", label: "GET /", ok: true, check_id: 5, latency_ms: 2350.2, reason: "slow 2350 ms", slow: true, value: { status_code: 200, elapsed_ms: 2350.2, ...cert } },
      { type: "http", label: "api", ok: false, check_id: 6, latency_ms: 12, reason: "status 503", value: { status_code: 503, elapsed_ms: 12, cert_expires: "2026-12-01T00:00:00Z", cert_days: 17, final_url: null } },
    ],
  };

  it("formats HTTP results like the Test summary, without the raw value dump", () => {
    const { dialog } = setup({ device: web });
    expect(within(dialog).getByText("HTTP 200 · 79 ms · cert 41 d")).toBeInTheDocument();
    expect(within(dialog).getByText("HTTP 200 · 2350 ms · cert 41 d · slow 2350 ms")).toBeInTheDocument();
    expect(within(dialog).getByText("HTTP 503 · 12 ms · cert 17 d · status 503")).toBeInTheDocument();
    expect(within(dialog).queryByText(/78\.7349/)).not.toBeInTheDocument();
  });

  it("shows one certificate line per host:port, the site's own labelled distinctly, without duplicate keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { dialog } = setup({ device: web });
    expect(within(dialog).getByText("Certificate (site)")).toBeInTheDocument();
    expect(within(dialog).queryByText("Certificate (GET /)")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("expires 2027-01-01 (41 days)")).toHaveLength(1);
    expect(within(dialog).getByText("Certificate (api)")).toBeInTheDocument();
    expect(within(dialog).getByText("expires 2026-12-01 (17 days)")).toBeInTheDocument();
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});
