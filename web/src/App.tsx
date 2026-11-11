import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import DeviceDetail from "./components/DeviceDetail";
import DeviceToolbar from "./components/DeviceToolbar";
import DeviceForm from "./components/DeviceForm";
import DeviceGrid from "./components/DeviceGrid";
import DeviceList from "./components/DeviceList";
import EventLog from "./components/EventLog";
import StatusPanel from "./components/StatusPanel";
import SummaryStrip from "./components/SummaryStrip";
import TopBar from "./components/TopBar";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SORT_OPTIONS, filterDevices, sortDevices } from "@/features/deviceView";
import { readPref, writePref } from "./state/prefs";
import { useMonitor } from "./state/MonitorContext";
import { historyForRange } from "@/features/history";
import type { LiveDevice, Range, SortKey } from "@/types";
import { useHistory } from "./state/useHistory";

// null = closed, {} = add, {device} = edit
type FormState = { device?: LiveDevice } | null;

export default function App() {
  const { state, reload } = useMonitor();
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(null);

  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [view, setView] = useState(() => readPref<"list" | "cards">("netpulse.view", "list", ["list", "cards"]));
  const [sort, setSort] = useState(() =>
    readPref<SortKey>("netpulse.sort", "problems", SORT_OPTIONS.map((o) => o.key)),
  );
  const [range, setRange] = useState(() => readPref<Range>("netpulse.range", "24h", ["1h", "24h", "7d"]));
  const statusKey = state.order.map((id) => `${id}:${state.devices[id]?.status}`).join(",");
  const history = useHistory(range, state.order.join(","), statusKey);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const changeView = (v: typeof view) => {
    setView(v);
    writePref("netpulse.view", v);
  };
  const changeRange = (r: typeof range) => {
    setRange(r);
    writePref("netpulse.range", r);
  };
  const changeSort = (s: typeof sort) => {
    setSort(s);
    writePref("netpulse.sort", s);
  };

  const devices = useMemo(() => state.order.map((id) => state.devices[id]), [state.order, state.devices]);
  const visible = useMemo(() => sortDevices(filterDevices(devices, query), sort), [devices, query, sort]);
  const detail = detailId !== null ? state.devices[detailId] : null;
  // Dialogs chain (Detail -> Edit form) and Radix only restores focus to a DialogTrigger, so the
  // opener of the first dialog is remembered here and focused once the last one has closed.
  const dialogOpen = Boolean(form) || Boolean(detail);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const rememberOpener = () => {
    if (!dialogOpen) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const openDetail = (id: number) => {
    rememberOpener();
    setDetailId(id);
  };
  const openAdd = () => {
    rememberOpener();
    setForm({});
  };
  useEffect(() => {
    if (dialogOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // After Radix has finished unmounting; a removed opener (deleted device) falls back to search.
    const t = setTimeout(() => {
      const target = opener.current?.isConnected
        ? opener.current
        : document.querySelector<HTMLElement>('input[aria-label="Search devices"]');
      target?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [dialogOpen]);

  const showError = state.loadError && state.loadError !== dismissedError;

  const onSaved = async () => {
    setForm(null);
    await reload();
  };

  return (
    <>
      <TopBar connected={state.connected} onAdd={openAdd} />
      <main className="w-full px-4 pb-6">
        {showError && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>
              Could not load data from the NetPulse server: {state.loadError}
            </AlertDescription>
            <AlertAction>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Close alert"
                onClick={() => setDismissedError(state.loadError)}
              >
                <X aria-hidden="true" />
              </Button>
            </AlertAction>
          </Alert>
        )}
        {state.stale && (
          <Alert className="mb-3 border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <AlertDescription className="text-current">
              Lost connection to the NetPulse server — statuses below are stale
            </AlertDescription>
          </Alert>
        )}
        {devices.length > 0 && (
          <StatusPanel
            stale={state.stale}
            devices={devices}
            history={historyForRange(history.data, range)}
            range={range}
            onRange={changeRange}
            error={history.error}
          />
        )}
        <SummaryStrip devices={devices} />
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={state.stale ? "opacity-50 lg:col-span-2" : "lg:col-span-2"}>
            <DeviceToolbar
              total={devices.length}
              shown={visible.length}
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={changeSort}
              view={view}
              onView={changeView}
            />
            {devices.length > 0 && visible.length === 0 ? (
              <p className="text-muted-foreground">No devices match “{query.trim()}”</p>
            ) : view === "list" ? (
              <DeviceList
                devices={visible}
                history={historyForRange(history.data, range)}
                range={range}
                now={now}
                onOpen={openDetail}
              />
            ) : (
              <DeviceGrid devices={visible} now={now} onOpen={openDetail} />
            )}
          </div>
          <div>
            <EventLog />
          </div>
        </div>
      </main>
      {detail && !form && (
        <DeviceDetail
          device={detail}
          onClose={() => setDetailId(null)}
          onEdit={(device: LiveDevice) => setForm({ device })}
        />
      )}
      {form && <DeviceForm device={form.device} onSaved={onSaved} onClose={() => setForm(null)} />}
    </>
  );
}
