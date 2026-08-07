export interface SchedulerTimers {
  set(callback: () => void, delay: number): number;
  clear(id: number): void;
}

export function createActivityScheduler(
  refresh: (write?: boolean, force?: boolean) => void | Promise<void>,
  timers: SchedulerTimers = {
    set: (callback, delay) => window.setTimeout(callback, delay),
    clear: id => window.clearTimeout(id),
  },
) {
  let selectionTimer = 0;
  let writeTimer = 0;
  let writePending = false;

  const beforeInput = () => {
    writePending = true;
    timers.clear(selectionTimer);
  };

  const input = () => {
    beforeInput();
    timers.clear(writeTimer);
    writeTimer = timers.set(() => {
      void Promise.resolve(refresh(true)).finally(() => { writePending = false; });
    }, 600);
  };

  const selection = () => {
    if (writePending) return;
    timers.clear(selectionTimer);
    selectionTimer = timers.set(() => { void refresh(); }, 150);
  };

  const save = () => {
    timers.clear(selectionTimer);
    timers.clear(writeTimer);
    writePending = false;
    void refresh(true, true);
  };

  const dispose = () => {
    timers.clear(selectionTimer);
    timers.clear(writeTimer);
  };

  return { beforeInput, input, selection, save, dispose };
}
