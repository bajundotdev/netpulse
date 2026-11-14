import { useState } from "react";
import { X } from "lucide-react";
import { testDevice } from "@/api/client";
import { OPTION, SelectField, TextAreaField, TextField, pick } from "@/components/Field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AUTH_TYPES,
  HTTP_METHODS,
  JSON_OPS,
  KEYWORD_MODES,
  hasBody,
  httpTestSummary,
  newHttpForm,
  type HttpForm,
} from "@/features/http";
import type { ResultOut } from "@/types";

type Outcome = { busy: boolean; result: ResultOut | null; error: string | null };

type Props = {
  value: HttpForm[];
  onChange: (value: HttpForm[]) => void;
  // The saved device the Test button runs against; a new device has nothing to test yet.
  deviceId?: number;
};

const AUTH_LABELS = { none: "None", bearer: "Bearer token", basic: "Basic (user + password)", header: "Custom header" };
const SECRET_LABELS = { bearer: "Token", basic: "Password", header: "Header value" };

export default function HttpTab({ value, onChange, deviceId }: Props) {
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const patch = (key: string, change: Partial<HttpForm>) =>
    onChange(value.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const runTest = async (form: HttpForm) => {
    if (deviceId === undefined || form.id === null) return;
    setOutcomes((o) => ({ ...o, [form.key]: { busy: true, result: null, error: null } }));
    try {
      const results = await testDevice(deviceId);
      const result = results.find((r) => r.check_id === form.id) ?? null;
      setOutcomes((o) => ({
        ...o,
        [form.key]: { busy: false, result, error: result ? null : "No result came back for this check" },
      }));
    } catch (err) {
      setOutcomes((o) => ({
        ...o,
        [form.key]: { busy: false, result: null, error: err instanceof Error ? err.message : String(err) },
      }));
    }
  };

  return (
    <div className="grid gap-4">
      {value.length === 0 && <p className="text-sm text-muted-foreground">No HTTP checks. A failing check marks the device degraded.</p>}
      {value.map((f, i) => {
        const id = (name: string) => `${f.key}-${name}`;
        const outcome = outcomes[f.key];
        const canTest = deviceId !== undefined && f.id !== null;
        const setHeader = (j: number, change: Partial<HttpForm["headers"][number]>) =>
          patch(f.key, { headers: f.headers.map((h, k) => (k === j ? { ...h, ...change } : h)) });
        return (
          <section key={f.key} role="group" aria-label={`HTTP check ${i + 1}`} className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{`HTTP check ${i + 1}`}</h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove HTTP check ${i + 1}`}
                onClick={() => onChange(value.filter((x) => x.key !== f.key))}
              >
                <X aria-hidden="true" />
                Remove
              </Button>
            </div>

            <TextField
              id={id("name")}
              label="Name (optional)"
              value={f.name}
              onChange={(e) => patch(f.key, { name: e.target.value })}
              placeholder="shown on the chip, e.g. api/health"
            />
            <div className="grid grid-cols-4 gap-3">
              <SelectField
                id={id("method")}
                label="Method"
                fieldClassName="col-span-1"
                value={f.method}
                onChange={(e) => patch(f.key, { method: pick(HTTP_METHODS, e.target.value, "GET") })}
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} className={OPTION}>
                    {m}
                  </option>
                ))}
              </SelectField>
              <TextField
                id={id("url")}
                label="URL"
                fieldClassName="col-span-3"
                className="font-mono"
                placeholder="https://sts.example.org/adfs/ls"
                value={f.url}
                onChange={(e) => patch(f.key, { url: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>Headers</Label>
              {f.headers.map((h, j) => (
                <div key={j} className="grid grid-cols-12 items-center gap-2">
                  <Input
                    aria-label={`Header ${j + 1} name`}
                    className="col-span-5 font-mono"
                    placeholder="Accept"
                    value={h.name}
                    onChange={(e) => setHeader(j, { name: e.target.value })}
                  />
                  <Input
                    aria-label={`Header ${j + 1} value`}
                    className="col-span-6 font-mono"
                    value={h.value}
                    onChange={(e) => setHeader(j, { value: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="col-span-1"
                    aria-label={`Remove header ${j + 1}`}
                    onClick={() => patch(f.key, { headers: f.headers.filter((_, k) => k !== j) })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => patch(f.key, { headers: [...f.headers, { name: "", value: "" }] })}
                >
                  Add header
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Headers are stored unencrypted. Put tokens and passwords in Authentication instead.
              </p>
            </div>

            {hasBody(f.method) && (
              <TextAreaField
                id={id("body")}
                label="Body"
                rows={3}
                className="font-mono"
                value={f.body}
                onChange={(e) => patch(f.key, { body: e.target.value })}
              />
            )}

            <TextField
              id={id("expect")}
              label="Expected status"
              className="font-mono"
              placeholder="200-399 or 200,204,301-302"
              value={f.expectStatus}
              onChange={(e) => patch(f.key, { expectStatus: e.target.value })}
            />

            <div className="grid grid-cols-5 gap-3">
              <SelectField
                id={id("keywordMode")}
                label="Keyword rule"
                fieldClassName="col-span-2"
                value={f.keywordMode}
                onChange={(e) => patch(f.key, { keywordMode: pick(KEYWORD_MODES, e.target.value, "contains") })}
              >
                <option value="contains" className={OPTION}>
                  Page contains
                </option>
                <option value="absent" className={OPTION}>
                  Page does not contain
                </option>
              </SelectField>
              <TextField
                id={id("keyword")}
                label="Keyword (case-sensitive)"
                fieldClassName="col-span-3"
                value={f.keywordText}
                onChange={(e) => patch(f.key, { keywordText: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-12 gap-3">
              <TextField
                id={id("jsonPath")}
                label="JSON path"
                fieldClassName="col-span-5"
                className="font-mono"
                placeholder="data.status"
                value={f.jsonPath}
                onChange={(e) => patch(f.key, { jsonPath: e.target.value })}
              />
              <SelectField
                id={id("jsonOp")}
                label="JSON test"
                fieldClassName="col-span-3"
                value={f.jsonOp}
                onChange={(e) => patch(f.key, { jsonOp: pick(JSON_OPS, e.target.value, "==") })}
              >
                {JSON_OPS.map((o) => (
                  <option key={o} className={OPTION}>
                    {o}
                  </option>
                ))}
              </SelectField>
              {f.jsonOp !== "exists" && (
                <TextField
                  id={id("jsonValue")}
                  label="JSON value"
                  fieldClassName="col-span-4"
                  className="font-mono"
                  placeholder="ok"
                  value={f.jsonValue}
                  onChange={(e) => patch(f.key, { jsonValue: e.target.value })}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField
                id={id("slowMs")}
                label="Slow after (ms)"
                type="number"
                min={1}
                value={f.slowMs}
                onChange={(e) => patch(f.key, { slowMs: e.target.value })}
              />
              <TextField
                id={id("certDays")}
                label="Certificate warning (days)"
                type="number"
                min={0}
                value={f.certWarnDays}
                onChange={(e) => patch(f.key, { certWarnDays: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id={id("verify")} checked={f.verifyTls} onCheckedChange={(verifyTls) => patch(f.key, { verifyTls })} />
              <Label htmlFor={id("verify")}>Verify TLS certificate</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={id("redirects")}
                checked={f.followRedirects}
                onCheckedChange={(followRedirects) => patch(f.key, { followRedirects })}
              />
              <Label htmlFor={id("redirects")}>Follow redirects</Label>
            </div>

            <div className="grid grid-cols-5 gap-3">
              <SelectField
                id={id("auth")}
                label="Authentication"
                fieldClassName="col-span-2"
                value={f.authType}
                onChange={(e) => patch(f.key, { authType: pick(AUTH_TYPES, e.target.value, "none") })}
              >
                {AUTH_TYPES.map((t) => (
                  <option key={t} value={t} className={OPTION}>
                    {AUTH_LABELS[t]}
                  </option>
                ))}
              </SelectField>
              {f.authType === "basic" && (
                <TextField
                  id={id("authUser")}
                  label="Username"
                  fieldClassName="col-span-3"
                  autoComplete="off"
                  value={f.authUsername}
                  onChange={(e) => patch(f.key, { authUsername: e.target.value })}
                />
              )}
              {f.authType === "header" && (
                <TextField
                  id={id("authHeader")}
                  label="Header name"
                  fieldClassName="col-span-3"
                  className="font-mono"
                  placeholder="X-Api-Key"
                  value={f.authHeaderName}
                  onChange={(e) => patch(f.key, { authHeaderName: e.target.value })}
                />
              )}
            </div>
            {f.authType !== "none" && (
              <TextField
                id={id("secret")}
                label={SECRET_LABELS[f.authType]}
                type="password"
                autoComplete="new-password"
                value={f.secret}
                placeholder={f.hasSecret ? "unchanged" : ""}
                onChange={(e) => patch(f.key, { secret: e.target.value })}
              />
            )}

            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Test HTTP check ${i + 1}`}
                  disabled={!canTest || outcome?.busy}
                  onClick={() => void runTest(f)}
                >
                  {outcome?.busy ? "Testing..." : "Test"}
                </Button>
                {!canTest && <span className="text-sm text-muted-foreground">Save to test</span>}
                {canTest && !outcome && (
                  <span className="text-sm text-muted-foreground">Runs the saved version of this check.</span>
                )}
              </div>
              {outcome?.result && (
                <p
                  role="status"
                  className={`text-sm ${outcome.result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                >
                  {httpTestSummary(outcome.result)}
                </p>
              )}
              {outcome?.error && (
                <Alert variant="destructive">
                  <AlertDescription>{outcome.error}</AlertDescription>
                </Alert>
              )}
            </div>
          </section>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, newHttpForm()])}>
          Add HTTP check
        </Button>
      </div>
    </div>
  );
}
