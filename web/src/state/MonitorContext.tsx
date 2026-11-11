import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { getStatus, listDevices, listEvents } from "@/api/client";
import type { EventOut, MonitorAction, MonitorState, StatusPayload } from "@/types";
import { initialState, monitorReducer } from "./monitorReducer";
import { singleFlight } from "./singleFlight";
import { useMonitorStream } from "./useMonitorStream";

interface MonitorContextValue {
  state: MonitorState;
  dispatch: Dispatch<MonitorAction>;
  reload: () => Promise<void>;
}

const MonitorContext = createContext<MonitorContextValue | null>(null);

interface MonitorProviderProps {
  children: ReactNode;
  onStatus?: (payload: StatusPayload) => void;
  onEvent?: (event: EventOut) => void;
}

export function MonitorProvider({ children, onStatus, onEvent }: MonitorProviderProps) {
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
  const isKnown = useCallback((id: number | null) => id == null || id in devicesRef.current, []);

  useMonitorStream(dispatch, reload, onStatus, onEvent, isKnown);

  const value = useMemo(() => ({ state, dispatch, reload }), [state, reload]);
  return <MonitorContext value={value}>{children}</MonitorContext>;
}

export function useMonitor(): MonitorContextValue {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error("useMonitor must be used inside MonitorProvider");
  return ctx;
}
