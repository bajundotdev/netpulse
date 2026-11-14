// Wraps an async function so only one run is in flight. Calls made during a run share a single
// trailing run that starts when it finishes, so a late caller still gets fresh data and two
// overlapping snapshot loads can never land out of order.
export function singleFlight<T>(fn: () => Promise<T> | T): () => Promise<T> {
  let running: Promise<T> | null = null;
  let trailing: Promise<T> | null = null;

  const start = (): Promise<T> => {
    running = (async () => fn())().finally(() => {
      running = null;
    });
    return running;
  };

  return function call(): Promise<T> {
    if (!running) return start();
    trailing ??= running
      .catch(() => {})
      .then(() => {
        trailing = null;
        return call();
      });
    return trailing;
  };
}
