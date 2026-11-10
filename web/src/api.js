export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request(method, path, { body, params } = {}) {
  let url = `/api${path}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && data.detail !== undefined) detail = data.detail;
    } catch {
      // non-JSON error body: keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const listDevices = () => request("GET", "/devices");
export const getDevice = (id) => request("GET", `/devices/${id}`);
export const createDevice = (body) => request("POST", "/devices", { body });
export const updateDevice = (id, body) => request("PUT", `/devices/${id}`, { body });
export const deleteDevice = (id) => request("DELETE", `/devices/${id}`);
export const testDevice = (id) => request("POST", `/devices/${id}/test`);
export const addCheck = (deviceId, body) => request("POST", `/devices/${deviceId}/checks`, { body });
export const updateCheck = (id, body) => request("PUT", `/checks/${id}`, { body });
export const deleteCheck = (id) => request("DELETE", `/checks/${id}`);
export const getStatus = () => request("GET", "/status");
export const listEvents = (params) => request("GET", "/events", { params });
export const ackEvent = (id) => request("POST", `/events/${id}/ack`);
export const clearEvents = () => request("DELETE", "/events");
