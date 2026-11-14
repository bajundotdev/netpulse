import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistoryOut, LiveDevice } from "@/types";
import StatusPanel from "./StatusPanel";

const HISTORY: HistoryOut = {
  range: "24h",
  start: "2026-11-11T04:00:00+00:00",
  end: "2026-11-12T04:00:00+00:00",
  bucket_seconds: 900,
  problems_last_hour: 2,
  overall: { problems: [0, 1, 2], status: ["UP", "DOWN", "DEGRADED"] },
  devices: [],
};

const DEVICES = [{ status: "UP" }, { status: "DOWN" }] as LiveDevice[];

function setup(props: Partial<React.ComponentProps<typeof StatusPanel>> = {}) {
  const onRange = vi.fn();
  render(<StatusPanel devices={DEVICES} history={HISTORY} range="24h" onRange={onRange} {...props} />);
  return { onRange };
}

describe("StatusPanel", () => {
  it("shows the headline and the problems sub-line", () => {
    setup();
    expect(screen.getByText("1 device down")).toBeInTheDocument();
    expect(screen.getByText("2 problems in the last hour")).toBeInTheDocument();
  });

  it("marks the active range as on and calls onRange for another", async () => {
    const { onRange } = setup();
    expect(screen.getByRole("radio", { name: "24h" })).toHaveAttribute("data-state", "on");
    expect(screen.getByRole("radio", { name: "1h" })).toHaveAttribute("data-state", "off");
    await userEvent.click(screen.getByRole("radio", { name: "7d" }));
    expect(onRange).toHaveBeenCalledWith("7d");
  });

  it("does not deselect the active range", async () => {
    const { onRange } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "24h" }));
    expect(onRange).not.toHaveBeenCalled();
  });

  it("shows loading, unavailable and stale-history states", () => {
    const { unmount } = render(<StatusPanel devices={[]} history={null} range="24h" onRange={() => {}} />);
    expect(screen.getByText("Loading history…")).toBeInTheDocument();
    unmount();
    const second = render(<StatusPanel devices={[]} history={null} range="24h" onRange={() => {}} error />);
    expect(screen.getByText("History unavailable")).toBeInTheDocument();
    second.unmount();
    render(<StatusPanel devices={DEVICES} history={HISTORY} range="24h" onRange={() => {}} error />);
    expect(screen.getByText("History may be out of date")).toBeInTheDocument();
  });

  it("renders the status strip as an image with the summary label", () => {
    setup();
    expect(screen.getByRole("img", { name: "24 hours: 1 slot down, 1 degraded" })).toBeInTheDocument();
  });
});
