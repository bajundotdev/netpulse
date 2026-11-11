// API shapes derive from the schema generated out of the backend (src/api/schema.d.ts). The schema
// types enums as plain strings and check params as an open object, so the UI narrows those here:
// each narrowed type is checked against its generated counterpart at the bottom of this section.
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

export type DeviceStatus = "UNKNOWN" | "UP" | "DEGRADED" | "DOWN" | "PAUSED";
export type SlotStatus = "UP" | "DEGRADED" | "DOWN" | "PAUSED" | null;
export type Range = "1h" | "24h" | "7d";
export type View = "list" | "cards";
export type SortKey = "problems" | "name" | "host" | "latency";

export type DeviceKind = "dc" | "server" | "switch" | "printer" | "other";
export type Liveness = "ping" | "tcp";
export type SnmpVersion = "v2c" | "v3";
export type AuthProto = "none" | "MD5" | "SHA" | "SHA256";
export type PrivProto = "none" | "DES" | "AES128" | "AES256";
export type Severity = "info" | "warning" | "critical";
export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";
export type OidMode = "change" | "threshold";

export type SnmpIn = Schemas["SnmpIn"];

export type SnmpOut = Omit<Schemas["SnmpOut"], "auth_proto" | "priv_proto"> & {
  auth_proto: AuthProto;
  priv_proto: PrivProto;
};

export type TcpParams = { port: number };
export type SnmpUptimeParams = Record<string, never>;
export type SnmpIfParams = { if_indexes?: number[] };
export type SnmpOidParams = {
  oid: string;
  label: string;
  mode: OidMode;
  op?: ThresholdOp;
  value?: number;
};

export type CheckSpec =
  | { type: "tcp"; params: TcpParams }
  | { type: "snmp_uptime"; params: SnmpUptimeParams }
  | { type: "snmp_if"; params: SnmpIfParams }
  | { type: "snmp_oid"; params: SnmpOidParams };

export type CheckIn = CheckSpec & { enabled?: boolean };
export type CheckOut = CheckSpec & Omit<Schemas["CheckOut"], "type" | "params">;

export type TcpCheckOut = Extract<CheckOut, { type: "tcp" }>;

export type DeviceIn = Omit<Schemas["DeviceIn"], "checks"> & { checks?: CheckIn[] };

export type DeviceUpdate = Schemas["DeviceUpdate"];

export type DeviceOut = Omit<Schemas["DeviceOut"], "kind" | "liveness" | "snmp" | "checks"> & {
  kind: DeviceKind;
  liveness: Liveness;
  snmp: SnmpOut | null;
  checks: CheckOut[];
};

export type ResultOut = Schemas["ResultOut"];

export type DeviceStatusOut = Omit<Schemas["DeviceStatusOut"], "status"> & { status: DeviceStatus };

export type EventOut = Omit<Schemas["EventOut"], "status" | "previous_status"> & {
  status: DeviceStatus | null;
  previous_status: DeviceStatus | null;
};

export type DeviceHistoryOut = Omit<Schemas["DeviceHistoryOut"], "buckets"> & { buckets: SlotStatus[] };

export type HistoryOut = Omit<Schemas["HistoryOut"], "range" | "overall" | "devices"> & {
  range: Range;
  overall: { problems: number[]; status: SlotStatus[] };
  devices: DeviceHistoryOut[];
};

// Compile-time checks: every narrowed type must still be assignable to the generated schema type.
type Narrows<Narrow, Generated> = [Narrow] extends [Generated] ? true : false;
type Checks<T extends true[]> = T;
export type ApiShapeChecks = Checks<[
  Narrows<CheckIn, Schemas["CheckIn"]>,
  Narrows<CheckOut, Schemas["CheckOut"]>,
  Narrows<DeviceIn, Schemas["DeviceIn"]>,
  Narrows<DeviceOut, Schemas["DeviceOut"]>,
  Narrows<SnmpOut, Schemas["SnmpOut"]>,
  Narrows<DeviceStatusOut, Schemas["DeviceStatusOut"]>,
  Narrows<EventOut, Schemas["EventOut"]>,
  Narrows<DeviceHistoryOut, Schemas["DeviceHistoryOut"]>,
  Narrows<HistoryOut, Schemas["HistoryOut"]>,
]>;

// A device as the UI holds it: configuration plus its live status.
export interface LiveDevice extends DeviceOut {
  status: DeviceStatus;
  since: string | null;
  consecutive_failures: number;
  results: ResultOut[];
  latency: (number | null)[];
}

export interface MonitorState {
  devices: Record<number, LiveDevice>;
  order: number[];
  events: EventOut[];
  connected: boolean;
  // The stream has been down long enough that the shown statuses cannot be trusted.
  stale: boolean;
  loadError: string | null;
}

// Payload of the "status" stream message.
export interface StatusPayload {
  device_id: number;
  status: DeviceStatus;
  previous_status: DeviceStatus | null;
  since: string | null;
  consecutive_failures: number;
}

// Payload of the "result" stream message; the backend adds the current status to it.
export interface ResultPayload {
  device_id: number;
  results: ResultOut[];
  latency_ms?: number | null;
  status?: DeviceStatus;
  since?: string | null;
  consecutive_failures?: number;
}

export type MonitorAction =
  | { type: "SNAPSHOT"; devices: DeviceOut[]; statuses: DeviceStatusOut[]; events: EventOut[] }
  | { type: "STATUS"; payload: StatusPayload }
  | { type: "RESULT"; payload: ResultPayload }
  | { type: "EVENT"; event: EventOut }
  | { type: "LOAD_FAILED"; message: string }
  | { type: "CONNECTED" }
  | { type: "STALE" }
  | { type: "DISCONNECTED" }
  | { type: "DEVICE_REMOVED"; id: number }
  | { type: "EVENT_ACKED"; id: number }
  | { type: "EVENTS_CLEARED" };
