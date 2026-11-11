import { readPref, writePref } from "./prefs";

export type Theme = "light" | "dark";

const THEME_KEY = "netpulse.theme";
const THEMES: readonly Theme[] = ["light", "dark"];

type MatchMedia = (query: string) => { matches: boolean };

const systemMatchMedia = (): MatchMedia | undefined =>
  typeof window === "undefined" ? undefined : window.matchMedia?.bind(window);

interface ReadThemeOptions {
  storage?: Pick<Storage, "getItem">;
  matchMedia?: MatchMedia;
}

export function readTheme({ storage, matchMedia = systemMatchMedia() }: ReadThemeOptions = {}): Theme {
  let prefersDark = false;
  try {
    prefersDark = Boolean(matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {
    /* no system preference */
  }
  return readPref<Theme>(THEME_KEY, prefersDark ? "dark" : "light", THEMES, storage);
}

export function applyTheme(
  theme: Theme,
  root: Pick<Element, "classList"> | undefined = typeof document === "undefined" ? undefined : document.documentElement,
): void {
  root?.classList.toggle("dark", theme === "dark");
}

export function writeTheme(theme: Theme): void {
  writePref(THEME_KEY, theme);
}
