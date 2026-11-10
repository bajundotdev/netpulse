import { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import { getStatus, listDevices, listEvents } from "../api.js";
import { initialState, monitorReducer } from "./monitorReducer.js";
import { useMonitorStream } from "./useMonitorStream.js";

const MonitorContext = createContext(null);

export function MonitorProvider({ children, onStatus, onEvent }) {
  const [state, dispatch] = useReducer(monitorReducer, initialState);

  const reload = useCallback(async () => {
    const [devices, statuses, events] = await Promise.all([
      listDevices(),
      getStatus(),
      listEvents({ limit: 200 }),
    ]);
    dispatch({ type: "SNAPSHOT", devices, statuses, events });
  }, []);

  useMonitorStream(dispatch, reload, onStatus, onEvent);

  const value = useMemo(() => ({ state, dispatch, reload }), [state, reload]);
  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

export function useMonitor() {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error("useMonitor must be used inside MonitorProvider");
  return ctx;
}
