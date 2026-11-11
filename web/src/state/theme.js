import { readPref, writePref } from "./prefs.js";

const THEME_KEY = "netpulse.theme";
const THEMES = ["light", "dark"];

const systemMatchMedia = () => (typeof window === "undefined" ? undefined : window.matchMedia?.bind(window));

export function readTheme({ storage, matchMedia = systemMatchMedia() } = {}) {
  let prefersDark = false;
  try {
    prefersDark = Boolean(matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {
    /* no system preference */
  }
  return readPref(THEME_KEY, prefersDark ? "dark" : "light", THEMES, storage);
}

export function applyTheme(theme, root = typeof document === "undefined" ? undefined : document.documentElement) {
  root?.setAttribute("data-bs-theme", theme);
}

export function writeTheme(theme) {
  writePref(THEME_KEY, theme);
}
