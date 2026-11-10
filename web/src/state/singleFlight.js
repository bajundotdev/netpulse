// Wraps an async function so only one run is in flight. Calls made during a run share a single
// trailing run that starts when it finishes, so a late caller still gets fresh data and two
// overlapping snapshot loads can never land out of order.
export function singleFlight(fn) {
  let running = null;
  let trailing = null;

  const start = () => {
    running = (async () => fn())().finally(() => {
      running = null;
    });
    return running;
  };

  return function call() {
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
