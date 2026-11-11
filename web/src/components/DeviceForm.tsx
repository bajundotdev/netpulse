import { useRef, useState, type FormEvent } from "react";
import { ApiError, addCheck, createDevice, deleteCheck, updateCheck, updateDevice } from "@/api/client";
import { OPTION, SelectField, TextAreaField, TextField, pick } from "@/components/Field";
import PortsTab from "@/components/PortsTab";
import SnmpTab from "@/components/SnmpTab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KIND_LABELS } from "@/features/format";
import { applyPortChanges, portsOf, withPendingPort, type BaselineError } from "@/features/ports";
import { applySnmpChanges, buildSnmpPayload, desiredSnmpChecks, snmpFormOf } from "@/features/snmp";
import type { CheckOut, DeviceIn, DeviceKind, DeviceOut, Liveness } from "@/types";

interface FormValues {
  name: string;
  host: string;
  kind: DeviceKind;
  liveness: Liveness;
  liveness_port: string;
  interval_s: string;
  fail_threshold: string;
  timeout_ms: string;
  notes: string;
}

type FieldKey = keyof FormValues;
type TextKey = Exclude<FieldKey, "kind" | "liveness">;

const DEFAULTS: FormValues = {
  name: "",
  host: "",
  kind: "other",
  liveness: "ping",
  liveness_port: "",
  interval_s: "5",
  fail_threshold: "2",
  timeout_ms: "1000",
  notes: "",
};

const KINDS = Object.keys(KIND_LABELS) as DeviceKind[];
const LIVENESS: readonly Liveness[] = ["ping", "tcp"];

function toForm(device: DeviceOut | undefined): FormValues {
  if (!device) return DEFAULTS;
  return {
    name: device.name,
    host: device.host,
    kind: device.kind,
    liveness: device.liveness,
    liveness_port: device.liveness_port == null ? "" : String(device.liveness_port),
    interval_s: String(device.interval_s),
    fail_threshold: String(device.fail_threshold),
    timeout_ms: String(device.timeout_ms),
    notes: device.notes ?? "",
  };
}

function toBody(f: FormValues): Omit<DeviceIn, "checks" | "snmp"> {
  return {
    name: f.name,
    host: f.host.trim(),
    kind: f.kind,
    liveness: f.liveness,
    liveness_port: f.liveness === "tcp" && f.liveness_port !== "" ? Number(f.liveness_port) : null,
    interval_s: Number(f.interval_s),
    fail_threshold: Number(f.fail_threshold),
    timeout_ms: Number(f.timeout_ms),
    notes: f.notes.trim() === "" ? null : f.notes,
  };
}

interface FormErrors {
  fields: Partial<Record<FieldKey, string>>;
  general: string | null;
}

const isFieldKey = (key: string): key is FieldKey => key in DEFAULTS;

// Splits a FastAPI error into per-field messages and a general message.
function parseError(err: unknown): FormErrors {
  if (!(err instanceof ApiError)) return { fields: {}, general: err instanceof Error ? err.message : String(err) };
  if (Array.isArray(err.detail)) {
    const fields: Partial<Record<FieldKey, string>> = {};
    const general: string[] = [];
    for (const item of err.detail as { loc?: unknown; msg?: unknown }[]) {
      const loc = Array.isArray(item.loc) ? item.loc : [];
      const field: unknown = loc.length > 1 ? loc[loc.length - 1] : null;
      const msg = String(item.msg ?? "Invalid value").replace(/^Value error, /, "");
      if (typeof field === "string" && isFieldKey(field)) {
        const prev = fields[field];
        fields[field] = prev ? `${prev}; ${msg}` : msg;
      } else general.push(msg);
    }
    return { fields, general: general.join("; ") || null };
  }
  return { fields: {}, general: typeof err.detail === "string" ? err.detail : err.message };
}

type Props = {
  device?: DeviceOut;
  onSaved: (saved: DeviceOut) => void | Promise<void>;
  onClose: () => void;
};

export default function DeviceForm({ device, onSaved, onClose }: Props) {
  const [form, setForm] = useState(() => toForm(device));
  const [errors, setErrors] = useState<FormErrors>({ fields: {}, general: null });
  const [ports, setPorts] = useState(() => portsOf(device?.checks));
  const [portText, setPortText] = useState("");
  const [portError, setPortError] = useState<string | null>(null);
  const [tab, setTab] = useState("general");
  const [snmp, setSnmp] = useState(() => snmpFormOf(device));
  const [baseline, setBaseline] = useState<CheckOut[]>(() => device?.checks ?? []);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const err = (key: FieldKey) => errors.fields[key];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // A port still in the "Add TCP port" box is saved too; an invalid one blocks saving.
    const pending = withPendingPort(ports, portText);
    setPortError(pending.error);
    if (pending.error) {
      setTab("ports");
      return;
    }
    const savePorts = pending.ports;
    if (portText !== "") {
      setPorts(savePorts);
      setPortText("");
    }
    setSaving(true);
    setErrors({ fields: {}, general: null });
    let working = baseline;
    try {
      const body = toBody(form);
      const desired = desiredSnmpChecks(snmp);
      const payload = buildSnmpPayload(snmp);
      let saved: DeviceOut;
      if (device) {
        const snmpApi = { addCheck, updateCheck, deleteCheck };
        if (payload === null && device.snmp) {
          // The backend refuses to drop SNMP while SNMP checks exist: delete them first.
          working = await applySnmpChanges(device.id, working, [], snmpApi);
          saved = await updateDevice(device.id, { ...body, snmp: null });
        } else {
          saved = await updateDevice(device.id, payload ? { ...body, snmp: payload } : body);
          working = await applySnmpChanges(
            device.id,
            await applyPortChanges(device.id, working, savePorts, { addCheck, deleteCheck }),
            desired,
            snmpApi,
          );
        }
        if (payload === null && device.snmp) {
          working = await applyPortChanges(device.id, working, savePorts, { addCheck, deleteCheck });
        }
        setBaseline(working);
      } else {
        const checks = [
          ...savePorts.map((port) => ({ type: "tcp" as const, params: { port }, enabled: true })),
          ...desired.map((c) => ({ ...c, enabled: true })),
        ];
        saved = await createDevice({ ...body, ...(payload ? { snmp: payload } : {}), checks });
      }
      await onSaved(saved);
    } catch (caught) {
      setBaseline(caught instanceof Error ? ((caught as BaselineError).baseline ?? working) : working);
      setErrors(parseError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        aria-describedby={undefined}
        // Static backdrop: a click outside must not throw away the typed values.
        onInteractOutside={(e) => e.preventDefault()}
        // App restores focus to whatever opened the first dialog of a chain.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-lg">{device ? `Edit ${device.name}` : "Add device"}</DialogTitle>
          </DialogHeader>
          {errors.general && (
            <Alert variant="destructive">
              <AlertDescription>{errors.general}</AlertDescription>
            </Alert>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="ports">{`Ports${ports.length ? ` (${ports.length})` : ""}`}</TabsTrigger>
              <TabsTrigger value="snmp">{`SNMP${snmp.version === "off" ? "" : ` (${snmp.version})`}`}</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="grid gap-3 pt-2">
              <TextField
                id="device-name"
                label="Name"
                ref={nameRef}
                required
                value={form.name}
                onChange={set("name")}
                error={err("name")}
              />
              <TextField
                id="device-host"
                label="Host or IP"
                required
                className="font-mono"
                placeholder="dc01.corp.local or 10.0.0.5"
                value={form.host}
                onChange={set("host")}
                error={err("host")}
              />
              <SelectField
                id="device-kind"
                label="Kind"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: pick(KINDS, e.target.value, "other") }))}
                error={err("kind")}
              >
                {KINDS.map((value) => (
                  <option key={value} value={value} className={OPTION}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </SelectField>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="device-liveness"
                  label="Liveness check"
                  value={form.liveness}
                  onChange={(e) => setForm((f) => ({ ...f, liveness: pick(LIVENESS, e.target.value, "ping") }))}
                  error={err("liveness")}
                >
                  <option value="ping" className={OPTION}>
                    Ping
                  </option>
                  <option value="tcp" className={OPTION}>
                    TCP port
                  </option>
                </SelectField>
                {form.liveness === "tcp" && (
                  <TextField
                    id="device-liveness_port"
                    label="Liveness port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.liveness_port}
                    onChange={set("liveness_port")}
                    error={err("liveness_port")}
                  />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TextField
                  id="device-interval_s"
                  label="Interval (s)"
                  type="number"
                  min={2}
                  max={3600}
                  value={form.interval_s}
                  onChange={set("interval_s")}
                  error={err("interval_s")}
                />
                <TextField
                  id="device-fail_threshold"
                  label="Fail threshold"
                  type="number"
                  min={1}
                  max={10}
                  value={form.fail_threshold}
                  onChange={set("fail_threshold")}
                  error={err("fail_threshold")}
                />
                <TextField
                  id="device-timeout_ms"
                  label="Timeout (ms)"
                  type="number"
                  min={200}
                  max={10000}
                  value={form.timeout_ms}
                  onChange={set("timeout_ms")}
                  error={err("timeout_ms")}
                />
              </div>
              <TextAreaField id="device-notes" label="Notes" rows={2} value={form.notes} onChange={set("notes")} error={err("notes")} />
            </TabsContent>
            <TabsContent value="ports" className="pt-2">
              <PortsTab
                ports={ports}
                onChange={setPorts}
                text={portText}
                onTextChange={setPortText}
                error={portError}
                onErrorChange={setPortError}
              />
            </TabsContent>
            <TabsContent value="snmp" className="pt-2">
              <SnmpTab value={snmp} onChange={setSnmp} current={device?.snmp} />
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
