import { useEffect, useRef, useState } from "react";
import { getHistory } from "../api.js";
import { createDebouncer, latestOnly } from "../components/history.js";

const REFRESH_MS = 60_000;
const STATUS_REFETCH_MS = 2000;

// Fetches /api/history on mount, when the range or device set changes, and every 60 s.
// A change of statusKey (device statuses) triggers one extra debounced refetch.
// Keeps the last good data when a refresh fails.
export function useHistory(range, deviceIdsKey, statusKey) {
  const [state, setState] = useState({ data: null, error: null });
  const guard = useRef(null);
  guard.current ??= latestOnly();

  const reload = useRef(null);
  const firstStatus = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      guard
        .current(getHistory(range))
        .then((data) => !cancelled && setState({ data, error: null }))
        .catch((error) => !cancelled && setState((s) => ({ ...s, error })));
    reload.current = load;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      reload.current = null;
      clearInterval(t);
    };
  }, [range, deviceIdsKey]);

  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return undefined;
    }
    const debounced = createDebouncer(() => reload.current?.(), STATUS_REFETCH_MS);
    debounced();
    return debounced.cancel;
  }, [statusKey]);

  return state;
}
