# Status Panel, List/Card Views and Status History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A status-page style dashboard: overall status panel with a problems timeline and status strip, an expandable device list with per-device history bars and uptime %, a list/card toggle with search and sort, and a light/dark theme — backed by 30 days of status history.

**Architecture:** A `HistoryWriter` bus subscriber appends every `"status"` message to a new `status_history` table; a pure domain module turns a device's status changes into time slots and uptime %; `GET /api/history` serves all devices for a range. The React app adds a theme toggle, a toolbar with pure filter/sort helpers, a `StatusPanel` and a `DeviceList`, reusing `StatusStrip`, `PortChips` and the existing `DeviceDetail` modal.

**Tech Stack:** FastAPI 0.162+, SQLAlchemy 2.1 (SQLite), pytest · React 19, React-Bootstrap 2.10 / Bootstrap 5.3 colour modes, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-11-status-panel-and-views-design.md` (addendum to `docs/superpowers/specs/2026-11-10-netpulse-design.md`). Read both.

## Global Constraints

- History retention 30 days; keep the newest row per device older than the cut-off. Prune at startup and hourly.
- Statuses stored: `UNKNOWN`, `UP`, `DEGRADED`, `DOWN`, `PAUSED`, `STOPPED`. Slot ranking `DOWN > DEGRADED > UP`; else `PAUSED` if paused time present; else `None`.
- Ranges: `1h` = 60 slots × 60 s; `24h` = 96 slots × 900 s; `7d` = 84 slots × 7200 s. Default `24h`; other values → 422.
- `end` = now rounded **up** to the slot length (UTC epoch multiple); `start = end - window`.
- Uptime % = UP time ÷ (UP + DEGRADED + DOWN time) × 100, rounded to 2 decimals; `None` when the denominator is 0.
- "Problems in the last hour" = rows in the last 3600 s with status `DOWN`/`DEGRADED` whose previous row for that device had a different status (or no previous row).
- Event-log "Clear" never touches `status_history`; deleting a device cascades its history.
- Only Bootstrap's default font and theme colours (CSS variables / utilities). Panel background `linear-gradient(135deg, var(--bs-primary-bg-subtle), var(--bs-success-bg-subtle))`; chart `var(--bs-success)` (fill 25 % opacity); slot colours UP `--bs-success`, DEGRADED `--bs-warning`, DOWN `--bs-danger`, PAUSED/no data `--bs-secondary-bg`.
- Theme: `data-bs-theme` on `<html>`; localStorage key `netpulse.theme` (`light`/`dark`), else `prefers-color-scheme`. View key `netpulse.view` (`list`/`cards`, default `list`), sort key `netpulse.sort` (default `problems`), range key `netpulse.range` (default `24h`). All localStorage access in try/catch.
- Search fields: name, host, kind label, status, notes, TCP port numbers; case-insensitive, trimmed, literal (no regex).
- Sort keys: `problems` (DOWN, DEGRADED, UNKNOWN, UP, PAUSED, then name), `name`, `host` (IPv4 numeric; hostnames after IPs, alphabetical), `latency` (latest sample ascending, missing last).
- No AI attribution anywhere. Backend tests run with `-W error::ResourceWarning` and `filterwarnings = error::DeprecationWarning` (already in pytest.ini).

## Review Focus

1. **Labels in the wrong timezone** — server slots are UTC; the admin reads local time. Slot titles and axis labels must be local. Test in Task 6 (`slotTitle renders local time`).
2. **Device added part-way through the window** — slots before its first row are "no data" and do not count against uptime. Test in Task 1 (`test_device_added_mid_window_has_leading_none_and_full_uptime`).
3. **History missing a device** (added since the last fetch, or history request failed) — its row shows "No history yet" instead of crashing. Test in Task 7 (`historyFor returns null for unknown device`).
4. **Search text with spaces or regex characters** (`"10.0.0.1 "`, `"("`, `"dc*"`) — trimmed and matched literally, never throws. Test in Task 5.
5. **Fast range switching** — a slow `24h` response arriving after a `1h` one must not overwrite it. Test in Task 6 (`latestOnly drops stale responses`).

---

## File map

```
backend/app/domain/history.py            RANGES, window(), bucketize(), uptime_pct(), worst(), overall()
backend/app/infra/db.py                  + StatusHistoryRow
backend/app/infra/repositories.py        + StatusHistoryRepository
backend/app/services/history.py          HistoryWriter, HistoryService
backend/app/schemas.py                   + HistoryOut, DeviceHistoryOut, OverallHistoryOut
backend/app/api/routes.py                + GET /history
backend/app/main.py                      wire writer, pruning task, STOPPED on shutdown
backend/tests/domain/test_history.py, tests/infra/test_history_repo.py, tests/api/test_history_api.py
web/src/state/theme.js (+test)           readTheme, applyTheme, writeTheme
web/src/state/prefs.js (+test)           readPref, writePref (localStorage in try/catch)
web/src/components/deviceView.js (+test) SORT_OPTIONS, filterDevices, sortDevices, compareHosts, problemLine, headline
web/src/components/history.js (+test)    slotTitle, axisLabels, slotVariant, historyFor, latestOnly
web/src/state/useHistory.js
web/src/components/ThemeToggle.jsx, DeviceToolbar.jsx, PortChips.jsx, KindIcon.jsx,
                   StatusStrip.jsx, ProblemsChart.jsx, StatusPanel.jsx, DeviceList.jsx, DeviceRow.jsx
web/src/App.jsx, TopBar.jsx, DeviceCard.jsx, DeviceGrid.jsx, api.js, main.jsx (modified)
web/src/app.css                          panel gradient + strip block sizes only
```

---

# Backend

### Task 1: History domain logic

**Files:**
- Create: `backend/app/domain/history.py`
- Test: `backend/tests/domain/test_history.py`

**Interfaces:**
- Produces:
  - `RANGES: dict[str, tuple[int, int]]` = `{"1h": (3600, 60), "24h": (86400, 900), "7d": (604800, 7200)}` (window seconds, slot seconds)
  - `window(range_key: str, now: datetime) -> tuple[datetime, datetime, int]` → `(start, end, bucket_s)`; `KeyError` for unknown keys
  - `Transition = tuple[datetime, str]` (aware UTC ts, status)
  - `bucketize(transitions: list[Transition], start: datetime, end: datetime, bucket_s: int, now: datetime) -> list[str | None]`
  - `uptime_pct(transitions: list[Transition], start: datetime, end: datetime, now: datetime) -> float | None`
  - `worst(values: Iterable[str | None]) -> str | None` (the slot rule from Global Constraints, applied across devices too)
  - `overall(per_device: list[list[str | None]]) -> tuple[list[int], list[str | None]]` → `(problems, status)`
- `transitions` may include rows before `start` (the status holding at `start`); time after `now` inside the last slot is not counted.

- [ ] **Step 1: Write the failing tests** (helper `t(minutes)` = fixed UTC base + minutes; `NOW = t(60)`)

```python
def test_window_rounds_end_up_to_slot_and_counts_slots():
    start, end, b = window("24h", datetime(2026, 11, 11, 5, 7, tzinfo=UTC))
    assert (b, end) == (900, datetime(2026, 11, 11, 5, 15, tzinfo=UTC))
    assert (end - start) == timedelta(hours=24)

def test_status_holds_until_next_row():
    s = bucketize([(t(-10), "UP"), (t(30), "DOWN")], t(0), t(60), 600, NOW)
    assert s == ["UP", "UP", "UP", "DOWN", "DOWN", "DOWN"]

def test_worst_status_wins_inside_a_slot():
    s = bucketize([(t(0), "UP"), (t(3), "DOWN"), (t(4), "UP")], t(0), t(10), 600, NOW)
    assert s == ["DOWN"]

def test_degraded_beats_up_paused_only_when_nothing_else():
    assert worst(["UP", "DEGRADED", "PAUSED"]) == "DEGRADED"
    assert worst(["PAUSED", None]) == "PAUSED"
    assert worst([None, "STOPPED", "UNKNOWN"]) is None

def test_device_added_mid_window_has_leading_none_and_full_uptime():
    tr = [(t(30), "UNKNOWN"), (t(30.1), "UP")]
    assert bucketize(tr, t(0), t(60), 600, NOW)[:3] == [None, None, None]
    assert uptime_pct(tr, t(0), t(60), NOW) == 100.0

def test_uptime_excludes_paused_stopped_unknown():
    tr = [(t(0), "UP"), (t(20), "DOWN"), (t(30), "PAUSED"), (t(40), "STOPPED"), (t(50), "UP")]
    assert uptime_pct(tr, t(0), t(60), NOW) == 75.0   # UP 30 min of 40 counted

def test_no_rows_gives_all_none_and_no_uptime(): ...
def test_slots_after_now_are_none(): ...           # now = t(25), window to t(60): slots 3..5 None
def test_overall_counts_problem_devices_and_worst_status():
    problems, status = overall([["UP", "DOWN", None], ["DEGRADED", "DOWN", None]])
    assert problems == [1, 2, 0] and status == ["DEGRADED", "DOWN", None]
```

- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/domain/test_history.py -v` → FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** as pure functions over sorted `(ts, status)` segments: build `[seg_start, seg_end)` intervals clipped to `[start, min(end, now))`, then intersect with each slot. No I/O, no SQLAlchemy imports.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat: status history slots and uptime calculation"`

### Task 2: History table, writer, retention and STOPPED on shutdown

**Files:**
- Modify: `backend/app/infra/db.py` (add `StatusHistoryRow`), `backend/app/infra/repositories.py` (add `StatusHistoryRepository`), `backend/app/main.py` (container field `history`, writer subscription, prune task, STOPPED on shutdown)
- Create: `backend/app/services/history.py` (`HistoryWriter` now; `HistoryService` in Task 3)
- Test: `backend/tests/infra/test_history_repo.py`, `backend/tests/services/test_history_writer.py` (add `tests/services/__init__.py`)

**Interfaces:**
- Consumes: `make_session_factory`, `DbRunner` (`await db(fn, *args)`), `EventBus.subscribe`, the `"status"` payload `{device_id, status, previous_status, since, consecutive_failures}` (`since` ISO UTC).
- Produces:
  - `StatusHistoryRow(id, device_id FK devices.id ON DELETE CASCADE, status: str, ts: datetime)`, `__table_args__ = (Index("ix_status_history_device_ts", "device_id", "ts"), {"sqlite_autoincrement": True})`
  - `StatusHistoryRepository(session_factory)`: `add(device_id: int, status: str, ts: datetime) -> None`; `add_many(device_ids: list[int], status: str, ts: datetime) -> None`; `window_rows(start: datetime, end: datetime) -> dict[int, list[Transition]]` (per device, ordered, including the last row before `start`); `problem_entries_since(since: datetime) -> int`; `prune(cutoff: datetime) -> int` (deletes rows older than `cutoff` except each device's newest such row; returns deleted count). Timestamps stored naive UTC, returned aware UTC (same convention as events).
  - `HistoryWriter(repo, run)`: `async handle(payload: dict) -> None` (uses `payload["since"]` as `ts`); `async stopped(device_ids: list[int], ts: datetime) -> None`.
  - `Container.history: StatusHistoryRepository`; lifespan: prune once at startup, then an hourly task (cancelled on shutdown); on shutdown, after `monitor.stop()` and before `db.shutdown()`, write `STOPPED` for all device ids.

- [ ] **Step 1: Failing tests**

```python
def test_window_rows_include_last_row_before_start(repo): ...      # rows at t-120, t-10, t+5 → window t..t+60 returns [t-10, t+5]
def test_problem_entries_count_only_entries_into_problem(repo):
    # UP, DOWN, DOWN (repeat), DEGRADED, UP, DOWN within the hour → 3
def test_prune_keeps_newest_row_before_cutoff(repo): ...           # 3 old rows + 1 new → prune deletes 2, window still knows status at cutoff
def test_delete_device_cascades_history(devices, repo): ...
def test_clear_event_log_leaves_history(events, repo): ...
async def test_writer_appends_status_messages(repo): ...           # handle({"device_id":1,"status":"DOWN","since":iso,...}) → one row with that ts
async def test_writer_stopped_rows_for_all_devices(repo): ...
def test_shutdown_writes_stopped(settings): ...                    # TestClient(create_app(settings, factory=fake_factory(), start_monitor=False)) — fixtures from tests/api/conftest.py; add 2 devices, exit the client, reopen the DB → each device's last row is STOPPED
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/infra/test_history_repo.py tests/services -v` → FAIL.
- [ ] **Step 3: Implement.** The prune query: `DELETE FROM status_history WHERE ts < :cutoff AND id NOT IN (SELECT MAX(id) FROM status_history WHERE ts < :cutoff GROUP BY device_id)`. The hourly task is a plain `asyncio` loop created in lifespan with `RETENTION = timedelta(days=30)`, `PRUNE_EVERY_S = 3600`.
- [ ] **Step 4: Run** full backend suite `-W error::ResourceWarning` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: record status history with 30-day retention"` (after `git add backend`).

### Task 3: History service and `GET /api/history`

**Files:**
- Modify: `backend/app/services/history.py` (add `HistoryService`), `backend/app/schemas.py`, `backend/app/api/routes.py`, `backend/app/main.py` (container field `history_service`)
- Test: `backend/tests/api/test_history_api.py`

**Interfaces:**
- Consumes: Task 1 functions, Task 2 repository, `DeviceRepository.list()` (current device ids).
- Produces:
  - `HistoryService(history_repo, device_repo, run, clock=lambda: datetime.now(UTC))`: `async get(range_key: str) -> dict` shaped exactly as spec §2.3.
  - Schemas: `DeviceHistoryOut(device_id: int, buckets: list[str | None], uptime_pct: float | None)`, `OverallHistoryOut(problems: list[int], status: list[str | None])`, `HistoryOut(range: str, start: datetime, end: datetime, bucket_seconds: int, problems_last_hour: int, overall: OverallHistoryOut, devices: list[DeviceHistoryOut])`.
  - Route: `GET /api/history?range=` with `range: Literal["1h", "24h", "7d"] = "24h"` → `HistoryOut`.

- [ ] **Step 1: Failing tests** (no clock injection through `create_app`: seed rows relative to `datetime.now(UTC)` through `client.app.state.container.history`; unit-test `HistoryService` directly with a fixed `clock` where exact alignment matters)

```python
def test_history_default_range_and_shape(client): ...           # keys, 96 slots, bucket_seconds 900, start/end aligned
@pytest.mark.parametrize("r,n", [("1h", 60), ("24h", 96), ("7d", 84)])
def test_history_slot_counts(client, r, n): ...
def test_history_bad_range_is_422(client): ...                   # ?range=30d
def test_history_reports_down_slots_and_problem_count(client):
    # device UP, DOWN for 5 minutes in the last hour, UP again → its buckets contain "DOWN",
    # overall.status has "DOWN" at the same index, problems_last_hour == 1
def test_history_only_lists_current_devices(client): ...         # deleted device absent
def test_history_7d_with_20_devices_is_fast(client):
    # 20 devices × 30 days, a change every 30 min (~28,800 rows) → GET ?range=7d under 0.2 s
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (one `window_rows` call, then per device `bucketize`/`uptime_pct`, then `overall`). **Step 4: Run** full suite → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: GET /api/history for status timeline and uptime"`

# Frontend

### Task 4: Light/dark theme toggle

**Files:**
- Create: `web/src/state/theme.js`, `web/src/state/theme.test.js`, `web/src/state/prefs.js`, `web/src/state/prefs.test.js`, `web/src/components/ThemeToggle.jsx`
- Modify: `web/src/main.jsx` (apply theme before first render), `web/src/components/TopBar.jsx` (add toggle before "Sound")

**Interfaces:**
- Produces: `readPref(key: string, fallback: string, allowed?: string[]) -> string`, `writePref(key: string, value: string) -> void` (both swallow storage errors); `readTheme({ storage?, matchMedia? }) -> "light" | "dark"`, `applyTheme(theme, root = document.documentElement)`, `writeTheme(theme)`; `<ThemeToggle />` (button with `aria-label` "Switch to dark theme"/"Switch to light theme", sun/moon inline SVG).

- [ ] **Step 1: Failing tests** — `readTheme` uses stored value; falls back to `matchMedia('(prefers-color-scheme: dark)').matches`; ignores invalid stored values; storage that throws → fallback. `readPref` returns fallback for values not in `allowed`.
- [ ] **Step 2: Run** `cd web && npm test` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat: light and dark theme toggle"`

### Task 5: Toolbar with search, sort and list/card toggle; shared port chips

**Files:**
- Create: `web/src/components/deviceView.js`, `web/src/components/deviceView.test.js`, `web/src/components/DeviceToolbar.jsx`, `web/src/components/PortChips.jsx`
- Modify: `web/src/components/DeviceCard.jsx` (use `PortChips`), `web/src/App.jsx` (toolbar, filtered+sorted devices, view state; lift the 1 s `now` tick from `DeviceGrid` into `App` and pass it down), `web/src/components/DeviceGrid.jsx` (take `now` prop)

**Interfaces:**
- Consumes: `readPref`/`writePref` (Task 4), `KIND_LABELS` (format.js), `resultFor` (ports.js).
- Produces:
  - `SORT_OPTIONS = [{key: "problems", label: "Problems first"}, {key: "name", label: "Name"}, {key: "host", label: "Host"}, {key: "latency", label: "Latency"}]`
  - `filterDevices(devices, query: string) -> Device[]`; `sortDevices(devices, key: string) -> Device[]` (new array); `compareHosts(a: string, b: string) -> number`
  - `problemLine(device) -> string | null` — `"DOWN (ping: timeout)"` from the failing liveness result, `"DEGRADED: tcp/389 refused, tcp/88 timeout"` from failing other results, else `null`
  - `headline(devices) -> {text: string, variant: "success" | "warning" | "danger" | "secondary"}` — "All N devices up" / "N devices down" / "N devices degraded" / "No devices yet" (singular "device" for 1; paused excluded from the up count)
  - `<PortChips device />` — exactly the chips `DeviceCard` renders today
  - `<DeviceToolbar total shown query onQuery sort onSort view onView />` — "N devices" or "Showing X of N"; view buttons `aria-pressed`
  - App state: `view` (`netpulse.view`), `sort` (`netpulse.sort`), `query` (not persisted)

- [ ] **Step 1: Failing tests**

```js
test("filter matches name, host, kind label, status, notes and port", ...);
test("filter trims and treats regex characters literally", () => {
  expect(filterDevices(ds, "  10.0.0.1 ")).toHaveLength(1);
  expect(() => filterDevices(ds, "(")).not.toThrow();
  expect(filterDevices(ds, "dc*")).toEqual([]);
});
test("problems sort: DOWN, DEGRADED, UNKNOWN, UP, PAUSED, then name", ...);
test("compareHosts orders IPv4 numerically and hostnames after IPs", () => {
  expect(["10.0.0.12", "dc01", "10.0.0.9"].sort(compareHosts)).toEqual(["10.0.0.9", "10.0.0.12", "dc01"]);
});
test("latency sort puts missing samples last", ...);
test("problemLine for DOWN and DEGRADED", ...);
test("headline wording and variants", ...);   // incl. singular "1 device down"
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Cards view = existing `DeviceGrid` fed the filtered, sorted list; empty filter result shows "No devices match “{query}”".
- [ ] **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: device toolbar with search, sort and view toggle"`

### Task 6: Status panel with timeline and status strip

**Files:**
- Create: `web/src/components/history.js`, `web/src/components/history.test.js`, `web/src/state/useHistory.js`, `web/src/components/StatusStrip.jsx`, `web/src/components/ProblemsChart.jsx`, `web/src/components/StatusPanel.jsx`, `web/src/app.css`
- Modify: `web/src/api.js` (`getHistory(range)` → `GET /history?range=`), `web/src/main.jsx` (import `app.css`), `web/src/App.jsx` (panel above toolbar)

**Interfaces:**
- Consumes: `HistoryOut` (Task 3), `headline` (Task 5), `readPref`/`writePref` (Task 4).
- Produces:
  - `slotTitle(startIso: string, bucketSeconds: number, index: number, status: string | null) -> string` — local-time range, e.g. `"14:15–14:30 · Down"` (`"No data"` for null; date prefix when the range is 7d)
  - `axisLabels(range: "1h" | "24h" | "7d") -> string[]` — 5 labels: 1h `["60m ago","45m","30m","15m","Now"]`, 24h `["24h ago","18h","12h","6h","Now"]`, 7d `["7d ago","5d","4d","2d","Now"]`
  - `slotVariant(status) -> "success" | "warning" | "danger" | "secondary"`
  - `historyFor(history, deviceId) -> {buckets, uptime_pct} | null`
  - `latestOnly() -> (promise) => Promise` — wraps fetches so only the most recently started one resolves into state
  - `useHistory(range, deviceIdsKey: string) -> {data, error}` — fetch on mount, on `range`/`deviceIdsKey` change, every 60 s; keeps last good `data` on error
  - `<StatusStrip slots startIso bucketSeconds height />` (one block per slot, `title` from `slotTitle`, colour from `slotVariant` via `bg-*` utilities / `--bs-secondary-bg`)
  - `<ProblemsChart values labels />` (inline SVG, responsive width, y max = max(1, …))
  - `<StatusPanel devices history range onRange error />`

- [ ] **Step 1: Failing tests** — `slotTitle renders local time` (set `process.env.TZ`-independent check: compare with `new Date(...).toLocaleTimeString` output for the same instant), axis labels per range, `slotVariant` mapping, `historyFor returns null for unknown device`, `latestOnly drops stale responses` (start A, start B, resolve B then A → only B applied).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Panel: card with the gradient from Global Constraints, `text-success`/`-warning`/`-danger` check/alert icon, headline `fs-2 fw-bold` in `--bs-emphasis-color`, sub-line `"{n} problems in the last hour"` (`"1 problem"` singular) in `--bs-secondary-color`, `ButtonGroup` 1h/24h/7d (`netpulse.range`), chart, axis labels, strip labelled "Status"; a small "History unavailable" note when `error` and no data.
- [ ] **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: status panel with problems timeline and status strip"`

### Task 7: Device list view with expandable history rows

**Files:**
- Create: `web/src/components/KindIcon.jsx`, `web/src/components/DeviceRow.jsx`, `web/src/components/DeviceList.jsx`
- Modify: `web/src/App.jsx` (render `DeviceList` when `view === "list"`)
- Test: add `history.test.js` cases only if a new pure helper is introduced; otherwise covered by the browser check

**Interfaces:**
- Consumes: `problemLine`, `PortChips`, `StatusStrip`, `historyFor`, `slotVariant`, `formatUptime`, `KIND_LABELS`.
- Produces: `<DeviceList devices history range now onOpen />`; `<DeviceRow device history range now expanded onToggle onOpen />`; `<KindIcon kind />` (inline SVG per kind dc/server/switch/printer/other, `aria-hidden`).

- [ ] **Step 1: Implement.** Row header is a `button`-role element (`aria-expanded`, Enter/Space toggles) with chevron, `KindIcon`, name, second line (`problemLine` or host in monospace), status pill (`Badge` with icon + word, `text="dark"` for warning). Expanded body: legend (Up, Degraded, Down, Paused / no data), `StatusStrip` (height 28), footer `"{axisLabels(range)[0]} · {uptime}% uptime · Now"` or `"No history yet"`, `PortChips`, latency, SNMP uptime, "Details" button → `onOpen(device.id)`. Several rows may be expanded (Set in component state).
- [ ] **Step 2: Run** `npm test && npm run build` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: expandable device list with history bars and uptime"`

### Task 8: Docs and verification

**Files:**
- Modify: `README.md` (dashboard section: panel, list/card, search/sort, theme; history retention and the crash-gap note), spec status line → "approved 2026-11-11"

- [ ] **Step 1:** Update README; run `cd backend && .venv/bin/pytest -W error::ResourceWarning` and `cd web && npm test && npm run build` → all pass.
- [ ] **Step 2:** Browser check (controller): both themes × both views; expand/collapse; search "389"; each sort; range 1h/24h/7d; take a test device DOWN and confirm red slots in its bar and the overall strip and the problem count; phone width; dark mode on every surface (modals, forms, event log).
- [ ] **Step 3: Commit** — `git commit -m "docs: dashboard views, theme and status history"`; vault notes updated by the controller.
