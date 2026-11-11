import { describe, expect, it } from "vitest";
import { readPref, writePref } from "./prefs.js";

const memory = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
};
const broken = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("prefs", () => {
  it("returns the stored value", () => {
    expect(readPref("k", "a", undefined, memory({ k: "b" }))).toBe("b");
  });
  it("returns the fallback when nothing is stored", () => {
    expect(readPref("k", "a", undefined, memory())).toBe("a");
  });
  it("returns the fallback for values not in allowed", () => {
    expect(readPref("k", "list", ["list", "cards"], memory({ k: "grid" }))).toBe("list");
    expect(readPref("k", "list", ["list", "cards"], memory({ k: "cards" }))).toBe("cards");
  });
  it("returns the fallback when storage throws", () => {
    expect(readPref("k", "a", undefined, broken)).toBe("a");
  });
  it("writePref stores and swallows errors", () => {
    const s = memory();
    writePref("k", "v", s);
    expect(s.data.k).toBe("v");
    expect(() => writePref("k", "v", broken)).not.toThrow();
  });
  it("is safe without a localStorage global", () => {
    expect(readPref("k", "a")).toBe("a");
    expect(() => writePref("k", "v")).not.toThrow();
  });
});
