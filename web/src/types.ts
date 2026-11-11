// Hand-written shapes of the backend API and the monitor state. Task 2 replaces the API-shaped
// parts with types generated from the OpenAPI schema.

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

export interface SnmpIn {
  version: SnmpVersion;
  port: number;
  community?: string;
  user?: string;
  auth_proto?: AuthProto;
  auth_key?: string;
  priv_proto?: PrivProto;
  priv_key?: string;
}

export interface SnmpOut {
  version: SnmpVersion;
  port: number;
  user: string | null;
  auth_proto: AuthProto;
  priv_proto: PrivProto;
  has_community: boolean;
  has_auth_key: boolean;
  has_priv_key: boolean;
}

export interface TcpParams {
  port: number;
}
export type SnmpUptimeParams = Record<string, never>;
export interface SnmpIfParams {
  if_indexes?: number[];
}
export interface SnmpOidParams {
  oid: string;
  label: string;
  mode: OidMode;
  op?: ThresholdOp;
  value?: number;
}

export type CheckSpec =
  | { type: "tcp"; params: TcpParams }
  | { type: "snmp_uptime"; params: SnmpUptimeParams }
  | { type: "snmp_if"; params: SnmpIfParams }
  | { type: "snmp_oid"; params: SnmpOidParams };

export type CheckIn = CheckSpec & { enabled?: boolean };
export type CheckOut = CheckSpec & {
  id: number;
  device_id: number;
  enabled: boolean;
  created_at: string;
};

export type TcpCheckOut = Extract<CheckOut, { type: "tcp" }>;

export interface DeviceIn {
  name: string;
  host: string;
  kind?: DeviceKind;
  enabled?: boolean;
  interval_s?: number;
  fail_threshold?: number;
  timeout_ms?: number;
  liveness?: Liveness;
  liveness_port?: number | null;
  snmp?: SnmpIn | null;
  notes?: string | null;
  checks?: CheckIn[];
}

export type DeviceUpdate = Partial<Omit<DeviceIn, "checks">>;

export interface DeviceOut {
  id: number;
  name: string;
  host: string;
  kind: DeviceKind;
  enabled: boolean;
  interval_s: number;
  fail_threshold: number;
  timeout_ms: number;
  liveness: Liveness;
  liveness_port: number | null;
  snmp: SnmpOut | null;
  notes: string | null;
  checks: CheckOut[];
  created_at: string;
  updated_at: string;
}

export interface ResultOut {
  type: string;
  label: string;
  ok: boolean;
  check_id?: number | null;
  latency_ms?: number | null;
  reason?: string | null;
  value?: unknown;
}

export interface DeviceStatusOut {
  device_id: number;
  name: string;
  status: DeviceStatus;
  since: string | null;
  consecutive_failures: number;
  results: ResultOut[];
  latency: (number | null)[];
}

export interface EventOut {
  id: number;
  ts: string;
  device_id: number | null;
  check_id: number | null;
  severity: Severity;
  kind: string;
  message: string;
  status: DeviceStatus | null;
  previous_status: DeviceStatus | null;
  acknowledged: boolean;
}

export interface DeviceHistoryOut {
  device_id: number;
  buckets: SlotStatus[];
  uptime_pct: number | null;
}

export interface HistoryOut {
  range: Range;
  start: string;
  end: string;
  bucket_seconds: number;
  problems_last_hour: number;
  overall: { problems: number[]; status: SlotStatus[] };
  devices: DeviceHistoryOut[];
}

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
