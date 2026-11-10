import { useEffect, useRef } from "react";

const RETRY_MS = 5000;

// Opens the SSE stream. Every (re)open reloads a full snapshot so nothing missed while offline is lost.
export function useMonitorStream(dispatch, reload, onStatus, onEvent) {
  const handlers = useRef({ reload, onStatus, onEvent });
  handlers.current = { reload, onStatus, onEvent };

  useEffect(() => {
    const es = new EventSource("/api/stream");
    const parse = (e) => JSON.parse(e.data);
    let retryTimer = null;
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

    es.onopen = () => {
      dispatch({ type: "CONNECTED" });
      load();
    };
    es.onerror = () => dispatch({ type: "DISCONNECTED" });
    es.addEventListener("status", (e) => {
      const payload = parse(e);
      dispatch({ type: "STATUS", payload });
      handlers.current.onStatus?.(payload);
    });
    es.addEventListener("result", (e) => dispatch({ type: "RESULT", payload: parse(e) }));
    es.addEventListener("event", (e) => {
      const event = parse(e);
      dispatch({ type: "EVENT", event });
      handlers.current.onEvent?.(event);
    });

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      es.close();
    };
  }, [dispatch]);
}
