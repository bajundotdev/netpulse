import { useEffect, useRef, useState } from "react";
import { getHistory } from "@/api/client";
import { createDebouncer, latestOnly } from "@/features/history";
import type { HistoryOut, Range } from "@/types";

const REFRESH_MS = 60_000;
const STATUS_REFETCH_MS = 2000;

export interface HistoryState {
  data: HistoryOut | null;
  error: unknown;
}

// Fetches /api/history on mount, when the range or device set changes, and every 60 s.
// A change of statusKey (device statuses) triggers one extra debounced refetch.
// Keeps the last good data when a refresh fails.
export function useHistory(range: Range, deviceIdsKey: string, statusKey: string): HistoryState {
  const [state, setState] = useState<HistoryState>({ data: null, error: null });
  const [guard] = useState(latestOnly);

  const reload = useRef<(() => void) | null>(null);
  const firstStatus = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      guard(getHistory(range))
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
  }, [guard, range, deviceIdsKey]);

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
