import { useState } from "react";
import { Button } from "react-bootstrap";
import { applyTheme, readTheme, writeTheme } from "../state/theme.js";

const Sun = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 0v2M8 14v2M0 8h2M14 8h2M2.3 2.3l1.4 1.4M12.3 12.3l1.4 1.4M2.3 13.7l1.4-1.4M12.3 3.7l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const Moon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M6 .3a8 8 0 1 0 9.7 9.7A6.5 6.5 0 0 1 6 .3z" />
  </svg>
);

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const dark = theme === "dark";

  const toggle = () => {
    const next = dark ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    writeTheme(next);
  };

  return (
    <Button
      size="sm"
      variant="outline-light"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
