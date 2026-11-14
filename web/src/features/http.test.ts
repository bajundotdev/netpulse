import { describe, expect, it, vi } from "vitest";
import type { CheckIn, CheckOut, HttpCheckOut, ResultOut } from "@/types";
import {
  applyHttpChanges,
  buildHttpCheck,
  buildHttpParams,
  certExpiryLine,
  certTone,
  certWarnDaysFor,
  diffHttpChecks,
  desiredHttpChecks,
  formatJsonValue,
  httpChipText,
  httpFormOf,
  httpTestSummary,
  newHttpForm,
  type HttpForm,
} from "./http";
import { HttpFormError, isSlow, type HttpSaveError } from "./http";

const form = (over: Partial<HttpForm> = {}): HttpForm => ({ ...newHttpForm(), url: "https://sts.example.org/adfs", ...over });
const httpCheck = (id: number, params: HttpCheckOut["params"], has_secret = false): HttpCheckOut => ({
  id,
  device_id: 1,
  created_at: "",
  enabled: true,
  has_secret,
  type: "http",
  params,
});
const result = (over: Partial<ResultOut> = {}): ResultOut => ({
  type: "http",
  label: "GET /adfs",
  ok: true,
  check_id: 5,
  latency_ms: 143.4,
  value: { status_code: 200, elapsed_ms: 143.4, cert_expires: "2027-03-01T00:00:00Z", cert_days: 112, final_url: null },
  ...over,
});

describe("httpChipText", () => {
  const check = httpCheck(5, { url: "https://sts.example.org/adfs" });
  it("shows an ok result with name and time", () => {
    expect(httpChipText(check, result())).toEqual({ text: "GET /adfs ✓ 143 ms", tone: "ok", title: "" });
  });
  it("uses the check's own name when it has one", () => {
    const named = httpCheck(5, { url: "https://x.org/api/health", name: "api/health" });
    expect(httpChipText(named, result({ ok: false, reason: "status 503", latency_ms: null }))).toEqual({
      text: "api/health ✗ status 503",
      tone: "bad",
      title: "status 503",
    });
  });
  it("shows slow as a warning", () => {
    const slow = result({ reason: "slow 2350 ms", latency_ms: 2350 });
    expect(httpChipText(check, slow)).toEqual({ text: "GET /adfs slow 2350 ms", tone: "warn", title: "slow 2350 ms" });
  });
  it("is pending without a result", () => {
    expect(httpChipText(check, null)).toMatchObject({ text: "GET /adfs …", tone: "pending" });
    expect(httpChipText(check, undefined).tone).toBe("pending");
  });
  it("derives the name from method and path", () => {
    const post = httpCheck(6, { url: "https://x.org/", method: "POST" });
    expect(httpChipText(post, null).text).toBe("POST / …");
  });
});

describe("isSlow", () => {
  it("uses the slow flag, and the reason text only when the flag is absent", () => {
    expect(isSlow(result({ slow: true, reason: "slow 2350 ms" }))).toBe(true);
    expect(isSlow(result({ slow: false, reason: "slow 2350 ms" }))).toBe(false);
    expect(isSlow(result({ reason: "slow 2350 ms" }))).toBe(true);
    expect(isSlow(result({ slow: true, ok: false }))).toBe(false);
  });
});

describe("HttpFormError", () => {
  it("names the check and the field", () => {
    const f = form({ url: "ftp://x" });
    const err = (() => {
      try {
        buildHttpParams(f);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(HttpFormError);
    expect(err).toMatchObject({ formKey: f.key, field: "url" });
  });
});

describe("certTone", () => {
  it("is red when expired, amber at or under the warning days, neutral otherwise", () => {
    expect(certTone(-1, 14)).toBe("bad");
    expect(certTone(0, 14)).toBe("warn");
    expect(certTone(14, 14)).toBe("warn");
    expect(certTone(15, 14)).toBe("neutral");
    expect(certTone(null, 14)).toBe("neutral");
  });
});

describe("buildHttpParams", () => {
  it("omits blank optional parts and empty headers", () => {
    const p = buildHttpParams(form({ expectStatus: "", slowMs: "", certWarnDays: "" }));
    expect(p).toEqual({ url: "https://sts.example.org/adfs", method: "GET", verify_tls: true, follow_redirects: true });
    expect("headers" in p).toBe(false);
    expect("keyword" in p).toBe(false);
    expect("json" in p).toBe(false);
    expect("auth" in p).toBe(false);
  });
  it("keeps filled parts, skipping header rows without a name", () => {
    const p = buildHttpParams(
      form({
        headers: [
          { name: "X-Env", value: "prod" },
          { name: " ", value: "ignored" },
        ],
        keywordText: "Sign in",
        keywordMode: "absent",
        jsonPath: "data.status",
        jsonValue: "ok",
        slowMs: "500",
        verifyTls: false,
      }),
    );
    expect(p.headers).toEqual({ "X-Env": "prod" });
    expect(p.keyword).toEqual({ text: "Sign in", mode: "absent" });
    expect(p.json).toEqual({ path: "data.status", op: "==", value: "ok" });
    expect(p.slow_ms).toBe(500);
    expect(p.verify_tls).toBe(false);
  });
  it("sends a body only for POST, PUT and PATCH, and no value for exists", () => {
    expect(buildHttpParams(form({ body: "{}" })).body).toBeUndefined();
    expect(buildHttpParams(form({ method: "POST", body: "{}" })).body).toBe("{}");
    const p = buildHttpParams(form({ jsonPath: "ok", jsonOp: "exists", jsonValue: "x" }));
    expect(p.json).toEqual({ path: "ok", op: "exists" });
  });
  it("reads JSON values as numbers and booleans, else text", () => {
    expect(buildHttpParams(form({ jsonPath: "n", jsonValue: "3" })).json?.value).toBe(3);
    expect(buildHttpParams(form({ jsonPath: "n", jsonValue: "true" })).json?.value).toBe(true);
    expect(buildHttpParams(form({ jsonPath: "n", jsonValue: '"3"' })).json?.value).toBe("3");
  });
  it("rejects a non-http URL and bad numbers", () => {
    expect(() => buildHttpParams(form({ url: "ftp://x" }))).toThrow(/http/);
    expect(() => buildHttpParams(form({ url: "" }))).toThrow(/http/);
    expect(() => buildHttpParams(form({ slowMs: "fast" }))).toThrow(/slow/i);
  });
  it("adds auth details by type", () => {
    expect(buildHttpParams(form({ authType: "basic", authUsername: "svc" })).auth).toEqual({ type: "basic", username: "svc" });
    expect(buildHttpParams(form({ authType: "header", authHeaderName: "X-Key" })).auth).toEqual({
      type: "header",
      header_name: "X-Key",
    });
    expect(buildHttpParams(form({ authType: "bearer" })).auth).toEqual({ type: "bearer" });
    expect(() => buildHttpParams(form({ authType: "header" }))).toThrow(/header name/);
  });
});

describe("buildHttpCheck secret handling", () => {
  it("never sends a blank secret (omit keeps the stored one)", () => {
    const c = buildHttpCheck(form({ authType: "bearer", secret: "", hasSecret: true }));
    expect("secret" in c).toBe(false);
  });
  it("sends a typed secret", () => {
    expect(buildHttpCheck(form({ authType: "bearer", secret: "tok" })).secret).toBe("tok");
  });
  it("needs a secret when auth is new", () => {
    expect(() => buildHttpCheck(form({ authType: "bearer" }))).toThrow(/token/i);
    expect(() => buildHttpCheck(form({ authType: "bearer", secret: "  \n" }))).toThrow(/token/i);
  });
  it("trims a pasted secret, and a blank one keeps the stored secret", () => {
    expect(buildHttpCheck(form({ authType: "bearer", secret: "  tok \n" })).secret).toBe("tok");
    expect("secret" in buildHttpCheck(form({ authType: "bearer", secret: "   ", hasSecret: true }))).toBe(false);
  });
  it("clears a stored secret when auth is switched off", () => {
    expect(buildHttpCheck(form({ authType: "none", hasSecret: true })).secret).toBe("");
    expect("secret" in buildHttpCheck(form({ authType: "none" }))).toBe(false);
  });
});

describe("httpFormOf", () => {
  it("round-trips stored params and never reads a secret", () => {
    const params = {
      url: "https://x.org/a",
      method: "PUT" as const,
      headers: { A: "1" },
      body: "b",
      expect_status: "200",
      keyword: { text: "k", mode: "absent" as const },
      json: { path: "p", op: ">" as const, value: 3 },
      slow_ms: 900,
      cert_warn_days: 30,
      verify_tls: false,
      follow_redirects: false,
      auth: { type: "basic" as const, username: "u" },
      name: "n",
    };
    const f = httpFormOf(httpCheck(9, params, true));
    expect(f.hasSecret).toBe(true);
    expect(f.secret).toBe("");
    expect(buildHttpParams(f)).toEqual(params);
  });
  it("keeps a numeric-looking string visible as a string", () => {
    expect(formatJsonValue("3")).toBe('"3"');
    expect(formatJsonValue("ok")).toBe("ok");
    expect(formatJsonValue(3)).toBe("3");
  });
});

describe("diffHttpChecks", () => {
  const stored = httpCheck(5, { url: "https://x.org/a", method: "GET" });
  it("leaves an unchanged check alone, even when the server stored defaults", () => {
    const full = httpCheck(5, { url: "https://x.org/a", method: "GET", expect_status: "200-399", slow_ms: 2000, verify_tls: true });
    const d = diffHttpChecks([full], desiredHttpChecks([httpFormOf(full)]));
    expect(d).toEqual({ add: [], update: [], remove: [] });
  });
  it("updates an edited check, adds a new one and removes a dropped one", () => {
    const other = httpCheck(6, { url: "https://x.org/b" });
    const edited = { ...httpFormOf(stored), slowMs: "100" };
    const fresh = form();
    const d = diffHttpChecks([stored, other], desiredHttpChecks([edited, fresh]));
    expect(d.update.map((u) => u.id)).toEqual([5]);
    expect(d.add).toHaveLength(1);
    expect(d.remove.map((c) => c.id)).toEqual([6]);
  });
  it("updates when a new secret was typed", () => {
    const withSecret = { ...httpFormOf(httpCheck(5, { url: "https://x.org/a", auth: { type: "bearer" } }, true)), secret: "new" };
    const d = diffHttpChecks([httpCheck(5, { url: "https://x.org/a", auth: { type: "bearer" } }, true)], desiredHttpChecks([withSecret]));
    expect(d.update).toHaveLength(1);
    expect(d.update[0].check.secret).toBe("new");
  });
});

describe("applyHttpChanges", () => {
  it("returns the new baseline and on failure carries the baseline and forms with ids", async () => {
    const created = httpCheck(11, { url: "https://sts.example.org/adfs" });
    const addCheck = vi
      .fn<(id: number, b: CheckIn) => Promise<CheckOut>>()
      .mockResolvedValueOnce(created)
      .mockRejectedValueOnce(new Error("boom"));
    const api = { addCheck, updateCheck: vi.fn(), deleteCheck: vi.fn() };
    const a = form();
    const b = form({ url: "https://other.example.org/" });
    const err = await applyHttpChanges(1, [], [a, b], api).catch((e: unknown) => e as HttpSaveError);
    expect(err).toBeInstanceOf(Error);
    expect((err as HttpSaveError).baseline).toEqual([created]);
    expect((err as HttpSaveError).httpForms?.map((f) => f.id)).toEqual([11, null]);
  });
});

describe("result text", () => {
  it("summarises a test result", () => {
    expect(httpTestSummary(result())).toBe("OK · HTTP 200 · 143 ms · cert 112 d");
    expect(httpTestSummary(result({ ok: false, reason: "status 503", value: { status_code: 503, elapsed_ms: 20, cert_expires: null, cert_days: null, final_url: null }, latency_ms: 20 }))).toBe(
      "Failed · HTTP 503 · 20 ms · status 503",
    );
  });
  it("writes the certificate expiry line", () => {
    expect(certExpiryLine(result())).toBe("expires 2027-03-01 (112 days)");
    expect(certExpiryLine(result({ value: { cert_expires: null } }))).toBeNull();
  });
});

describe("certWarnDaysFor", () => {
  it("takes the smallest cert_warn_days among enabled checks on the same host:port, else 14", () => {
    const checks: CheckOut[] = [
      httpCheck(1, { url: "https://sts.example.org/a", cert_warn_days: 30 }),
      httpCheck(2, { url: "https://STS.example.org:443/b", cert_warn_days: 21 }),
      httpCheck(3, { url: "https://sts.example.org:8443/c", cert_warn_days: 2 }),
      httpCheck(4, { url: "https://other.example.org/", cert_warn_days: 1 }),
      { ...httpCheck(5, { url: "https://sts.example.org/d", cert_warn_days: 3 }), enabled: false },
      { id: 6, device_id: 1, created_at: "", enabled: true, type: "tcp", params: { port: 443 } },
    ];
    expect(certWarnDaysFor(checks, "https://sts.example.org/")).toBe(21);
    expect(certWarnDaysFor(checks, "https://sts.example.org:8443/x")).toBe(2);
    expect(certWarnDaysFor(checks, "https://none.example.org/")).toBe(14);
    expect(certWarnDaysFor([httpCheck(7, { url: "https://sts.example.org/" })], "https://sts.example.org/")).toBe(14);
    expect(certWarnDaysFor(checks, null)).toBe(14);
    expect(certWarnDaysFor(checks, "not a url")).toBe(14);
  });
});
