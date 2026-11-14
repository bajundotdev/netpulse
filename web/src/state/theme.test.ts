// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, writeTheme } from "./theme";

const storage = (value: string | null) => ({ getItem: () => value, setItem: () => {} });
const media = (dark: boolean) => () => ({ matches: dark });

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
    let query: string | undefined;
    readTheme({ storage: storage(null), matchMedia: (q: string) => ((query = q), { matches: false }) });
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
  it("adds the dark class for dark and removes it for light", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(root.classList.contains("dark")).toBe(true);
    applyTheme("light", root);
    expect(root.classList.contains("dark")).toBe(false);
  });
  it("a theme stored as dark before the upgrade still yields the dark class", () => {
    const root = document.createElement("html");
    applyTheme(readTheme({ storage: storage("dark"), matchMedia: media(false) }), root);
    expect(root.classList.contains("dark")).toBe(true);
  });
  it("writeTheme does not throw without storage", () => {
    expect(() => writeTheme("dark")).not.toThrow();
  });
});
