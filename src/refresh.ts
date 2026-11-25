type Clock = { set: (callback: () => void, delay: number) => unknown; clear: (timer: unknown) => void };

/** Poll saved state only while visible; slow requests never overlap subsequent ticks. */
export function createRefreshLoop(run: () => Promise<void>, interval: number, clock: Clock = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}) {
  let active = false;
  let stopped = false;
  let running = false;
  let timer: unknown;
  function cancelTimer() { if (timer !== undefined) clock.clear(timer); timer = undefined; }
  async function refresh() {
    if (!active || stopped || running) return;
    cancelTimer(); running = true;
    try { await run(); } catch { /* The consumer keeps cached content and reports its error. */ }
    finally {
      running = false;
      if (active && !stopped) timer = clock.set(() => { void refresh(); }, interval);
    }
  }
  return {
    setActive(value: boolean) { const resumed = value && !active; active = value; if (!value) cancelTimer(); else if (resumed) void refresh(); },
    refresh,
    stop() { stopped = true; active = false; cancelTimer(); },
  };
}
