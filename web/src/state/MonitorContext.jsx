import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { getStatus, listDevices, listEvents } from "@/api/client";
import { initialState, monitorReducer } from "./monitorReducer";
import { singleFlight } from "./singleFlight";
import { useMonitorStream } from "./useMonitorStream";

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
  useEffect(() => {
    devicesRef.current = state.devices;
  }, [state.devices]);
  const isKnown = useCallback((id) => id == null || id in devicesRef.current, []);

  useMonitorStream(dispatch, reload, onStatus, onEvent, isKnown);

  const value = useMemo(() => ({ state, dispatch, reload }), [state, reload]);
  return <MonitorContext value={value}>{children}</MonitorContext>;
}

export function useMonitor() {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error("useMonitor must be used inside MonitorProvider");
  return ctx;
}
