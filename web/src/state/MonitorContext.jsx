import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { getStatus, listDevices, listEvents } from "../api.js";
import { initialState, monitorReducer } from "./monitorReducer.js";
import { singleFlight } from "./singleFlight.js";
import { useMonitorStream } from "./useMonitorStream.js";

const MonitorContext = createContext(null);

export function MonitorProvider({ children, onStatus, onEvent }) {
  const [state, dispatch] = useReducer(monitorReducer, initialState);

  // Single-flight: overlapping snapshot loads could land out of order and overwrite newer state.
  const reload = useMemo(
    () =>
      singleFlight(async () => {
        const [devices, statuses, events] = await Promise.all([
          listDevices(),
          getStatus(),
          listEvents({ limit: 200 }),
        ]);
        dispatch({ type: "SNAPSHOT", devices, statuses, events });
      }),
    [],
  );

  const devicesRef = useRef(state.devices);
  devicesRef.current = state.devices;
  const isKnown = useCallback((id) => id == null || id in devicesRef.current, []);

  useMonitorStream(dispatch, reload, onStatus, onEvent, isKnown);

  const value = useMemo(() => ({ state, dispatch, reload }), [state, reload]);
  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

export function useMonitor() {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error("useMonitor must be used inside MonitorProvider");
  return ctx;
}
