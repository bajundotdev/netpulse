import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, readTheme, writeTheme, type Theme } from "@/state/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const dark = theme === "dark";

  const toggle = () => {
    const next: Theme = dark ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    writeTheme(next);
  };

  return (
    <Button
      size="icon-sm"
      variant="outline"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
