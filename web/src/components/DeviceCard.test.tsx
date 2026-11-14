import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeviceCard from "./DeviceCard";
import type { LiveDevice } from "@/types";

const NOW = Date.parse("2026-01-01T12:00:00Z");

const device: LiveDevice = {
  id: 7,
  name: "dc01",
  host: "10.0.0.1",
  kind: "dc",
  enabled: true,
  interval_s: 30,
  fail_threshold: 3,
  timeout_ms: 1000,
  liveness: "ping",
  liveness_port: null,
  url: null,
  snmp: null,
  notes: null,
  checks: [
    { id: 1, device_id: 7, type: "tcp", params: { port: 389 }, enabled: true, created_at: "2026-01-01T00:00:00Z" },
    { id: 2, device_id: 7, type: "tcp", params: { port: 88 }, enabled: true, created_at: "2026-01-01T00:00:00Z" },
  ],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: "DEGRADED",
  since: "2026-01-01T11:30:00Z",
  consecutive_failures: 0,
  results: [
    { type: "tcp", label: "tcp/389", ok: true, check_id: 1 },
    { type: "tcp", label: "tcp/88", ok: false, check_id: 2, reason: "connection refused" },
  ],
  latency: [10, null, 20],
};

describe("DeviceCard", () => {
  it("shows port chips with the failure reason in the title", () => {
    render(<DeviceCard device={device} now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText("389 ✓")).toBeInTheDocument();
    const failed = screen.getByText(/^88 ✗/);
    expect(failed).toHaveAttribute("title", "connection refused");
  });

  it("shows host, status, latency, sparkline and duration", () => {
    render(<DeviceCard device={device} now={NOW} onOpen={vi.fn()} />);
    expect(screen.getByText("10.0.0.1")).toHaveClass("font-mono");
    expect(screen.getByText("DEGRADED")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Latency history, 2 samples" })).toBeInTheDocument();
    expect(screen.getByText("DEGRADED for 30m 0s")).toBeInTheDocument();
    expect(screen.getByText("Domain controller")).toBeInTheDocument();
  });

  it("opens the device on click, Enter and Space", async () => {
    const onOpen = vi.fn();
    render(<DeviceCard device={device} now={NOW} onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /dc01/ });
    await userEvent.click(card);
    card.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenCalledWith(7);
  });
});
