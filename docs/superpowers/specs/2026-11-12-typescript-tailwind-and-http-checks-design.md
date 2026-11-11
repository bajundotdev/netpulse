# NetPulse — TypeScript + Tailwind frontend, and website / API monitoring (design addendum)

Date: 2026-11-12 · Status: approved 2026-11-12 · brick A implemented · Owner: Bajun
Extends `2026-11-10-netpulse-design.md` and `2026-11-11-status-panel-and-views-design.md`.
Mirrored in the vault as `01-Projects/NetPulse/02-design addendum - TypeScript, Tailwind and HTTP checks.md`.

Two bricks, in this order: **A. frontend migration** (same features, new stack), then
**B. website / API monitoring** (built directly in the new stack). The first item of the
feature backlog ("Future features - Web, API, third-party, incidents and dependencies").

## 1. Decisions and current versions (checked 2026-11-12 with context7, deepwiki, npm)

| Area | Choice | Version |
|---|---|---|
| Language | TypeScript, `strict: true` | 7.0.x (native compiler; the default in Vite's `react-ts` starter) |
| UI library | React | 19.3.x (unchanged) |
| Styling | Tailwind CSS via `@tailwindcss/vite`, CSS-first config (`@import "tailwindcss"`, `@theme`) | 4.3.x |
| Components | shadcn/ui (copied into `src/components/ui`, owned by the project), `lucide-react` icons, `class-variance-authority`, `cn` (class-name helper, replaces `clsx` + `tailwind-merge`; shadcn CLI v4 default), `tw-animate-css` | shadcn CLI 4.23, preset `radix-nova`, neutral base colour (density only; no palette or font change) |
| Lint | Oxlint (Vite starter default; works with TypeScript 7 — `typescript-eslint` supports TS < 6.1 only) | 1.93.x |
| Build | `tsc -b && vite build` | Vite 8.3.x |
| Tests | Vitest + jsdom + Testing Library for components; existing pure-helper tests kept | Vitest 5.1.x |
| API types | Generated from FastAPI's OpenAPI schema with `openapi-typescript`, committed | latest |
| Backend HTTP client | `httpx2` (OS trust store via `truststore`; honours `HTTP(S)_PROXY`) | 2.16.x |

**Replaced:** Bootstrap 5 and React-Bootstrap are removed. The earlier rule "Bootstrap
default font and colours only" becomes: **Tailwind's default font stack and colour palette
plus shadcn/ui's default (neutral) theme variables only — no custom hex/oklch values.**
ADR-006 records this; ADR-007 records the HTTP checker choice.

## 2. Brick A — frontend migration (feature parity)

### 2.1 Scope
Every current screen and behaviour keeps working: top bar (Live badge, theme, sound,
notifications, Add device), status panel (headline, problems in the last hour, chart,
strip, 1h/24h/7d, gradient), summary counts, toolbar (search, sort, list/card), list rows
(expand, history bar, uptime, chips, Details), cards, detail modal (Test now, Pause, Edit,
Delete), device form (General / Ports with DC preset / SNMP), event log (filters, Ack,
Clear), alerts (notification, beep, tab title), stale/connection banners, phone layout,
keyboard focus. No new features in brick A.

### 2.2 Structure
```
web/
  tsconfig.json, tsconfig.app.json, tsconfig.node.json   (Vite react-ts layout, strict)
  vite.config.ts        react(), tailwindcss(), alias "@" → src, /api proxy, vitest config
  components.json       shadcn config (tsx, css: src/index.css, aliases @/components, @/lib)
  .oxlintrc.json
  src/
    index.css           @import "tailwindcss"; tw-animate-css; shadcn theme vars; @custom-variant dark
    main.tsx, App.tsx
    api/schema.d.ts     generated (npm run gen:api); api/client.ts typed wrapper
    lib/utils.ts        cn()
    components/ui/*     shadcn: button, badge, card, dialog, tabs, input, label, select,
                        switch, textarea, alert, toggle-group, tooltip, separator
    components/*.tsx    app components (same names as today)
    features/*.ts       pure helpers (deviceView, history, ports, snmp, format, alerts) + tests
    state/*.ts(x)       reducer, context, hooks, prefs, theme + tests
```
- Every `.js/.jsx` file becomes `.ts/.tsx`; pure helpers keep their unit tests (converted).
- `npm run gen:api` exports the OpenAPI schema from the backend without a running server
  (`backend/.venv` python: `create_app().openapi()`), then runs `openapi-typescript` →
  `src/api/schema.d.ts`. A test fails if the committed file is out of date (CI-less guard).

### 2.3 Theme and colours
- Dark mode = `.dark` class on `<html>` (shadcn convention, `@custom-variant dark (&:is(.dark *))`).
  `theme.ts` keeps localStorage key `netpulse.theme` and the system-preference fallback.
- Status colours from Tailwind's default palette: UP `emerald-500`, DEGRADED `amber-500`,
  DOWN `red-500`, PAUSED / no data `zinc-300` (light) / `zinc-700` (dark).
- Status panel gradient: `bg-linear-to-br from-sky-50 to-emerald-50` (light),
  `dark:from-sky-950 dark:to-emerald-950` (dark); chart stroke/fill `emerald-500`.
- Surfaces, text, borders, focus rings: shadcn theme variables (`bg-card`, `text-muted-foreground`,
  `border`, `ring`).
- Font: Tailwind's default sans stack; `font-mono` for hosts/IPs/URLs.

### 2.4 Component mapping
| Today (React-Bootstrap) | Tomorrow |
|---|---|
| Navbar | `header` + Tailwind flex |
| Modal | shadcn `Dialog` |
| Tabs | shadcn `Tabs` |
| Form.Control / Select / Check | shadcn `Input`, `Select` (or native `select` styled), `Switch`, `Label` |
| Badge | shadcn `Badge` + status variants (cva) |
| Alert | shadcn `Alert` |
| ButtonGroup (view, range) | shadcn `ToggleGroup` (single; Radix exposes `role="radio"` + `aria-checked`, not `aria-pressed`) |
| ListGroup rows | `ul` + bordered rows; header button with `focus-visible:ring-inset` |
| Card | shadcn `Card` |
| Table (event log, detail) | Tailwind `table` |

### 2.5 Success criteria (brick A)
1. Bootstrap and React-Bootstrap absent from `package.json` and the bundle.
2. `tsc -b` passes with `strict`; Oxlint clean; all helper tests plus new component tests pass.
3. Every item in §2.1 works in both themes and at phone width (browser check list).
4. Production bundle not more than 25 % larger than today's gzip baseline (measured 2026-11-12:
   JS 101.65 kB, CSS 30.88 kB) — i.e. JS ≤ 127 kB and CSS ≤ 39 kB gzip.

## 3. Brick B — website and API monitoring

### 3.1 Model
- New device kind **`web`** ("Website / API"): has `url` (http/https) instead of an IP;
  `host` is derived from the URL's hostname (display, search, DNS); liveness **`http`**;
  default `interval_s` 30, default `timeout_ms` 10000 for this kind.
- New check type **`http`**, addable to any device (failing → DEGRADED).
- Liveness `http` = request to the device `url`: no answer, timeout, TLS failure or a status
  outside the expected range → liveness failure (DOWN after the threshold). The device's
  HTTP checks carry the stricter assertions.

### 3.2 HTTP check parameters (`params`)
| Key | Default | Meaning |
|---|---|---|
| `url` | required | http/https only |
| `method` | `GET` | GET, HEAD, POST, PUT, PATCH, DELETE |
| `headers` | `{}` | plain-text headers (the form warns they are stored unencrypted) |
| `body` | none | text/JSON body for POST/PUT/PATCH |
| `expect_status` | `"200-399"` | ranges and lists, e.g. `"200,204,301-302"` |
| `keyword` | none | `{text, mode: "contains" \| "absent"}`, case-sensitive |
| `json` | none | `{path: "data.status", op: "==", value: "ok"}`; ops `== != > >= < <= exists` |
| `slow_ms` | 2000 | slower → result ok but **slow** → device DEGRADED |
| `cert_warn_days` | 14 | certificate warning threshold (https only) |
| `verify_tls` | true | false skips verification (still reads expiry) |
| `follow_redirects` | true | |
| `auth` | none | `{type: "bearer" \| "basic" \| "header", username?, header_name?}`; the secret (token/password/header value) is stored encrypted in `checks.secret_enc`, write-only (`has_secret` flag) |
| `name` | derived | label shown on chips, default `"{method} {path}"` |

### 3.3 Behaviour
- `HttpChecker` (strategy) uses one shared `httpx2.AsyncClient` per (verify_tls, follow_redirects)
  pair, honouring `HTTP(S)_PROXY`; reads at most 1 MB of the body for keyword/JSON.
- Result `value`: `{status_code, elapsed_ms, cert_expires (ISO) | null, cert_days | null, final_url}`.
- Failure reasons: `timeout`, `dns`, `refused`, `tls: <message>`, `status 503`,
  `keyword missing` / `keyword present`, `json: <path> is <actual>`, `slow 2350 ms`.
- Certificate reader: separate TLS handshake (unverified context, read-only) → peer cert DER →
  `cryptography.x509` → `not_valid_after_utc`; cached per host:port for 1 h.
- Certificate events through the `ChangeTracker`: crossing into `≤ cert_warn_days` →
  **warning** "DC01 cert for sts.dostcaraga.ph expires in 12 days"; expired → **critical**;
  renewed (days back above threshold) → info.
- Slow: the state machine treats an ok-but-slow other check as failing for DEGRADED
  (message "slow 2350 ms"); for `web` devices a slow liveness also yields DEGRADED, not DOWN.

### 3.4 Data migration
SQLite `create_all` does not add columns to existing tables, so startup runs a small,
idempotent migration: `ALTER TABLE devices ADD COLUMN url VARCHAR` and
`ALTER TABLE checks ADD COLUMN secret_enc VARCHAR` when missing. Tested against a database
created by the previous version.

### 3.5 API
- `DeviceIn/Update`: `kind` gains `"web"`, new `url`; `liveness` gains `"http"` (required for
  `web`, only allowed when `url` is set). `host` optional for `web` (derived).
- `CheckIn` type `"http"` with the params above; `secret` write-only field; `CheckOut.has_secret`.
- 422 errors keep stripping `input`/`ctx` (no secret echo).
- `POST /api/devices/{id}/test` already returns all results (HTTP included).

### 3.6 Screens (in the new stack)
- Device form: kind "Website / API" swaps Host for **URL**; new **HTTP** tab listing checks;
  per-check editor (method, URL, headers rows, body, expected status, keyword, JSON check,
  slow ms, certificate days, verify TLS, follow redirects, auth type + secret, name) with a
  **Test** button showing status, time, certificate days and reason.
- Chips on cards and rows: `GET /adfs ✓ 143 ms`, `api/health ✗ status 503`, `cert 112 d`
  (amber ≤ `cert_warn_days`, red expired). Detail modal shows certificate expiry date.
- Search also matches URLs; kind icon "globe".

### 3.7 Success criteria (brick B)
1. A public HTTPS site shows UP with response time and certificate days.
2. An internal HTTPS site signed by the domain CA verifies on a domain-joined Windows PC
   without "skip verification".
3. An API check with a bearer token passes; the token never appears in any API response,
   log line or 422 error.
4. Wrong keyword / JSON value / status → DEGRADED (HTTP check) or DOWN (web liveness) with
   the right reason; slow → DEGRADED.
5. Certificate within 14 days → one warning event; the event fires again only after renewal
   and a new crossing.
6. Upgrading an existing `data/netpulse.db` keeps all devices, checks, events and history.

## 4. Testing
- Frontend: all converted helper tests; component tests (jsdom) for App shell, view toggle,
  search, row expand, device form tabs, event log Ack; `tsc -b`; Oxlint; build-size check.
- Backend: `HttpChecker` with `httpx2.MockTransport` (status ranges, keyword, JSON ops,
  slow, redirects, 1 MB cap, auth header building, timeouts); certificate reader against a
  local TLS server with a self-signed short-lived certificate; migration test on an old-schema
  DB; schema validation; secret write-only; API tests.
- Browser check after each brick (both themes, phone width, keyboard).

## 5. Risks
| # | Risk | Mitigation |
|---|---|---|
| R11 | Migration regresses a feature | Parity list §2.1 as the browser-check list; component tests |
| R12 | TypeScript 7 native binary on the Windows server build | `npm ci` installs the platform package; fallback documented: pin `typescript@~6.0` |
| R13 | shadcn CLI needs internet at dev time | Components are committed; the server build needs only `npm ci` |
| R14 | Internal certificates not trusted | OS trust store via `truststore`; per-check skip switch |
| R15 | Existing database lacks new columns | Idempotent startup migration with a test |
| R16 | Scope creep (status-page product) | Backlog note keeps the remaining items separate |
