import type {
  CheckIn,
  CheckOut,
  HttpAuthType,
  HttpCheckOut,
  HttpMethod,
  HttpParams,
  HttpResultValue,
  JsonOp,
  KeywordMode,
  ResultOut,
} from "@/types";
import { attachBaseline, type CheckApi } from "./ports";

export const HTTP_METHODS: readonly HttpMethod[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
export const KEYWORD_MODES: readonly KeywordMode[] = ["contains", "absent"];
export const JSON_OPS: readonly JsonOp[] = ["==", "!=", ">", ">=", "<", "<=", "exists"];
export const AUTH_TYPES: readonly ("none" | HttpAuthType)[] = ["none", "bearer", "basic", "header"];
const BODY_METHODS: readonly HttpMethod[] = ["POST", "PUT", "PATCH"];

export const hasBody = (method: HttpMethod): boolean => BODY_METHODS.includes(method);

export interface HeaderRow {
  name: string;
  value: string;
}

// One HTTP check as the editor holds it. `id` is the saved check's id (null while unsaved);
// `secret` is write-only: blank means "keep what is stored".
export interface HttpForm {
  key: string;
  id: number | null;
  hasSecret: boolean;
  name: string;
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  body: string;
  expectStatus: string;
  keywordText: string;
  keywordMode: KeywordMode;
  jsonPath: string;
  jsonOp: JsonOp;
  jsonValue: string;
  slowMs: string;
  certWarnDays: string;
  verifyTls: boolean;
  followRedirects: boolean;
  authType: "none" | HttpAuthType;
  authUsername: string;
  authHeaderName: string;
  secret: string;
}

let counter = 0;
const nextKey = () => `http-${(counter += 1)}`;

export function newHttpForm(): HttpForm {
  return {
    key: nextKey(),
    id: null,
    hasSecret: false,
    name: "",
    method: "GET",
    url: "",
    headers: [],
    body: "",
    expectStatus: "200-399",
    keywordText: "",
    keywordMode: "contains",
    jsonPath: "",
    jsonOp: "==",
    jsonValue: "",
    slowMs: "2000",
    certWarnDays: "14",
    verifyTls: true,
    followRedirects: true,
    authType: "none",
    authUsername: "",
    authHeaderName: "",
    secret: "",
  };
}

// Shows a JSON value as the user would type it: strings plain, unless plain text would be read
// back as a number / boolean / null, in which case the quotes stay.
export function formatJsonValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    try {
      return typeof JSON.parse(value) === "string" ? value : JSON.stringify(value);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

// Reads typed text as JSON (42, true, null, "x") and falls back to a plain string.
export function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function httpFormOf(check: HttpCheckOut): HttpForm {
  const p = check.params;
  return {
    ...newHttpForm(),
    id: check.id,
    hasSecret: !!check.has_secret,
    name: p.name ?? "",
    method: p.method ?? "GET",
    url: p.url,
    headers: Object.entries(p.headers ?? {}).map(([name, value]) => ({ name, value })),
    body: p.body ?? "",
    expectStatus: p.expect_status ?? "200-399",
    keywordText: p.keyword?.text ?? "",
    keywordMode: p.keyword?.mode ?? "contains",
    jsonPath: p.json?.path ?? "",
    jsonOp: p.json?.op ?? "==",
    jsonValue: formatJsonValue(p.json?.value),
    slowMs: p.slow_ms == null ? "2000" : String(p.slow_ms),
    certWarnDays: p.cert_warn_days == null ? "14" : String(p.cert_warn_days),
    verifyTls: p.verify_tls ?? true,
    followRedirects: p.follow_redirects ?? true,
    authType: p.auth?.type ?? "none",
    authUsername: p.auth?.username ?? "",
    authHeaderName: p.auth?.header_name ?? "",
  };
}

export const httpFormsOf = (checks: CheckOut[] | null | undefined): HttpForm[] =>
  (checks ?? []).flatMap((c) => (c.type === "http" ? [httpFormOf(c)] : []));

export const isHttpUrl = (text: string): boolean => {
  try {
    const u = new URL(text.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "";
  } catch {
    return false;
  }
};

// Which editor field a validation problem belongs to; the values are the field id suffixes in HttpTab.
export type HttpField = "url" | "jsonPath" | "slowMs" | "certDays" | "authUser" | "authHeader" | "secret";

// A validation problem in one HTTP check's editor: `message` is for the field, `summary` names the
// check as well, for the dialog's general alert.
export class HttpFormError extends Error {
  formKey: string;
  field: HttpField;
  summary: string;
  constructor(form: HttpForm, field: HttpField, message: string) {
    super(message);
    this.name = "HttpFormError";
    this.formKey = form.key;
    this.field = field;
    this.summary = `${label(form)}: ${message}`;
  }
}

const label = (form: HttpForm): string => form.name.trim() || form.url.trim() || "(no URL)";

function wholeNumber(text: string, what: string, form: HttpForm, field: HttpField, min: number): number | undefined {
  const s = text.trim();
  if (s === "") return undefined;
  if (!/^\d+$/.test(s) || Number(s) < min) {
    throw new HttpFormError(form, field, `${what} must be a whole number${min > 0 ? ` of ${min} or more` : ""}`);
  }
  return Number(s);
}

// Check params from the editor; blank optional parts are left out (the backend applies its
// defaults). Throws Error with a message on input that cannot be sent.
export function buildHttpParams(form: HttpForm): HttpParams {
  const url = form.url.trim();
  if (!isHttpUrl(url)) throw new HttpFormError(form, "url", "Enter an http:// or https:// URL");
  const params: HttpParams = { url, method: form.method };
  const name = form.name.trim();
  if (name) params.name = name;

  const headers: Record<string, string> = {};
  for (const row of form.headers) {
    const hn = row.name.trim();
    if (hn === "") continue;
    headers[hn] = row.value;
  }
  if (Object.keys(headers).length > 0) params.headers = headers;
  if (hasBody(form.method) && form.body.trim() !== "") params.body = form.body;

  const expect = form.expectStatus.trim();
  if (expect) params.expect_status = expect;

  if (form.keywordText !== "") params.keyword = { text: form.keywordText, mode: form.keywordMode };

  const path = form.jsonPath.trim();
  if (path) {
    params.json = { path, op: form.jsonOp };
    if (form.jsonOp !== "exists") params.json.value = parseJsonValue(form.jsonValue);
  }

  const slow = wholeNumber(form.slowMs, "Slow limit", form, "slowMs", 1);
  if (slow !== undefined) params.slow_ms = slow;
  const warn = wholeNumber(form.certWarnDays, "Certificate warning days", form, "certDays", 0);
  if (warn !== undefined) params.cert_warn_days = warn;
  params.verify_tls = form.verifyTls;
  params.follow_redirects = form.followRedirects;

  if (form.authType !== "none") {
    const auth: NonNullable<HttpParams["auth"]> = { type: form.authType };
    if (form.authType === "basic") auth.username = form.authUsername.trim();
    if (form.authType === "header") {
      const hn = form.authHeaderName.trim();
      if (hn === "") throw new HttpFormError(form, "authHeader", "Authentication needs a header name");
      auth.header_name = hn;
    }
    params.auth = auth;
  }
  return params;
}

// The secret to send, trimmed (pasted tokens often end in a space or newline): never a blank one
// (omitted keeps the stored secret), and "" clears it when auth was switched off.
function secretOf(form: HttpForm): string | undefined {
  if (form.authType === "none") return form.hasSecret ? "" : undefined;
  const secret = form.secret.trim();
  return secret === "" ? undefined : secret;
}

export function buildHttpCheck(form: HttpForm): CheckIn {
  const params = buildHttpParams(form);
  if (form.authType !== "none" && form.secret.trim() === "" && !form.hasSecret) {
    throw new HttpFormError(form, "secret", "Authentication needs a token, password or header value");
  }
  const secret = secretOf(form);
  return { type: "http", params, enabled: true, ...(secret === undefined ? {} : { secret }) };
}

export interface DesiredHttp {
  form: HttpForm;
  check: CheckIn;
}

// Validates every form and returns the checks to save; throws Error with a message on bad input.
export const desiredHttpChecks = (forms: HttpForm[]): DesiredHttp[] =>
  forms.map((form) => ({ form, check: buildHttpCheck(form) }));

// Key-sorted JSON, so two params objects compare equal whatever their key order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface HttpDiff {
  add: DesiredHttp[];
  update: (DesiredHttp & { id: number })[];
  remove: HttpCheckOut[];
}

export function diffHttpChecks(baseline: CheckOut[], desired: DesiredHttp[]): HttpDiff {
  const have = new Map(
    baseline.flatMap((c) => (c.type === "http" ? [[c.id, c] as const] : [])),
  );
  const add: DesiredHttp[] = [];
  const update: HttpDiff["update"] = [];
  const kept = new Set<number>();
  for (const d of desired) {
    const cur = d.form.id == null ? undefined : have.get(d.form.id);
    if (!cur) {
      add.push(d);
      continue;
    }
    kept.add(cur.id);
    // Compare through the editor's own normalisation, so server-side defaults do not look like edits.
    const same = canonical(buildHttpParams(httpFormOf(cur))) === canonical(d.check.params);
    if (!same || d.check.secret !== undefined) update.push({ ...d, id: cur.id });
  }
  const remove = [...have.values()].filter((c) => !kept.has(c.id));
  return { add, update, remove };
}

// An error from applyHttpChanges also carries the editor forms as they now stand (created checks
// have their ids), so a retry does not add them twice.
export type HttpSaveError = Error & { baseline?: CheckOut[]; httpForms?: HttpForm[] };

// Applies the HTTP check diff one call at a time. Returns the checks as they now stand; on failure
// the thrown error carries `baseline` and `httpForms`.
export async function applyHttpChanges(
  deviceId: number,
  baseline: CheckOut[],
  forms: HttpForm[],
  api: CheckApi,
): Promise<CheckOut[]> {
  const desired = desiredHttpChecks(forms);
  let working = [...baseline];
  let workingForms = [...forms];
  const { add, update, remove } = diffHttpChecks(working, desired);
  try {
    for (const c of remove) {
      await api.deleteCheck(c.id);
      working = working.filter((w) => w.id !== c.id);
    }
    for (const u of update) {
      const saved = await api.updateCheck(u.id, u.check);
      working = working.map((w) => (w.id === u.id ? saved : w));
    }
    for (const a of add) {
      const created = await api.addCheck(deviceId, a.check);
      working = [...working, created];
      workingForms = workingForms.map((f) =>
        f.key === a.form.key ? { ...f, id: created.id, hasSecret: !!created.has_secret, secret: "" } : f,
      );
    }
  } catch (err) {
    const tagged = attachBaseline(err, working);
    if (tagged instanceof Error) (tagged as HttpSaveError).httpForms = workingForms;
    throw tagged;
  }
  return working;
}

// ---- chips and results ----------------------------------------------------------------------

export type ChipTone = "ok" | "warn" | "bad" | "pending" | "neutral";

export interface ChipText {
  text: string;
  tone: ChipTone;
  title: string;
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

export const httpCheckName = (params: HttpParams): string =>
  params.name?.trim() || `${params.method ?? "GET"} ${pathOf(params.url)}`;

const isHttpValue = (value: unknown): value is Partial<HttpResultValue> =>
  !!value && typeof value === "object";

// The backend flags slow results. Payloads from before the flag existed lack it, so the reason
// text ("slow 2350 ms") still counts there.
export const isSlow = (r: ResultOut | null | undefined): boolean =>
  !!r && r.ok && (r.slow === true || (r.slow === undefined && /^slow \d+ ms/.test(r.reason ?? "")));

function elapsedOf(r: ResultOut): number | null {
  if (typeof r.latency_ms === "number") return r.latency_ms;
  const v = r.value;
  return isHttpValue(v) && typeof v.elapsed_ms === "number" ? v.elapsed_ms : null;
}

export function certDaysOf(r: ResultOut | null | undefined): number | null {
  const v = r?.value;
  return isHttpValue(v) && typeof v.cert_days === "number" ? v.cert_days : null;
}

export function certExpiresOf(r: ResultOut | null | undefined): string | null {
  const v = r?.value;
  return isHttpValue(v) && typeof v.cert_expires === "string" ? v.cert_expires : null;
}

export function httpChipText(check: Pick<HttpCheckOut, "params">, result: ResultOut | null | undefined): ChipText {
  const name = httpCheckName(check.params);
  if (!result) return { text: `${name} …`, tone: "pending", title: "No result yet" };
  if (!result.ok) {
    const reason = result.reason ?? "failed";
    return { text: `${name} ✗ ${reason}`, tone: "bad", title: reason };
  }
  if (isSlow(result)) {
    const reason = result.reason ?? "slow";
    return { text: `${name} ${reason}`, tone: "warn", title: reason };
  }
  const ms = elapsedOf(result);
  return { text: ms == null ? `${name} ✓` : `${name} ✓ ${Math.round(ms)} ms`, tone: "ok", title: "" };
}

export const DEFAULT_CERT_WARN_DAYS = 14;

function endpointOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? `${u.hostname}:${u.port || "443"}` : null;
  } catch {
    return null;
  }
}

// The certificate warning threshold for a URL, as the server applies it to events: the smallest
// cert_warn_days among the enabled HTTP checks on the same host:port, else 14.
export function certWarnDaysFor(checks: CheckOut[] | null | undefined, url: string | null | undefined): number {
  const endpoint = endpointOf(url);
  let warn: number | null = null;
  for (const c of checks ?? []) {
    if (c.type !== "http" || !c.enabled || endpoint == null || endpointOf(c.params.url) !== endpoint) continue;
    const days = c.params.cert_warn_days ?? DEFAULT_CERT_WARN_DAYS;
    warn = warn == null ? days : Math.min(warn, days);
  }
  return warn ?? DEFAULT_CERT_WARN_DAYS;
}

// Red when expired, amber at or under the warning threshold, neutral otherwise.
export function certTone(days: number | null | undefined, warnDays: number): ChipTone {
  if (days == null) return "neutral";
  if (days < 0) return "bad";
  return days <= warnDays ? "warn" : "neutral";
}

export function certChipText(days: number | null | undefined, warnDays: number): ChipText | null {
  if (days == null) return null;
  const tone = certTone(days, warnDays);
  return days < 0
    ? { text: `cert expired ${-days} d ago`, tone, title: "Certificate has expired" }
    : { text: `cert ${days} d`, tone, title: "Days until the certificate expires" };
}

// "expires 2027-03-01 (112 days)" for a result that carries a certificate, else null.
export function certExpiryLine(r: ResultOut | null | undefined): string | null {
  const iso = certExpiresOf(r);
  if (!iso) return null;
  const days = certDaysOf(r);
  const date = iso.slice(0, 10);
  if (days == null) return `expires ${date}`;
  return days < 0 ? `expired ${date}` : `expires ${date} (${days} ${days === 1 ? "day" : "days"})`;
}

// One line for the Test button: status, time, certificate and reason.
export function httpTestSummary(r: ResultOut): string {
  const v = isHttpValue(r.value) ? r.value : {};
  const ms = elapsedOf(r);
  const parts = [r.ok ? "OK" : "Failed"];
  if (typeof v.status_code === "number") parts.push(`HTTP ${v.status_code}`);
  if (ms != null) parts.push(`${Math.round(ms)} ms`);
  if (typeof v.cert_days === "number") parts.push(`cert ${v.cert_days} d`);
  if (r.reason) parts.push(r.reason);
  return parts.join(" · ");
}

export const resultForHttp = (
  check: Pick<HttpCheckOut, "id">,
  results: ResultOut[] | null | undefined,
): ResultOut | null => (results ?? []).find((r) => r.check_id === check.id) ?? null;
