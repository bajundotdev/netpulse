import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeviceToolbar from "./DeviceToolbar";

function setup(props: Partial<React.ComponentProps<typeof DeviceToolbar>> = {}) {
  const handlers = { onQuery: vi.fn(), onSort: vi.fn(), onView: vi.fn() };
  render(<DeviceToolbar total={5} shown={5} query="" sort="problems" view="list" {...handlers} {...props} />);
  return handlers;
}

describe("DeviceToolbar", () => {
  it("reports typed search text", async () => {
    const { onQuery } = setup();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search devices" }), "a");
    expect(onQuery).toHaveBeenCalledWith("a");
  });

  it("marks the active view as on and calls onView for the other", async () => {
    const { onView } = setup();
    expect(screen.getByRole("radio", { name: "List view" })).toHaveAttribute("data-state", "on");
    expect(screen.getByRole("radio", { name: "Card view" })).toHaveAttribute("data-state", "off");
    await userEvent.click(screen.getByRole("radio", { name: "Card view" }));
    expect(onView).toHaveBeenCalledWith("cards");
  });

  it("does not deselect the active view", async () => {
    const { onView } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(onView).not.toHaveBeenCalled();
  });

  it("calls onSort with the chosen key", async () => {
    const { onSort } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Sort devices"), "latency");
    expect(onSort).toHaveBeenCalledWith("latency");
  });

  it("shows the device count, or the filtered count", () => {
    const { unmount } = render(
      <DeviceToolbar total={1} shown={1} query="" onQuery={() => {}} sort="name" onSort={() => {}} view="list" onView={() => {}} />,
    );
    expect(screen.getByText("1 device")).toBeInTheDocument();
    unmount();
    setup({ shown: 2 });
    expect(screen.getByText("Showing 2 of 5")).toBeInTheDocument();
  });
});
