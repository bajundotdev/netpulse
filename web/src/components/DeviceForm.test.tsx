import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeviceForm from "./DeviceForm";

const { createDevice } = vi.hoisted(() => ({ createDevice: vi.fn() }));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, createDevice };
});

import { ApiError } from "@/api/client";

function Harness({ onSaved = vi.fn() }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Add device</button>
      {open && <DeviceForm device={undefined} onSaved={onSaved} onClose={() => setOpen(false)} />}
    </>
  );
}

async function openForm() {
  await userEvent.click(screen.getByRole("button", { name: "Add device" }));
  return screen.getByRole("dialog");
}

describe("DeviceForm", () => {
  beforeEach(() => {
    createDevice.mockReset();
  });

  it("opens on the General tab", async () => {
    render(<Harness />);
    const dialog = await openForm();
    expect(within(dialog).getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Host or IP")).toBeInTheDocument();
  });

  it("adds the eight Domain Controller ports from the preset", async () => {
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Ports" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Domain Controller preset" }));
    expect(within(dialog).getAllByRole("button", { name: /^Remove port / })).toHaveLength(8);
    expect(within(dialog).getByRole("tab", { name: "Ports (8)" })).toBeInTheDocument();
    for (const p of [53, 88, 135, 389, 445, 636, 3268, 3389]) {
      expect(within(dialog).getByRole("button", { name: `Remove port ${p}` })).toBeInTheDocument();
    }
  });

  it("shows the server's 422 message beside the Host field", async () => {
    createDevice.mockRejectedValue(
      new ApiError(422, [{ loc: ["body", "host"], msg: "Value error, not a valid hostname" }]),
    );
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.type(within(dialog).getByLabelText("Name"), "dc01");
    await userEvent.type(within(dialog).getByLabelText("Host or IP"), "bad host");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const host = within(dialog).getByLabelText("Host or IP");
    await waitFor(() => expect(host).toHaveAttribute("aria-invalid", "true"));
    expect(host).toHaveAccessibleDescription("not a valid hostname");
    expect(within(dialog).getByLabelText("Name")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows an error that belongs to no field in an alert", async () => {
    createDevice.mockRejectedValue(new ApiError(409, "Name already used"));
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.type(within(dialog).getByLabelText("Name"), "dc01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name already used");
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Add device" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("DeviceForm website kind", () => {
  beforeEach(() => createDevice.mockReset());

  it("swaps Host for URL, hides liveness and restores Host when switching back", async () => {
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.selectOptions(within(dialog).getByLabelText("Kind"), "web");
    expect(within(dialog).getByLabelText("URL")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Host or IP")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Liveness check")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Interval (s)")).toHaveValue(null);
    expect(within(dialog).getByLabelText("Interval (s)")).toHaveAttribute("placeholder", "30");
    expect(within(dialog).getByLabelText("Timeout (ms)")).toHaveAttribute("placeholder", "10000");
    await userEvent.selectOptions(within(dialog).getByLabelText("Kind"), "server");
    expect(within(dialog).getByLabelText("Host or IP")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Liveness check")).toHaveValue("ping");
    expect(within(dialog).getByLabelText("Interval (s)")).toHaveValue(5);
  });

  it("creates a website with the URL, http liveness, server defaults and its HTTP checks", async () => {
    createDevice.mockResolvedValue({});
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.type(within(dialog).getByLabelText("Name"), "ADFS");
    await userEvent.selectOptions(within(dialog).getByLabelText("Kind"), "web");
    await userEvent.type(within(dialog).getByLabelText("URL"), "https://sts.example.org/adfs");
    await userEvent.click(within(dialog).getByRole("tab", { name: "HTTP" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add HTTP check" }));
    await userEvent.type(within(dialog).getByLabelText("URL"), "https://sts.example.org/adfs/ls");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createDevice).toHaveBeenCalled());
    const body = createDevice.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ name: "ADFS", kind: "web", url: "https://sts.example.org/adfs", liveness: "http" });
    expect("host" in body).toBe(false);
    expect("interval_s" in body).toBe(false);
    expect("timeout_ms" in body).toBe(false);
    expect(body.checks).toEqual([
      expect.objectContaining({ type: "http", params: expect.objectContaining({ url: "https://sts.example.org/adfs/ls" }) }),
    ]);
  });

  it("blocks saving a check with a bad URL and opens the HTTP tab", async () => {
    render(<Harness />);
    const dialog = await openForm();
    await userEvent.type(within(dialog).getByLabelText("Name"), "x");
    await userEvent.type(within(dialog).getByLabelText("Host or IP"), "h");
    await userEvent.click(within(dialog).getByRole("tab", { name: "HTTP" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add HTTP check" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/http:\/\/ or https:\/\/ URL/);
    expect(createDevice).not.toHaveBeenCalled();
  });
});

