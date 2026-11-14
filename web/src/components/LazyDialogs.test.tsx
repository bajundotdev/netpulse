import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DialogBoundary } from "./LazyDialogs";

function Broken(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

describe("DialogBoundary", () => {
  it("renders its dialog when nothing fails", () => {
    render(
      <DialogBoundary onClose={vi.fn()}>
        <p>dialog body</p>
      </DialogBoundary>,
    );
    expect(screen.getByText("dialog body")).toBeInTheDocument();
  });

  it("offers a reload instead of a blank page when a dialog cannot load, and closes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    render(
      <DialogBoundary onClose={onClose}>
        <Broken />
      </DialogBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This window could not be opened");
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close alert" }));
    expect(onClose).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
