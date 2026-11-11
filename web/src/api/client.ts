import type { paths } from "@/api/schema";
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

type Params = { [key: string]: string | number | null | undefined };

interface RequestOptions {
  body?: unknown;
  params?: Params;
}

async function send(method: string, path: string, { body, params }: RequestOptions = {}): Promise<Response> {
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
  return res;
}

// The JSON body of a 200 response. The cast is the single trust boundary with the backend;
// the checks below tie each endpoint's type to the generated schema.
async function request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
  const res = await send(method, path, options);
  return (await res.json()) as T;
}

// Endpoints that answer 204 No Content.
async function requestNoContent(method: string, path: string, options?: RequestOptions): Promise<void> {
  await send(method, path, options);
}

export const listDevices = () => request<DeviceOut[]>("GET", "/devices");
export const getDevice = (id: number) => request<DeviceOut>("GET", `/devices/${id}`);
export const createDevice = (body: DeviceIn) => request<DeviceOut>("POST", "/devices", { body });
export const updateDevice = (id: number, body: DeviceUpdate) =>
  request<DeviceOut>("PUT", `/devices/${id}`, { body });
export const deleteDevice = (id: number) => requestNoContent("DELETE", `/devices/${id}`);
export const testDevice = (id: number) => request<ResultOut[]>("POST", `/devices/${id}/test`);
export const addCheck = (deviceId: number, body: CheckIn) =>
  request<CheckOut>("POST", `/devices/${deviceId}/checks`, { body });
export const updateCheck = (id: number, body: CheckIn) => request<CheckOut>("PUT", `/checks/${id}`, { body });
export const deleteCheck = (id: number) => requestNoContent("DELETE", `/checks/${id}`);
export const getStatus = () => request<DeviceStatusOut[]>("GET", "/status");
export const listEvents = (params?: EventsQuery) => request<EventOut[]>("GET", "/events", { params });
export const ackEvent = (id: number) => requestNoContent("POST", `/events/${id}/ack`);
export const clearEvents = () => request<EventsCleared>("DELETE", "/events");
export const getHistory = (range: Range) => request<HistoryOut>("GET", "/history", { params: { range } });

// Compile-time checks against the generated schema: query parameters, the clear-events body, and
// the response type of each JSON endpoint must agree with the types the functions return.
type Op<P extends keyof paths, M extends keyof paths[P]> = paths[P][M];
type JsonBody<O, Code extends number> = O extends {
  responses: { [C in Code]: { content: { "application/json": infer R } } };
}
  ? R
  : never;
type Returns<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;
type Narrows<Narrow, Generated> = [Narrow] extends [Generated] ? true : false;
type NoContent<O, Code extends number> = O extends { responses: { [C in Code]: { content?: never } } }
  ? true
  : false;

export type EventsQuery = NonNullable<Op<"/api/events", "get">["parameters"]["query"]>;
export type EventsCleared = JsonBody<Op<"/api/events", "delete">, 200>;

type Checks<T extends true[]> = T;
export type ApiEndpointChecks = Checks<[
  Narrows<Returns<typeof listDevices>, JsonBody<Op<"/api/devices", "get">, 200>>,
  Narrows<Returns<typeof createDevice>, JsonBody<Op<"/api/devices", "post">, 201>>,
  Narrows<Returns<typeof getDevice>, JsonBody<Op<"/api/devices/{device_id}", "get">, 200>>,
  Narrows<Returns<typeof updateDevice>, JsonBody<Op<"/api/devices/{device_id}", "put">, 200>>,
  Narrows<Returns<typeof addCheck>, JsonBody<Op<"/api/devices/{device_id}/checks", "post">, 201>>,
  Narrows<Returns<typeof updateCheck>, JsonBody<Op<"/api/checks/{check_id}", "put">, 200>>,
  Narrows<Returns<typeof testDevice>, JsonBody<Op<"/api/devices/{device_id}/test", "post">, 200>>,
  Narrows<Returns<typeof getStatus>, JsonBody<Op<"/api/status", "get">, 200>>,
  Narrows<Returns<typeof listEvents>, JsonBody<Op<"/api/events", "get">, 200>>,
  Narrows<Returns<typeof getHistory>, JsonBody<Op<"/api/history", "get">, 200>>,
  NoContent<Op<"/api/devices/{device_id}", "delete">, 204>,
  NoContent<Op<"/api/checks/{check_id}", "delete">, 204>,
  NoContent<Op<"/api/events/{event_id}/ack", "post">, 204>,
]>;
