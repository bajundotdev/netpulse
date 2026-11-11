import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeviceList from "./DeviceList";
import DeviceRow from "./DeviceRow";
import type { HistoryOut, LiveDevice } from "@/types";

const NOW = Date.parse("2026-01-01T12:00:00Z");

function device(over: Partial<LiveDevice> = {}): LiveDevice {
  return {
    id: 1,
    name: "dc01",
    host: "10.0.0.1",
    kind: "dc",
    enabled: true,
    interval_s: 30,
    fail_threshold: 3,
    timeout_ms: 1000,
    liveness: "ping",
    liveness_port: null,
    snmp: null,
    notes: null,
    checks: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "UP",
    since: "2026-01-01T10:00:00Z",
    consecutive_failures: 0,
    results: [],
    latency: [12.4],
    ...over,
  };
}

const HISTORY: HistoryOut = {
  range: "24h",
  start: "2025-12-31T12:00:00Z",
  bucket_seconds: 3600,
  problems_last_hour: 0,
  overall: { problems: [0, 0], status: ["UP", "UP"] },
  devices: [{ device_id: 1, uptime_pct: 99.5, buckets: ["UP", "DOWN"] }],
} as HistoryOut;

function setup(over: Partial<React.ComponentProps<typeof DeviceRow>> = {}) {
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  render(
    <DeviceRow device={device()} history={HISTORY} range="24h" now={NOW} expanded={false} onToggle={onToggle} onOpen={onOpen} {...over} />,
  );
  return { onToggle, onOpen };
}

describe("DeviceRow", () => {
  it("shows name, host and status word collapsed, with no body", () => {
    setup();
    const header = screen.getByRole("button", { name: /dc01/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("10.0.0.1");
    expect(header).toHaveTextContent("Up");
    expect(screen.queryByText("99.5% uptime")).not.toBeInTheDocument();
  });

  it("calls onToggle with the id when the header is clicked or activated by keyboard", async () => {
    const { onToggle } = setup();
    const header = screen.getByRole("button", { name: /dc01/ });
    await userEvent.click(header);
    header.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("shows the history bar, uptime label and duration when expanded", () => {
    setup({ expanded: true });
    const header = screen.getByRole("button", { name: /dc01/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveAttribute("aria-controls", "device-row-body-1");
    expect(document.getElementById("device-row-body-1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /dc01, 24 hours/ })).toBeInTheDocument();
    expect(screen.getByText("99.5% uptime")).toBeInTheDocument();
    expect(screen.getByText("24h ago")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("UP for 2h 0m")).toBeInTheDocument();
    expect(screen.getByText("Latency 12 ms")).toBeInTheDocument();
  });

  it("calls onOpen with the id from Details", async () => {
    const { onOpen } = setup({ expanded: true });
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("says history is loading, and when a device has none", () => {
    const { unmount } = render(
      <DeviceRow device={device()} history={null} range="24h" now={NOW} expanded onToggle={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("History loading…")).toBeInTheDocument();
    unmount();
    render(
      <DeviceRow device={device({ id: 2 })} history={HISTORY} range="24h" now={NOW} expanded onToggle={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("No history yet")).toBeInTheDocument();
  });

  it("emphasises DOWN duration", () => {
    setup({ expanded: true, device: device({ status: "DOWN" }) });
    expect(screen.getByText("DOWN for 2h 0m")).toHaveClass("font-semibold");
  });
});

describe("DeviceList", () => {
  it("lets several rows be open at once", async () => {
    const devices = [device(), device({ id: 2, name: "sw02", host: "10.0.0.2" })];
    render(<DeviceList devices={devices} history={HISTORY} range="24h" now={NOW} onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /dc01/ }));
    await userEvent.click(screen.getByRole("button", { name: /sw02/ }));
    expect(screen.getByRole("button", { name: /dc01/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /sw02/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("explains an empty list", () => {
    render(<DeviceList devices={[]} history={null} range="24h" now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText(/No devices yet/)).toBeInTheDocument();
  });
});
