import { useEffect, useMemo, useState } from "react";
import { Alert, Col, Container, Row } from "react-bootstrap";
import DeviceDetail from "./components/DeviceDetail.jsx";
import DeviceToolbar from "./components/DeviceToolbar.jsx";
import DeviceForm from "./components/DeviceForm.jsx";
import DeviceGrid from "./components/DeviceGrid.jsx";
import EventLog from "./components/EventLog.jsx";
import StatusPanel from "./components/StatusPanel.jsx";
import SummaryStrip from "./components/SummaryStrip.jsx";
import TopBar from "./components/TopBar.jsx";
import { SORT_OPTIONS, filterDevices, sortDevices } from "./components/deviceView.js";
import { readPref, writePref } from "./state/prefs.js";
import { useMonitor } from "./state/MonitorContext.jsx";
import { useHistory } from "./state/useHistory.js";

export default function App() {
  const { state, reload } = useMonitor();
  const [dismissedError, setDismissedError] = useState(null);
  const [detailId, setDetailId] = useState(null);
  // null = closed, {} = add, {device} = edit
  const [form, setForm] = useState(null);

  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [view, setView] = useState(() => readPref("netpulse.view", "list", ["list", "cards"]));
  const [sort, setSort] = useState(() =>
    readPref("netpulse.sort", "problems", SORT_OPTIONS.map((o) => o.key)),
  );
  const [range, setRange] = useState(() => readPref("netpulse.range", "24h", ["1h", "24h", "7d"]));
  const history = useHistory(range, state.order.join(","));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const changeView = (v) => {
    setView(v);
    writePref("netpulse.view", v);
  };
  const changeRange = (r) => {
    setRange(r);
    writePref("netpulse.range", r);
  };
  const changeSort = (s) => {
    setSort(s);
    writePref("netpulse.sort", s);
  };

  const devices = state.order.map((id) => state.devices[id]);
  const visible = useMemo(
    () => sortDevices(filterDevices(devices, query), sort),
    [state.devices, state.order, query, sort],
  );
  const detail = detailId !== null ? state.devices[detailId] : null;
  const showError = state.loadError && state.loadError !== dismissedError;

  const onSaved = async () => {
    setForm(null);
    await reload();
  };

  return (
    <>
      <TopBar connected={state.connected} onAdd={() => setForm({})} />
      <Container fluid>
        {showError && (
          <Alert variant="danger" dismissible onClose={() => setDismissedError(state.loadError)}>
            Could not load data from the NetPulse server: {state.loadError}
          </Alert>
        )}
        {state.stale && (
          <Alert variant="warning">
            Lost connection to the NetPulse server — statuses below are stale
          </Alert>
        )}
        {devices.length > 0 && (
          <StatusPanel
            devices={devices}
            history={history.data}
            range={range}
            onRange={changeRange}
            error={history.error}
          />
        )}
        <SummaryStrip devices={devices} />
        <Row className="g-3">
          <Col lg={8} className={state.stale ? "opacity-50" : undefined}>
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
            {/* The list view arrives with DeviceList; until then both views render the card grid. */}
            {devices.length > 0 && visible.length === 0 ? (
              <p className="text-body-secondary">No devices match “{query.trim()}”</p>
            ) : (
              <DeviceGrid devices={visible} now={now} onOpen={setDetailId} />
            )}
          </Col>
          <Col lg={4}>
            <EventLog />
          </Col>
        </Row>
      </Container>
      {detail && !form && (
        <DeviceDetail
          device={detail}
          onClose={() => setDetailId(null)}
          onEdit={(device) => setForm({ device })}
        />
      )}
      {form && <DeviceForm device={form.device} onSaved={onSaved} onClose={() => setForm(null)} />}
    </>
  );
}
