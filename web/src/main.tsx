import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./app.css";
import App from "./App";
import { createAlerter } from "@/features/alerts";
import { MonitorProvider } from "./state/MonitorContext";
import { applyTheme, readTheme } from "./state/theme";

// Before the first render, so a stored dark choice never flashes light.
applyTheme(readTheme());

const alerter = createAlerter();
window.addEventListener("focus", alerter.focus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) alerter.focus();
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <MonitorProvider onEvent={alerter.push}>
      <App />
    </MonitorProvider>
  </StrictMode>,
);
