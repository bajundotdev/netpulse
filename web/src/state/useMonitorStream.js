import { useEffect, useRef } from "react";

// Opens the SSE stream. Every (re)open reloads a full snapshot so nothing missed while offline is lost.
export function useMonitorStream(dispatch, reload, onStatus, onEvent) {
  const handlers = useRef({ reload, onStatus, onEvent });
  handlers.current = { reload, onStatus, onEvent };

  useEffect(() => {
    const es = new EventSource("/api/stream");
    const parse = (e) => JSON.parse(e.data);

    es.onopen = () => {
      dispatch({ type: "CONNECTED" });
      Promise.resolve(handlers.current.reload()).catch(() => {});
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

    return () => es.close();
  }, [dispatch]);
}
