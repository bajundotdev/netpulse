const defaultStorage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

export function readPref<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
  storage: Pick<Storage, "getItem"> | undefined = defaultStorage(),
): T {
  try {
    const value = storage?.getItem(key);
    if (value == null) return fallback;
    if (!allowed) return value as T;
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(
  key: string,
   value: string,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
