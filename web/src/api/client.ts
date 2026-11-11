import type {
  CheckIn,
  CheckOut,
  DeviceIn,
  DeviceOut,
  DeviceStatusOut,
  DeviceUpdate,
  EventOut,
  HistoryOut,
  Range,
  ResultOut,
} from "@/types";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type Params = Record<string, string | number | null | undefined>;

interface RequestOptions {
  body?: unknown;
  params?: Params;
}

async function request<T>(method: string, path: string, { body, params }: RequestOptions = {}): Promise<T> {
  let url = `/api${path}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const data: unknown = await res.json();
      if (data && typeof data === "object" && "detail" in data && data.detail !== undefined) {
        detail = data.detail;
      }
    } catch {
      // non-JSON error body: keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export const listDevices = () => request<DeviceOut[]>("GET", "/devices");
export const getDevice = (id: number) => request<DeviceOut>("GET", `/devices/${id}`);
export const createDevice = (body: DeviceIn) => request<DeviceOut>("POST", "/devices", { body });
export const updateDevice = (id: number, body: DeviceUpdate) =>
  request<DeviceOut>("PUT", `/devices/${id}`, { body });
export const deleteDevice = (id: number) => request<null>("DELETE", `/devices/${id}`);
export const testDevice = (id: number) => request<ResultOut[]>("POST", `/devices/${id}/test`);
export const addCheck = (deviceId: number, body: CheckIn) =>
  request<CheckOut>("POST", `/devices/${deviceId}/checks`, { body });
export const updateCheck = (id: number, body: CheckIn) => request<CheckOut>("PUT", `/checks/${id}`, { body });
export const deleteCheck = (id: number) => request<null>("DELETE", `/checks/${id}`);
export const getStatus = () => request<DeviceStatusOut[]>("GET", "/status");
export const listEvents = (params?: Params) => request<EventOut[]>("GET", "/events", { params });
export const ackEvent = (id: number) => request<null>("POST", `/events/${id}/ack`);
export const clearEvents = () => request<null>("DELETE", "/events");
export const getHistory = (range: Range) => request<HistoryOut>("GET", "/history", { params: { range } });
