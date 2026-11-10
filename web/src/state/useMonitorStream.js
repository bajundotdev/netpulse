import { useEffect, useRef } from "react";

const RETRY_MS = 5000;
const REOPEN_MS = 3000;
const STALE_MS = 10000;
const DEVICES_RELOAD_MS = 300;

// Opens the SSE stream. Every (re)open reloads a full snapshot so nothing missed while offline is lost.
// Device list changes made elsewhere (another tab, the API) arrive as "devices" messages, and any
// message for a device this page does not know, both trigger a debounced snapshot reload.
export function useMonitorStream(dispatch, reload, onStatus, onEvent, isKnown) {
  const handlers = useRef({ reload, onStatus, onEvent, isKnown });
  handlers.current = { reload, onStatus, onEvent, isKnown };

  useEffect(() => {
    const parse = (e) => JSON.parse(e.data);
    let es = null;
    let retryTimer = null;
    let reopenTimer = null;
    let staleTimer = null;
    let reloadTimer = null;
    let closed = false;

    const load = async () => {
      clearTimeout(retryTimer);
      retryTimer = null;
      try {
        await handlers.current.reload();
      } catch (err) {
        console.error("NetPulse: failed to load data", err);
        dispatch({ type: "LOAD_FAILED", message: err?.detail ?? err?.message ?? String(err) });
        if (!closed) retryTimer = setTimeout(load, RETRY_MS);
      }
    };

    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, DEVICES_RELOAD_MS);
    };

    const checkKnown = (deviceId) => {
      if (!(handlers.current.isKnown?.(deviceId) ?? true)) scheduleReload();
    };

    const open = () => {
      reopenTimer = null;
      es = new EventSource("/api/stream");
      es.onopen = () => {
        clearTimeout(staleTimer);
        staleTimer = null;
        dispatch({ type: "CONNECTED" });
        load();
      };
      es.onerror = () => {
        dispatch({ type: "DISCONNECTED" });
        staleTimer ??= setTimeout(() => dispatch({ type: "STALE" }), STALE_MS);
        // The browser retries on its own unless the stream is CLOSED (e.g. a proxy error page).
        if (es.readyState === EventSource.CLOSED && !closed && reopenTimer === null) {
          es.close();
          reopenTimer = setTimeout(open, REOPEN_MS);
        }
      };
      es.addEventListener("status", (e) => {
        const payload = parse(e);
        dispatch({ type: "STATUS", payload });
        checkKnown(payload.device_id);
        handlers.current.onStatus?.(payload);
      });
      es.addEventListener("result", (e) => {
        const payload = parse(e);
        dispatch({ type: "RESULT", payload });
        checkKnown(payload.device_id);
      });
      es.addEventListener("event", (e) => {
        const event = parse(e);
        dispatch({ type: "EVENT", event });
        checkKnown(event.device_id);
        handlers.current.onEvent?.(event);
      });
      es.addEventListener("devices", scheduleReload);
    };

    open();

    return () => {
      closed = true;
      for (const t of [retryTimer, reopenTimer, staleTimer, reloadTimer]) clearTimeout(t);
      es.close();
    };
  }, [dispatch]);
}
