import { useEffect, useRef, type Dispatch } from "react";
import { ApiError } from "@/api/client";
import type { EventOut, MonitorAction, ResultPayload, StatusPayload } from "@/types";

const RETRY_MS = 5000;
const REOPEN_MS = 3000;
const STALE_MS = 10000;
const DEVICES_RELOAD_MS = 300;

// Opens the SSE stream. Every (re)open reloads a full snapshot so nothing missed while offline is lost.
// Device list changes made elsewhere (another tab, the API) arrive as "devices" messages, and any
// message for a device this page does not know, both trigger a debounced snapshot reload.
type Timer = ReturnType<typeof setTimeout> | undefined;

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && typeof err.detail === "string") return err.detail;
  return err instanceof Error ? err.message : String(err);
}

export function useMonitorStream(
  dispatch: Dispatch<MonitorAction>,
  reload: () => Promise<unknown>,
  onStatus?: (payload: StatusPayload) => void,
  onEvent?: (event: EventOut) => void,
  isKnown?: (deviceId: number | null) => boolean,
): void {
  const handlers = useRef({ reload, onStatus, onEvent, isKnown });
  useEffect(() => {
    handlers.current = { reload, onStatus, onEvent, isKnown };
  }, [reload, onStatus, onEvent, isKnown]);

  useEffect(() => {
    const parse = <T>(e: Event): T => JSON.parse((e as MessageEvent<string>).data) as T;
    let es: EventSource | undefined;
    let retryTimer: Timer;
    let reopenTimer: Timer;
    let staleTimer: Timer;
    let reloadTimer: Timer;
    let closed = false;

    const load = async () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      try {
        await handlers.current.reload();
      } catch (err) {
        console.error("NetPulse: failed to load data", err);
        dispatch({ type: "LOAD_FAILED", message: loadErrorMessage(err) });
        if (!closed) retryTimer = setTimeout(load, RETRY_MS);
      }
    };

    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, DEVICES_RELOAD_MS);
    };

    const checkKnown = (deviceId: number | null) => {
      if (!(handlers.current.isKnown?.(deviceId) ?? true)) scheduleReload();
    };

    const open = () => {
      reopenTimer = undefined;
      const source = new EventSource("/api/stream");
      es = source;
      source.onopen = () => {
        clearTimeout(staleTimer);
        staleTimer = undefined;
        dispatch({ type: "CONNECTED" });
        load();
      };
      source.onerror = () => {
        dispatch({ type: "DISCONNECTED" });
        staleTimer ??= setTimeout(() => dispatch({ type: "STALE" }), STALE_MS);
        // The browser retries on its own unless the stream is CLOSED (e.g. a proxy error page).
        if (source.readyState === EventSource.CLOSED && !closed && reopenTimer === undefined) {
          source.close();
          reopenTimer = setTimeout(open, REOPEN_MS);
        }
      };
      source.addEventListener("status", (e) => {
        const payload = parse<StatusPayload>(e);
        dispatch({ type: "STATUS", payload });
        checkKnown(payload.device_id);
        handlers.current.onStatus?.(payload);
      });
      source.addEventListener("result", (e) => {
        const payload = parse<ResultPayload>(e);
        dispatch({ type: "RESULT", payload });
        checkKnown(payload.device_id);
      });
      source.addEventListener("event", (e) => {
        const event = parse<EventOut>(e);
        dispatch({ type: "EVENT", event });
        checkKnown(event.device_id);
        handlers.current.onEvent?.(event);
      });
      source.addEventListener("devices", scheduleReload);
    };

    open();

    return () => {
      closed = true;
      for (const t of [retryTimer, reopenTimer, staleTimer, reloadTimer]) clearTimeout(t);
      es?.close();
    };
  }, [dispatch]);
}
