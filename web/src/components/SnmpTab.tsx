import { X } from "lucide-react";
import { Field, NativeSelect, OPTION, TextField, pick } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { newOidRow, type OidRow, type SnmpForm } from "@/features/snmp";
import type { AuthProto, OidMode, PrivProto, SnmpOut, ThresholdOp } from "@/types";

const VERSIONS = ["off", "v2c", "v3"] as const;
const VERSION_LABELS: Record<(typeof VERSIONS)[number], string> = { off: "Off", v2c: "v2c", v3: "v3" };
const AUTH_PROTOS: readonly AuthProto[] = ["none", "MD5", "SHA", "SHA256"];
const PRIV_PROTOS: readonly PrivProto[] = ["none", "DES", "AES128", "AES256"];
const OPS: readonly ThresholdOp[] = [">", ">=", "<", "<=", "==", "!="];
const MODES: readonly OidMode[] = ["change", "threshold"];

type StringKey = "port" | "community" | "user" | "authKey" | "privKey" | "ifIndexes";

type Props = {
  value: SnmpForm;
  onChange: (value: SnmpForm) => void;
  current?: SnmpOut | null;
};

export default function SnmpTab({ value, onChange, current }: Props) {
  const set = (key: StringKey) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  const setOid = <K extends keyof OidRow>(i: number, key: K, v: OidRow[K]) =>
    onChange({ ...value, oids: value.oids.map((row, j) => (j === i ? { ...row, [key]: v } : row)) });
  const off = value.version === "off";

  // Secrets are write-only: the stored value is never shown, only "unchanged".
  const secret = (key: "community" | "authKey" | "privKey", label: string, has: boolean | undefined) => (
    <TextField
      id={`snmp-${key}`}
      label={label}
      type="password"
      autoComplete="new-password"
      value={value[key]}
      onChange={set(key)}
      placeholder={has ? "unchanged" : ""}
    />
  );

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="SNMP version" className="flex gap-4">
        {VERSIONS.map((v) => (
          <div key={v} className="flex items-center gap-1.5">
            <input
              type="radio"
              id={`snmp-version-${v}`}
              name="snmp-version"
              className="size-4 accent-primary"
              checked={value.version === v}
              onChange={() => onChange({ ...value, version: v })}
            />
            <Label htmlFor={`snmp-version-${v}`}>{VERSION_LABELS[v]}</Label>
          </div>
        ))}
      </div>

      {!off && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <TextField id="snmp-port" label="Port" type="number" min={1} max={65535} value={value.port} onChange={set("port")} />
          </div>

          {value.version === "v2c" && secret("community", "Community", current?.has_community)}

          {value.version === "v3" && (
            <>
              <TextField id="snmp-user" label="User" autoComplete="off" value={value.user} onChange={set("user")} />
              <div className="grid grid-cols-5 gap-3">
                <Field id="snmp-authProto" label="Auth protocol" className="col-span-2">
                  <NativeSelect
                    id="snmp-authProto"
                    value={value.authProto}
                    onChange={(e) => onChange({ ...value, authProto: pick(AUTH_PROTOS, e.target.value, "none") })}
                  >
                    {AUTH_PROTOS.map((p) => (
                      <option key={p} className={OPTION}>
                        {p}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="col-span-3">{secret("authKey", "Auth key", current?.has_auth_key)}</div>
              </div>
              <div className="grid grid-cols-5 gap-3">
                <Field id="snmp-privProto" label="Privacy protocol" className="col-span-2">
                  <NativeSelect
                    id="snmp-privProto"
                    value={value.privProto}
                    onChange={(e) => onChange({ ...value, privProto: pick(PRIV_PROTOS, e.target.value, "none") })}
                  >
                    {PRIV_PROTOS.map((p) => (
                      <option key={p} className={OPTION}>
                        {p}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="col-span-3">{secret("privKey", "Privacy key", current?.has_priv_key)}</div>
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <Switch id="snmp-uptime" checked={value.uptime} onCheckedChange={(uptime) => onChange({ ...value, uptime })} />
            <Label htmlFor="snmp-uptime">Watch uptime (reboots)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="snmp-interfaces"
              checked={value.interfaces}
              onCheckedChange={(interfaces) => onChange({ ...value, interfaces })}
            />
            <Label htmlFor="snmp-interfaces">Watch interfaces</Label>
          </div>
          {value.interfaces && (
            <TextField
              id="snmp-ifIndexes"
              label="Interface indexes (optional)"
              value={value.ifIndexes}
              onChange={set("ifIndexes")}
              placeholder="all interfaces, or e.g. 1, 2, 24"
            />
          )}

          <h3 className="mt-2 text-sm font-medium">Custom OIDs</h3>
          {value.oids.map((row, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <Input
                aria-label={`OID ${i + 1}`}
                className="col-span-12 font-mono sm:col-span-4"
                placeholder="1.3.6.1.2.1..."
                value={row.oid}
                onChange={(e) => setOid(i, "oid", e.target.value)}
              />
              <Input
                aria-label={`OID ${i + 1} label`}
                className="col-span-6 sm:col-span-3"
                placeholder="Label"
                value={row.label}
                onChange={(e) => setOid(i, "label", e.target.value)}
              />
              <NativeSelect
                aria-label={`OID ${i + 1} mode`}
                className="col-span-6 sm:col-span-2"
                value={row.mode}
                onChange={(e) => setOid(i, "mode", pick(MODES, e.target.value, "change"))}
              >
                <option value="change" className={OPTION}>
                  Change
                </option>
                <option value="threshold" className={OPTION}>
                  Threshold
                </option>
              </NativeSelect>
              {row.mode === "threshold" ? (
                <>
                  <NativeSelect
                    aria-label={`OID ${i + 1} operator`}
                    className="col-span-3 px-1.5 sm:col-span-1"
                    value={row.op}
                    onChange={(e) => setOid(i, "op", pick(OPS, e.target.value, ">"))}
                  >
                    {OPS.map((o) => (
                      <option key={o} className={OPTION}>
                        {o}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={`OID ${i + 1} value`}
                    className="col-span-7 sm:col-span-1"
                    value={row.value}
                    onChange={(e) => setOid(i, "value", e.target.value)}
                  />
                </>
              ) : (
                <div className="col-span-10 sm:col-span-2" />
              )}
              <div className="col-span-2 text-right sm:col-span-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove OID ${i + 1}`}
                  onClick={() => onChange({ ...value, oids: value.oids.filter((_, j) => j !== i) })}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...value, oids: [...value.oids, newOidRow()] })}
            >
              Add OID
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
