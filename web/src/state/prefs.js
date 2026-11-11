const defaultStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);

export function readPref(key, fallback, allowed, storage = defaultStorage()) {
  try {
    const value = storage?.getItem(key);
    if (value == null) return fallback;
    return !allowed || allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key, value, storage = defaultStorage()) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
