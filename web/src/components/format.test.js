import { describe, expect, it } from "vitest";
import { formatDuration, statusVariant } from "./format.js";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(80000)).toBe("1m 20s");
    expect(formatDuration(7500000)).toBe("2h 5m");
  });
  it("clamps negatives to zero", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("statusVariant", () => {
  it("maps statuses to Bootstrap variants", () => {
    expect(statusVariant("UP")).toBe("success");
    expect(statusVariant("DEGRADED")).toBe("warning");
    expect(statusVariant("DOWN")).toBe("danger");
    expect(statusVariant("PAUSED")).toBe("secondary");
    expect(statusVariant("UNKNOWN")).toBe("secondary");
  });
});
