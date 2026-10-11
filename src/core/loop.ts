export type TickFn = (dt: number) => void;

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * requestAnimationFrame loop, paused while the page is hidden (SPEC 10).
 * dt is raw seconds since the previous tick; the pipeline clamps it. After a
 * pause the first tick reports dt = 0 instead of the whole hidden interval.
 */
export function createLoop(tick: TickFn): Loop {
  let wanted = false;
  let handle = 0;
  let last = -1;

  const step = (now: number): void => {
    const dt = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    handle = requestAnimationFrame(step);
    tick(dt);
  };

  const resume = (): void => {
    if (handle !== 0 || !wanted || document.hidden) return;
    last = -1;
    handle = requestAnimationFrame(step);
  };

  const halt = (): void => {
    if (handle !== 0) cancelAnimationFrame(handle);
    handle = 0;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) halt();
    else resume();
  });

  return {
    start() {
      wanted = true;
      resume();
    },
    stop() {
      wanted = false;
      halt();
    },
    get running() {
      return handle !== 0;
    },
  };
}
