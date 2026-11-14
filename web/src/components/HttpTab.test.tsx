import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HttpTab from "./HttpTab";
import { buildHttpParams, newHttpForm, type HttpForm } from "@/features/http";

const { testDevice } = vi.hoisted(() => ({ testDevice: vi.fn() }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, testDevice };
});

let latest: HttpForm[] = [];

function Harness({ initial = [], deviceId }: { initial?: HttpForm[]; deviceId?: number }) {
  const [value, setValue] = useState(initial);
  const change = (next: HttpForm[]) => {
    latest = next;
    setValue(next);
  };
  return <HttpTab value={value} onChange={change} deviceId={deviceId} />;
}

const saved = (): HttpForm => ({ ...newHttpForm(), id: 5, url: "https://sts.example.org/adfs" });

describe("HttpTab", () => {
  beforeEach(() => {
    testDevice.mockReset();
    latest = [];
  });

  it("adds a check and edits its fields and header rows", async () => {
    render(<Harness />);
    expect(screen.getByText(/No HTTP checks/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add HTTP check" }));
    const check = screen.getByRole("group", { name: "HTTP check 1" });
    await userEvent.type(within(check).getByLabelText("URL"), "https://api.example.org/health");
    await userEvent.selectOptions(within(check).getByLabelText("Method"), "POST");
    expect(within(check).getByLabelText("Body")).toBeInTheDocument();

    await userEvent.click(within(check).getByRole("button", { name: "Add header" }));
    await userEvent.type(within(check).getByLabelText("Header 1 name"), "X-Env");
    await userEvent.type(within(check).getByLabelText("Header 1 value"), "prod");
    await userEvent.click(within(check).getByRole("button", { name: "Add header" }));
    await userEvent.type(within(check).getByLabelText("Header 2 name"), "X-Tmp");
    await userEvent.click(within(check).getByRole("button", { name: "Remove header 2" }));

    expect(within(check).getByText(/stored unencrypted/)).toBeInTheDocument();
    expect(buildHttpParams(latest[0])).toMatchObject({
      url: "https://api.example.org/health",
      method: "POST",
      headers: { "X-Env": "prod" },
    });
  });

  it("hides the body for GET and the JSON value for exists", async () => {
    render(<Harness initial={[saved()]} />);
    const check = screen.getByRole("group", { name: "HTTP check 1" });
    expect(within(check).queryByLabelText("Body")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(check).getByLabelText("JSON test"), "exists");
    expect(within(check).queryByLabelText("JSON value")).not.toBeInTheDocument();
  });

  it("shows 'unchanged' for a stored secret and never its value", async () => {
    render(<Harness initial={[{ ...saved(), authType: "bearer", hasSecret: true }]} />);
    const secret = screen.getByLabelText("Token");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveAttribute("placeholder", "unchanged");
    expect(secret).toHaveValue("");
  });

  it("disables Test until the check is saved", () => {
    render(<Harness initial={[newHttpForm()]} deviceId={1} />);
    expect(screen.getByRole("button", { name: "Test HTTP check 1" })).toBeDisabled();
    expect(screen.getByText("Save to test")).toBeInTheDocument();
  });

  it("disables Test for a new device", () => {
    render(<Harness initial={[saved()]} />);
    expect(screen.getByRole("button", { name: "Test HTTP check 1" })).toBeDisabled();
  });

  it("runs the saved check and shows its result", async () => {
    testDevice.mockResolvedValue([
      { type: "ping", label: "ping", ok: true, check_id: null },
      {
        type: "http",
        label: "GET /adfs",
        ok: true,
        check_id: 5,
        latency_ms: 143,
        value: { status_code: 200, elapsed_ms: 143, cert_expires: "2027-03-01T00:00:00Z", cert_days: 112, final_url: null },
      },
    ]);
    render(<Harness initial={[saved()]} deviceId={9} />);
    await userEvent.click(screen.getByRole("button", { name: "Test HTTP check 1" }));
    expect(testDevice).toHaveBeenCalledWith(9);
    expect(await screen.findByRole("status")).toHaveTextContent("OK · HTTP 200 · 143 ms · cert 112 d");
  });

  it("shows the reason of a failed test and an API error", async () => {
    testDevice.mockResolvedValueOnce([{ type: "http", label: "x", ok: false, check_id: 5, reason: "status 503" }]);
    render(<Harness initial={[saved()]} deviceId={9} />);
    await userEvent.click(screen.getByRole("button", { name: "Test HTTP check 1" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Failed · status 503");
    testDevice.mockRejectedValueOnce(new Error("Request failed (500)"));
    await userEvent.click(screen.getByRole("button", { name: "Test HTTP check 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed (500)");
  });

  it("removes a check", async () => {
    render(<Harness initial={[saved()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove HTTP check 1" }));
    expect(screen.getByText(/No HTTP checks/)).toBeInTheDocument();
  });
});
