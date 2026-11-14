import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { LiveDevice, MonitorState } from "@/types";

const { deleteDevice, createDevice, updateDevice, monitor, dispatch, reload } = vi.hoisted(() => ({
  deleteDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
  monitor: { state: null as unknown as MonitorState },
  dispatch: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  deleteDevice,
  createDevice,
  updateDevice,
}));
vi.mock("./state/MonitorContext", () => ({
  useMonitor: () => ({ state: monitor.state, dispatch, reload }),
}));
vi.mock("./state/useHistory", () => ({ useHistory: () => ({ data: null, error: null }) }));

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
  checks: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: "UP",
  since: null,
  consecutive_failures: 0,
  results: [],
  latency: [],
};

beforeEach(() => {
  localStorage.setItem("netpulse.view", "cards");
  monitor.state = {
    devices: { 7: device },
    order: [7],
    events: [],
    connected: true,
    stale: false,
    loadError: null,
  };
  for (const f of [deleteDevice, createDevice, updateDevice, dispatch, reload]) f.mockReset().mockResolvedValue(undefined);
  updateDevice.mockResolvedValue(device);
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const card = () => screen.getByRole("button", { name: /dc01/ });

async function openEdit() {
  await userEvent.click(card());
  const detail = screen.getByRole("dialog");
  await userEvent.click(within(detail).getByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog", { name: /Edit dc01/ });
}

const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

describe("App dialog focus", () => {
  it("returns focus to the card after Detail -> Edit -> Cancel -> Esc", async () => {
    render(<App />);
    card().focus();
    const form = await openEdit();
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    await gone();
    await waitFor(() => expect(card()).toHaveFocus());
  });

  it("returns focus to the card after Save -> Detail -> Esc", async () => {
    render(<App />);
    card().focus();
    const form = await openEdit();
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateDevice).toHaveBeenCalled());
    await screen.findByRole("dialog", { name: /dc01/ });
    await userEvent.keyboard("{Escape}");
    await gone();
    await waitFor(() => expect(card()).toHaveFocus());
  });

  it("falls back to the search box when the opener is deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // Like the reducer, DEVICE_REMOVED drops the device before Detail's onClose runs (one batch).
    dispatch.mockImplementation(() => {
      monitor.state = { ...monitor.state, devices: {}, order: [] };
    });
    render(<App />);
    card().focus();
    await userEvent.click(card());
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDevice).toHaveBeenCalledWith(7));
    await gone();
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Search devices" })).toHaveFocus());
  });
});

describe("App smoke", () => {
  it("shows the headline and device rows, and persists the chosen view", async () => {
    localStorage.setItem("netpulse.view", "list");
    render(<App />);
    expect(screen.getByText("All 1 device up")).toBeInTheDocument();
    expect(screen.getAllByText("dc01").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("radio", { name: "Card view" }));
    expect(localStorage.getItem("netpulse.view")).toBe("cards");
    expect(screen.getByRole("button", { name: /dc01/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(localStorage.getItem("netpulse.view")).toBe("list");
  });
});
