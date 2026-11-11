import { useEffect, useRef, useState } from "react";
import { getHistory } from "../api.js";
import { latestOnly } from "../components/history.js";

const REFRESH_MS = 60_000;

// Fetches /api/history on mount, when the range or device set changes, and every 60 s.
// Keeps the last good data when a refresh fails.
export function useHistory(range, deviceIdsKey) {
  const [state, setState] = useState({ data: null, error: null });
  const guard = useRef(null);
  guard.current ??= latestOnly();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      guard
        .current(getHistory(range))
        .then((data) => !cancelled && setState({ data, error: null }))
        .catch((error) => !cancelled && setState((s) => ({ ...s, error })));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [range, deviceIdsKey]);

  return state;
}
