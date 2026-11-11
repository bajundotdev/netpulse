# TypeScript + Tailwind Frontend and Website / API Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the React frontend to TypeScript + Tailwind CSS + shadcn/ui with full feature parity, then add website/API monitoring (HTTP checks, `web` devices, certificate expiry) built in the new stack.

**Architecture:** Brick A converts the frontend in place: TypeScript toolchain and pure modules first, generated API types, then the Tailwind/shadcn foundation and screens area by area, ending with Bootstrap removed and component tests added. Brick B adds an `HttpChecker` strategy (httpx2, OS trust store), a certificate reader and detector, a small idempotent SQLite migration, the `web` device kind with `http` liveness, and the HTTP tab/chips in the new UI.

**Tech Stack:** TypeScript 7.0 (strict), React 19.3, Tailwind CSS 4.3 (`@tailwindcss/vite`), shadcn/ui (CLI 4.23, lucide-react, cva, clsx, tailwind-merge, tw-animate-css), Oxlint 1.93, Vite 8.3, Vitest 5.1 + jsdom + Testing Library, openapi-typescript · FastAPI, SQLAlchemy 2.1, httpx2 2.16 (+ truststore), cryptography.

**Spec:** `docs/superpowers/specs/2026-11-12-typescript-tailwind-and-http-checks-design.md` (extends the 2026-11-10 and 2026-11-11 specs). Read all three.

## Global Constraints

- Brick A is behaviour-preserving: no new features; the spec §2.1 parity list is the acceptance list.
- Styling: Tailwind default font stack and colour palette plus shadcn/ui default (neutral) theme variables only — no custom hex/oklch values. Status colours: UP `emerald-500`, DEGRADED `amber-500`, DOWN `red-500`, PAUSED/no data `zinc-300` / `dark:zinc-700`. Panel gradient `bg-linear-to-br from-sky-50 to-emerald-50 dark:from-sky-950 dark:to-emerald-950`.
- Dark mode: `.dark` class on `<html>`; localStorage key `netpulse.theme` (`light`/`dark`), else `prefers-color-scheme`.
- Existing localStorage keys keep their names and values: `netpulse.view`, `netpulse.sort`, `netpulse.range`, `netpulse.sound`.
- TypeScript `strict: true`; no `any` except in generated files; `@/` alias → `web/src`.
- Build: `tsc -b && vite build`; lint: `oxlint`; tests: `vitest run`. All must pass with no warnings.
- Bundle (gzip) after brick A: JS ≤ 127 kB, CSS ≤ 39 kB.
- HTTP checks: defaults `method GET`, `expect_status "200-399"`, `slow_ms 2000`, `cert_warn_days 14`, `verify_tls true`, `follow_redirects true`; body read cap 1 MB; `web` devices default `interval_s 30`, `timeout_ms 10000`; URLs http/https only.
- Secrets (HTTP auth secret, SNMP) write-only, encrypted with the existing `SecretBox`, never in responses, logs or 422 errors.
- Backend tests: `.venv/bin/pytest -W error::ResourceWarning` with DeprecationWarnings as errors (pytest.ini). No AI attribution anywhere.

## Review Focus

1. **Theme flash or wrong theme after the switch from `data-bs-theme` to `.dark`** — a user who chose dark before the upgrade must still get dark on first load, with no light flash. Test in Task 3 (`applyTheme sets the dark class before render` + stored value honoured).
2. **Keyboard and screen-reader behaviour lost in the rewrite** (dialog focus trap, Esc to close, tab order, `aria-pressed`, row `aria-expanded`, visible focus ring inside rows). Tests in Tasks 6–7 (Testing Library: Esc closes the dialog, toggle buttons expose pressed state, row header toggles `aria-expanded`).
3. **Generated API types drifting from the backend** — a backend schema change must fail the frontend test run. Test in Task 2 (`schema.d.ts is up to date`).
4. **Upgrading an existing database** — devices/checks/events/history created by the previous version survive and gain the new columns. Test in Task 8 (`test_migration_adds_columns_to_old_database`).
5. **HTTP secrets leaking** through `GET /api/devices`, `/checks`, 422 bodies, `/test` results or logs. Test in Task 9 (`test_http_secret_never_returned`).

---

## File map

```
web/
  package.json (scripts: dev, build "tsc -b && vite build", test "vitest run", lint "oxlint", gen:api)
  tsconfig.json, tsconfig.app.json, tsconfig.node.json, vite.config.ts, components.json, .oxlintrc.json
  scripts/export-openapi.mjs            runs backend python to dump openapi.json, then openapi-typescript
  src/index.css                          Tailwind + shadcn theme
  src/main.tsx, src/App.tsx
  src/api/schema.d.ts (generated), src/api/client.ts, src/api/schema.test.ts
  src/lib/utils.ts                       cn()
  src/components/ui/*.tsx                shadcn components
  src/components/*.tsx                   TopBar, ThemeToggle, StatusPanel, ProblemsChart, StatusStrip, SummaryStrip,
                                         DeviceToolbar, DeviceList, DeviceRow, DeviceGrid, DeviceCard, PortChips,
                                         HttpChips (B), KindIcon, Sparkline, DeviceDetail, DeviceForm, PortsTab,
                                         SnmpTab, HttpTab (B), EventLog
  src/features/{deviceView,history,ports,snmp,format,alerts,http}.ts + *.test.ts
  src/state/{monitorReducer,prefs,theme,singleFlight}.ts + tests, MonitorContext.tsx, useHistory.ts, useMonitorStream.ts
  src/test/setup.ts                      Testing Library + jsdom setup
  src/**/*.test.tsx                      component tests
backend/
  app/infra/migrate.py                   idempotent ALTER TABLE migration
  app/monitoring/checkers/http.py        HttpChecker
  app/monitoring/certs.py                CertReader (TLS handshake + cache)
  app/domain/detectors.py                + certificate detector in ChangeTracker
  app/domain/models.py                   CheckType.HTTP, CheckResult.slow, DeviceConfig.url
  app/domain/state.py                    slow → DEGRADED
  app/schemas.py, app/services/devices.py, app/infra/db.py, app/infra/repositories.py, app/monitoring/factory.py, app/main.py
  tests/... (mirrors)
```

---

# Brick A — Frontend migration

### Task 1: TypeScript toolchain and pure modules

**Files:**
- Create: `web/tsconfig.json`, `web/tsconfig.app.json`, `web/tsconfig.node.json`, `web/vite.config.ts` (replaces `vite.config.js`), `web/.oxlintrc.json`, `web/src/types.ts`
- Rename/convert to `.ts` with types: `src/api.js` → `src/api/client.ts`; `src/alerts.js`; `src/state/{monitorReducer,prefs,theme,singleFlight,useHistory,useMonitorStream}.js`; `src/components/{deviceView,history,ports,snmp,format}.js` → `src/features/*.ts`; all their `*.test.js` → `*.test.ts`
- Modify: `web/package.json` (scripts, devDeps `typescript@~7.0`, `@types/react`, `@types/react-dom`, `@types/node`, `oxlint`), imports in remaining `.jsx` files

**Interfaces:**
- Produces `src/types.ts`: `DeviceStatus = "UNKNOWN"|"UP"|"DEGRADED"|"DOWN"|"PAUSED"`, `SlotStatus = "UP"|"DEGRADED"|"DOWN"|"PAUSED"|null`, `Range = "1h"|"24h"|"7d"`, `View = "list"|"cards"`, `SortKey = "problems"|"name"|"host"|"latency"`, `LiveDevice` (DeviceOut fields + status, since, consecutive_failures, results, latency), `MonitorState`, `MonitorAction` (discriminated union of the existing reducer actions). Hand-written for now; Task 2 replaces the API-shaped parts with generated types.
- `tsconfig.app.json`: `strict`, `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `noEmit`, `jsx: "react-jsx"`, `allowJs: true` (temporary until Task 7), `paths: {"@/*": ["./src/*"]}`.

- [ ] **Step 1:** Install the devDependencies; add `"build": "tsc -b && vite build"`, `"lint": "oxlint"`, `"typecheck": "tsc -b"`.
- [ ] **Step 2:** Convert the pure modules and their tests to `.ts`, adding types; fix every strict error (no `any`, no `@ts-ignore`).
- [ ] **Step 3:** Run `npm run typecheck && npm run lint && npm test && npm run build` → all pass, 62+ tests, no warnings. The UI is unchanged (still Bootstrap).
- [ ] **Step 4: Commit** — `git commit -m "chore: TypeScript toolchain and typed core modules"` (after `git add web`).

### Task 2: Generated API types

**Files:**
- Create: `web/scripts/export-openapi.mjs`, `web/src/api/schema.d.ts` (generated), `web/src/api/schema.test.ts`
- Modify: `web/src/api/client.ts` (typed with `paths`/`components` from the schema), `web/src/types.ts` (API shapes become aliases of `components["schemas"][...]`), `web/package.json` (`gen:api`, devDep `openapi-typescript`)

**Interfaces:**
- `npm run gen:api`: runs `../backend/.venv/bin/python` (on Windows `..\\backend\\.venv\\Scripts\\python.exe`; detect by `process.platform`) with `-c "import json,sys; from app.main import create_app; json.dump(create_app().openapi(), sys.stdout)"` (cwd `../backend`) → `openapi.json` in a temp dir → `openapi-typescript` → `src/api/schema.d.ts`.
- `client.ts` exports the same function names as today, typed: e.g. `listDevices(): Promise<DeviceOut[]>`, `getHistory(range: Range): Promise<HistoryOut>`; `ApiError { status: number; detail: unknown }`.

- [ ] **Step 1: Failing test** `schema.d.ts is up to date`: the test regenerates the schema into a temp file and compares it with the committed file (skips with a clear message when the backend venv is missing).
- [ ] **Step 2:** Implement the script, generate, type the client. **Step 3:** typecheck, lint, test, build → pass. **Step 4: Commit** — `"chore: generate API types from the backend OpenAPI schema"`.

### Task 3: Tailwind + shadcn foundation and app shell

**Files:**
- Create: `web/src/index.css`, `web/components.json`, `web/src/lib/utils.ts`, `web/src/components/ui/*` (via `npx shadcn@4 add button badge card dialog tabs input label select switch textarea alert toggle-group tooltip separator`), `web/src/test/setup.ts`
- Convert: `main.jsx` → `main.tsx`, `App.jsx` → `App.tsx`, `TopBar`, `ThemeToggle`, `SummaryStrip` → `.tsx` in Tailwind
- Modify: `vite.config.ts` (`tailwindcss()` plugin, alias, vitest `environment: "jsdom"` for `*.test.tsx`, `setupFiles`), `state/theme.ts` (`.dark` class), `package.json` (deps `tailwindcss`, `@tailwindcss/vite`, shadcn runtime deps; devDeps `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`)

**Interfaces:**
- `applyTheme(theme, root = document.documentElement)` toggles `root.classList` `dark`; `readTheme` unchanged contract.
- Remove the `bootstrap/dist/css/bootstrap.min.css` import from `main.tsx` in this task. Components not yet converted keep using React-Bootstrap markup without Bootstrap CSS until Tasks 4–6 (Ruling: acceptable on the branch; nothing ships until Task 7).

- [ ] **Step 1: Failing tests:** `theme.test.ts` — `applyTheme("dark")` adds the `dark` class, `applyTheme("light")` removes it; stored `"dark"` from before the upgrade still yields dark. Component test `TopBar.test.tsx` — the theme button toggles the `dark` class and its `aria-label`; the Live/Reconnecting badge text.
- [ ] **Step 2:** Implement: shadcn init (style default, base colour neutral, css `src/index.css`), Tailwind import + `@custom-variant dark (&:is(.dark *))`, shell components.
- [ ] **Step 3:** typecheck, lint, test, build → pass. **Step 4: Commit** — `"feat: Tailwind and shadcn/ui foundation with the app shell"`.

### Task 4: Status panel and toolbar

**Files:** convert `StatusPanel`, `ProblemsChart`, `StatusStrip`, `DeviceToolbar` to `.tsx` (Tailwind/shadcn: `Card`, `ToggleGroup` for range and view, `Input` search, `Select` sort); tests `StatusPanel.test.tsx`, `DeviceToolbar.test.tsx`.

**Interfaces:** props unchanged from today's components (typed); `slotVariant` in `features/history.ts` now returns Tailwind class names (`bg-emerald-500`, `bg-amber-500`, `bg-red-500`, `bg-zinc-300 dark:bg-zinc-700`) — update its unit test.

- [ ] **Step 1: Failing tests:** range toggle exposes `aria-pressed`/`data-state="on"` for the active range and calls `onRange`; view toggle likewise; search input calls `onQuery`; panel shows "Loading history…" / "History unavailable" / "History may be out of date" in the three states; strip has `role="img"` with the summary label.
- [ ] **Step 2:** Implement. **Step 3:** typecheck, lint, test, build. **Step 4: Commit** — `"feat: status panel and toolbar in Tailwind"`.

### Task 5: Device views

**Files:** convert `DeviceList`, `DeviceRow`, `DeviceGrid`, `DeviceCard`, `PortChips`, `KindIcon` (lucide icons), `Sparkline` to `.tsx`; tests `DeviceRow.test.tsx`, `DeviceCard.test.tsx`.

**Interfaces:** unchanged props. Row header: `button` with `aria-expanded`, `aria-controls`, `focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`. Status pill = shadcn `Badge` with status variants via `cva`.

- [ ] **Step 1: Failing tests:** clicking the row header toggles `aria-expanded` and shows the history bar and uptime label; Details calls `onOpen(id)`; card shows port chips text `389 ✓` / `88 ✗` with the reason in `title`.
- [ ] **Step 2:** Implement. **Step 3:** typecheck, lint, test, build. **Step 4: Commit** — `"feat: device list and cards in Tailwind"`.

### Task 6: Dialogs, forms and event log; remove Bootstrap

**Files:** convert `DeviceDetail`, `DeviceForm`, `PortsTab`, `SnmpTab`, `EventLog` to `.tsx` (shadcn `Dialog`, `Tabs`, `Input`, `Select`, `Switch`, `Textarea`, `Alert`, table); remove `bootstrap` and `react-bootstrap` from `package.json`; delete `app.css` rules that only served Bootstrap; tests `DeviceForm.test.tsx`, `EventLog.test.tsx`, `DeviceDetail.test.tsx`.

**Interfaces:** unchanged props and API calls (now typed). 422 field errors still render beside fields.

- [ ] **Step 1: Failing tests:** form opens on General; Ports tab "Domain Controller preset" adds 8 ports; invalid host shows the server's 422 message beside Host (mocked client); Esc closes the dialog and focus returns to the opener; event log Ack button only on unacknowledged rows and calls `ackEvent`; Clear asks for confirmation.
- [ ] **Step 2:** Implement; `grep -r "react-bootstrap\|bootstrap" web/src` returns nothing. **Step 3:** typecheck, lint, test, build; record gzip sizes (must be JS ≤ 127 kB, CSS ≤ 39 kB). **Step 4: Commit** — `"feat: dialogs, forms and event log in Tailwind; remove Bootstrap"`.

### Task 7: Finish the migration

**Files:** convert any remaining `.jsx/.js`; set `allowJs: false`; `App.test.tsx` (smoke: renders with a mocked client and EventSource, shows the panel headline and device rows, switching view persists `netpulse.view`); README (stack, `npm run lint`, `npm run gen:api`, Node 22); spec status.

- [ ] **Step 1:** Failing App smoke test. **Step 2:** Finish conversion. **Step 3:** typecheck, lint, test, build, sizes. **Step 4: Commit** — `"chore: complete the TypeScript and Tailwind migration"`. Controller: browser check of the spec §2.1 parity list (both themes, phone width, keyboard).

# Brick B — Website and API monitoring

### Task 8: Model, migration and HTTP checker

**Files:**
- Create: `backend/app/infra/migrate.py`, `backend/app/monitoring/checkers/http.py`, tests `tests/infra/test_migrate.py`, `tests/monitoring/test_http_checker.py`
- Modify: `app/domain/models.py` (`CheckType.HTTP = "http"`, `CheckResult.slow: bool = False`, `DeviceConfig.url: str | None = None`), `app/domain/state.py` (a result with `slow=True` counts as failing for DEGRADED, message `"{label} slow {ms} ms"`; a slow liveness → DEGRADED, not DOWN), `app/infra/db.py` (`DeviceRow.url`, `CheckRow.secret_enc`), `app/main.py` (run `migrate(engine)` before use), `app/monitoring/factory.py` (register HTTP; liveness `http` builds an HttpChecker on `device.url`), `backend/requirements.txt` (`httpx2>=2.16,<3`)

**Interfaces:**
- `migrate(engine) -> list[str]` returns the statements applied (idempotent: `PRAGMA table_info`, then `ALTER TABLE … ADD COLUMN` only when missing).
- `HttpChecker(params: dict, secret: str | None, client_pool: HttpClientPool, cert_reader: CertReader | None)`; `check(host, timeout_ms) -> CheckResult` with `value = {status_code, elapsed_ms, cert_expires, cert_days, final_url}`; reasons per spec §3.3. `HttpClientPool.get(verify_tls: bool, follow_redirects: bool) -> httpx2.AsyncClient`; `aclose()` on shutdown.
- `parse_expect_status("200,204,301-302") -> list[tuple[int, int]]`; `json_lookup(obj, "data.items.0.status")`; `json_compare(actual, op, value) -> bool`.

- [ ] **Step 1: Failing tests:** migration on a DB created with the old schema adds both columns and keeps rows; second run applies nothing. HttpChecker with `httpx2.MockTransport`: 200 ok with elapsed; 503 → `status 503`; `"200,204,301-302"` parsing; keyword contains/absent; JSON ops incl. `exists` and nested path; slow → `ok=True, slow=True`; redirect followed / not followed; body > 1 MB truncated, keyword after 1 MB not found; bearer/basic/header auth sets the right header; timeout → `timeout`; connect error → `refused`. State: slow other check → DEGRADED; slow web liveness → DEGRADED.
- [ ] **Step 2:** Implement. **Step 3:** full backend suite. **Step 4: Commit** — `"feat: HTTP checker, slow results and schema migration"`.

### Task 9: Certificates, API and secrets

**Files:**
- Create: `backend/app/monitoring/certs.py`, tests `tests/monitoring/test_certs.py`, `tests/api/test_http_api.py`
- Modify: `app/domain/detectors.py` (certificate detector), `app/schemas.py` (`DeviceKind` + `"web"`, `Liveness` + `"http"`, `url`, `CheckKind` + `"http"`, `HttpParams` model, write-only `secret`, `CheckOut.has_secret`), `app/infra/repositories.py` (encrypt/decrypt `secret_enc`; `to_config` passes secrets to the factory, never to DTOs), `app/services/devices.py` (validation: `web` requires `url` and `liveness=http`; derive `host` from `url`; web defaults 30 s / 10 000 ms)

**Interfaces:**
- `CertReader(ttl_s=3600)`: `async expiry(host: str, port: int, timeout_ms: int) -> datetime | None` (unverified TLS context, DER → `cryptography.x509.load_der_x509_certificate(...).not_valid_after_utc`; cached per host:port).
- Detector: per HTTP check, `cert_days ≤ cert_warn_days` crossing → WARNING `"{name} cert for {host} expires in {n} days"`; `< 0` → CRITICAL `"... expired"`; back above → INFO `"... renewed ({n} days)"`.

- [ ] **Step 1: Failing tests:** CertReader against a local TLS server with a self-signed cert valid 10 days (generated with `cryptography` in the test) → ~10 days; cache hit within TTL. Detector: crossing fires once, renewal fires info, no repeat. API: create `web` device with only `url` → host derived, defaults 30/10000, liveness http; `web` without url → 422; HTTP check with `secret` → `has_secret: true`; `test_http_secret_never_returned` (list, get, checks, 422, `/test`).
- [ ] **Step 2:** Implement. **Step 3:** full suite. **Step 4: Commit** — `"feat: certificate expiry, web devices and HTTP check API"`.

### Task 10: HTTP screens

**Files:**
- Create: `web/src/components/HttpTab.tsx`, `web/src/components/HttpChips.tsx`, `web/src/features/http.ts` (+ test), component test `HttpTab.test.tsx`
- Modify: `DeviceForm.tsx` (kind "Website / API" swaps Host for URL and hides liveness choice; HTTP tab), `DeviceRow.tsx`/`DeviceCard.tsx` (HttpChips next to PortChips), `DeviceDetail.tsx` (certificate expiry line), `features/deviceView.ts` (search matches URLs and HTTP check URLs), `KindIcon.tsx` (globe), regenerate `src/api/schema.d.ts`

**Interfaces:** `features/http.ts`: `httpChipText(check, result) -> {text, tone: "ok"|"warn"|"bad"|"pending", title}`; `buildHttpParams(form) -> HttpParams` (omits blank secret, keeps "unchanged" placeholder semantics like SNMP); `certTone(days, warnDays)`.

- [ ] **Step 1: Failing tests:** `httpChipText` for ok/slow/failed/no result; `certTone` thresholds; `buildHttpParams` omits blank secret and empty headers; HttpTab adds a check, edits headers rows, Test button shows the mocked result.
- [ ] **Step 2:** Implement. **Step 3:** typecheck, lint, test, build. **Step 4: Commit** — `"feat: HTTP tab and chips for website and API checks"`.

### Task 11: Docs and verification

- [ ] README: Website / API monitoring, certificate warnings, proxy variables, internal CA trust, migration note. Spec status.
- [ ] Full suites (backend, frontend typecheck/lint/test/build, sizes).
- [ ] Controller browser check: public HTTPS site, an internal HTTPS site (on the Windows PC), an API with a token, both themes, phone width.
- [ ] Commit — `"docs: website and API monitoring"`.
