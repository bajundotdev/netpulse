import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, writeTheme } from "./theme.js";

const storage = (value) => ({ getItem: () => value, setItem: () => {} });
const media = (dark) => () => ({ matches: dark });

describe("readTheme", () => {
  it("uses the stored value", () => {
    expect(readTheme({ storage: storage("light"), matchMedia: media(true) })).toBe("light");
    expect(readTheme({ storage: storage("dark"), matchMedia: media(false) })).toBe("dark");
  });
  it("falls back to the system preference", () => {
    expect(readTheme({ storage: storage(null), matchMedia: media(true) })).toBe("dark");
    expect(readTheme({ storage: storage(null), matchMedia: media(false) })).toBe("light");
  });
  it("queries prefers-color-scheme: dark", () => {
    let query;
    readTheme({ storage: storage(null), matchMedia: (q) => ((query = q), { matches: false }) });
    expect(query).toBe("(prefers-color-scheme: dark)");
  });
  it("ignores invalid stored values", () => {
    expect(readTheme({ storage: storage("blue"), matchMedia: media(true) })).toBe("dark");
    expect(readTheme({ storage: storage("blue"), matchMedia: media(false) })).toBe("light");
  });
  it("falls back when storage throws", () => {
    const bad = { getItem: () => { throw new Error("denied"); } };
    expect(readTheme({ storage: bad, matchMedia: media(true) })).toBe("dark");
  });
  it("defaults to light without matchMedia", () => {
    expect(readTheme({ storage: storage(null) })).toBe("light");
  });
});

describe("applyTheme / writeTheme", () => {
  it("sets data-bs-theme on the root", () => {
    const attrs = {};
    const root = { setAttribute: (k, v) => (attrs[k] = v) };
    applyTheme("dark", root);
    expect(attrs["data-bs-theme"]).toBe("dark");
  });
  it("writeTheme does not throw without storage", () => {
    expect(() => writeTheme("dark")).not.toThrow();
  });
});
