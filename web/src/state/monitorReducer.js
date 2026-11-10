const MAX_EVENTS = 500;
const MAX_LATENCY = 60;

export const initialState = { devices: {}, order: [], events: [], connected: false, loadError: null };

function patchDevice(state, id, patch) {
  const device = state.devices[id];
  if (!device) return state;
  return { ...state, devices: { ...state.devices, [id]: { ...device, ...patch } } };
}

function snapshot(state, { devices, statuses, events }) {
  const live = new Map(statuses.map((s) => [s.device_id, s]));
  const byId = {};
  for (const cfg of devices) {
    const s = live.get(cfg.id);
    byId[cfg.id] = {
      ...cfg,
      status: s ? s.status : "UNKNOWN",
      since: s ? s.since : null,
      consecutive_failures: s ? s.consecutive_failures : 0,
      results: s ? s.results : [],
      latency: s ? s.latency : [],
    };
  }
  return {
    ...state,
    devices: byId,
    order: devices.map((d) => d.id),
    events: events.slice(0, MAX_EVENTS),
    loadError: null,
  };
}

export function monitorReducer(state, action) {
  switch (action.type) {
    case "SNAPSHOT":
      return snapshot(state, action);
    case "STATUS": {
      const p = action.payload;
      return patchDevice(state, p.device_id, {
        status: p.status,
        since: p.since,
        consecutive_failures: p.consecutive_failures,
      });
    }
    case "RESULT": {
      const p = action.payload;
      const device = state.devices[p.device_id];
      if (!device) return state;
      const latency = [...device.latency, p.latency_ms ?? null].slice(-MAX_LATENCY);
      return patchDevice(state, p.device_id, { results: p.results, latency });
    }
    case "EVENT": {
      if (state.events.some((e) => e.id === action.event.id)) return state;
      return { ...state, events: [action.event, ...state.events].slice(0, MAX_EVENTS) };
    }
    case "LOAD_FAILED":
      return { ...state, loadError: action.message };
    case "CONNECTED":
      return { ...state, connected: true };
    case "DISCONNECTED":
      return { ...state, connected: false };
    case "DEVICE_REMOVED": {
      if (!state.devices[action.id]) return state;
      const { [action.id]: _removed, ...rest } = state.devices;
      return { ...state, devices: rest, order: state.order.filter((id) => id !== action.id) };
    }
    case "EVENT_ACKED":
      return {
        ...state,
        events: state.events.map((e) => (e.id === action.id ? { ...e, acknowledged: true } : e)),
      };
    case "EVENTS_CLEARED":
      return { ...state, events: [] };
    default:
      return state;
  }
}
