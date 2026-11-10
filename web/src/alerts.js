const BASE_TITLE = "NetPulse";
const SOUND_KEY = "netpulse.sound";

// `wasDown`: the device went DOWN earlier in this session, so reaching UP is a recovery even
// through DEGRADED (a rebooting DC answers ping before its services are back).
export function shouldAlert(event, wasDown = false) {
  return (
    event.severity === "critical" ||
    (event.kind === "status_change" &&
      event.status === "UP" &&
      (event.previous_status === "DOWN" || wasDown))
  );
}

export function coalesceAlerts(events) {
  if (events.length === 1) return { title: events[0].message, body: "" };
  const lines = events.slice(0, 5).map((e) => e.message);
  if (events.length > 5) lines.push(`…and ${events.length - 5} more`);
  return { title: `${events.length} alerts`, body: lines.join("\n") };
}

export function readSoundSetting() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSoundSetting(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
}

export function notifyBrowser({ title, body }) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* some platforms only allow notifications via a service worker */
  }
}

let audioCtx = null;

// Creates/resumes the AudioContext. Call it from a click handler: browsers only allow audio to
// start after a user gesture, so priming here lets the first alert beep actually play.
export function primeAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

export function beep() {
  try {
    const ctx = primeAudio();
    if (!ctx) return;
    const start = ctx.currentTime;
    for (const offset of [0, 0.25]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.15);
    }
  } catch {
    /* audio may be blocked before a user gesture */
  }
}

export function setDocumentTitle(title) {
  if (typeof document !== "undefined") document.title = title;
}

export function createAlerter({
  notify = notifyBrowser,
  beep: beepFn = beep,
  setTitle = setDocumentTitle,
  windowMs = 2000,
  isHidden = () => document.hidden,
  soundOn = readSoundSetting,
} = {}) {
  let buffer = [];
  let timer = null;
  let unseen = 0;
  const wentDown = new Set(); // device ids that went DOWN and have not reached UP since

  const flush = () => {
    timer = null;
    const events = buffer;
    buffer = [];
    if (!events.length) return;
    notify(coalesceAlerts(events));
    if (soundOn()) beepFn();
  };

  return {
    push(event) {
      let wasDown = false;
      if (event.kind === "status_change" && event.device_id != null) {
        if (event.status === "DOWN") wentDown.add(event.device_id);
        else if (event.status === "UP") wasDown = wentDown.delete(event.device_id);
      }
      if (!shouldAlert(event, wasDown)) return;
      buffer.push(event);
      if (timer === null) timer = setTimeout(flush, windowMs);
      if (isHidden()) {
        unseen += 1;
        setTitle(`(${unseen}) ${event.message} – ${BASE_TITLE}`);
      }
    },
    focus() {
      clearTimeout(timer);
      timer = null;
      buffer = [];
      unseen = 0;
      setTitle(BASE_TITLE);
    },
  };
}
