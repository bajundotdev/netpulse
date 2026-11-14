import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
});

describe("TopBar", () => {
  it("shows Live when connected and Reconnecting otherwise", () => {
    const { rerender } = render(<TopBar connected onAdd={() => {}} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    rerender(<TopBar connected={false} onAdd={() => {}} />);
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
  });

  it("toggles the dark class and the button label, and remembers the choice", async () => {
    render(<TopBar connected onAdd={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("netpulse.theme")).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("toggles sound and reports pressed state", async () => {
    render(<TopBar connected onAdd={() => {}} />);
    const sound = screen.getByRole("button", { name: /^Sound/ });
    const before = sound.getAttribute("aria-pressed");
    await userEvent.click(sound);
    expect(sound.getAttribute("aria-pressed")).not.toBe(before);
  });

  it("calls onAdd and offers notifications only while permission is undecided", async () => {
    const onAdd = vi.fn();
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn().mockResolvedValue("granted") });
    render(<TopBar connected onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add device" }));
    expect(onAdd).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
    expect(screen.queryByRole("button", { name: "Enable notifications" })).toBeNull();
  });
});
