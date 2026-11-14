// @vitest-environment node
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createJobToasts } = require('./jobToasts.cjs') as {
  createJobToasts: (deps: Record<string, unknown>) => {
    finished: (job: Job) => void;
    waiting: (job: Job) => void;
  };
};

interface Job {
  id: string;
  status: string;
  label?: string;
  startedAt?: number;
  endedAt?: number;
  copiedBytes?: number;
  totalBytes?: number;
  pendingConflict?: { destination?: string; expiresInMs?: number } | null;
}

class FakeNotification {
  static instances: FakeNotification[] = [];
  static supported = true;
  static isSupported() {
    return FakeNotification.supported;
  }

  body: string;
  clicked?: () => void;
  shown = 0;

  constructor(options: { title: string; body: string }) {
    this.body = options.body;
    FakeNotification.instances.push(this);
  }

  on(event: string, callback: () => void) {
    if (event === 'click') this.clicked = callback;
  }

  show() {
    this.shown += 1;
  }
}

const parked = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  status: 'running',
  label: 'respaldo',
  pendingConflict: { destination: 'D:\\respaldo\\foto.jpg', expiresInMs: 4 * 60 * 1000 },
  ...overrides,
});

const done: Job = {
  id: 'job-1',
  status: 'done',
  label: 'respaldo',
  startedAt: Date.now() - 60 * 1000,
  endedAt: Date.now(),
  copiedBytes: 2048,
  totalBytes: 2048,
};

function harness(overrides: Record<string, unknown> = {}) {
  FakeNotification.instances = [];
  FakeNotification.supported = true;
  const timers: Array<{ delay: number; fire: () => void }> = [];
  const cancelled: number[] = [];
  const openDashboard = vi.fn();
  let nextTimer = 0;

  const toasts = createJobToasts({
    Notification: FakeNotification,
    isSupported: () => FakeNotification.isSupported(),
    inFront: () => false,
    openDashboard,
    schedule: (fire: () => void, delay: number) => {
      timers.push({ delay, fire });
      return (nextTimer += 1);
    },
    cancel: (timer: number) => cancelled.push(timer),
    ...overrides,
  });

  return { cancelled, openDashboard, timers, toasts };
}

beforeEach(() => {
  FakeNotification.instances = [];
  FakeNotification.supported = true;
});

describe('the toast for a parked transfer', () => {
  it('announces it once, naming the file and the time left', () => {
    const { toasts, timers } = harness();

    toasts.waiting(parked());
    toasts.waiting(parked());

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].body).toBe('⏸ D:\\respaldo\\foto.jpg · 4:00');
    // The wait is bounded, so the first nudge schedules the last one a minute before.
    expect(timers.map((timer) => timer.delay)).toEqual([4 * 60 * 1000 - 60 * 1000]);
  });

  it('stays quiet while the window already has the user', () => {
    const { toasts, timers } = harness({ inFront: () => true });

    toasts.waiting(parked());

    expect(FakeNotification.instances).toEqual([]);
    expect(timers).toEqual([]);
  });

  it('says how long is left when it comes back before the deadline', () => {
    const { toasts, timers } = harness();

    toasts.waiting(parked());
    timers[0].fire();

    expect(FakeNotification.instances.map((toast) => toast.body)).toEqual([
      '⏸ D:\\respaldo\\foto.jpg · 4:00',
      '⏸ D:\\respaldo\\foto.jpg · 1:00',
    ]);
  });

  it('does not nudge again once the transfer has ended', () => {
    const { toasts, timers, cancelled } = harness();

    toasts.waiting(parked());
    toasts.finished(done);
    timers[0]?.fire();

    expect(cancelled).toHaveLength(1);
    // Only the outcome of the transfer is left to say.
    expect(FakeNotification.instances).toHaveLength(2);
    expect(FakeNotification.instances[1].body).not.toContain('⏸');
  });

  it('does not wait to nudge a conflict that has under a minute left', () => {
    const { toasts, timers } = harness();

    toasts.waiting(parked({ pendingConflict: { destination: 'D:\\a.txt', expiresInMs: 30 * 1000 } }));

    expect(timers).toEqual([]);
  });

  it('opens the dashboard on the job it announced', () => {
    const { toasts, openDashboard } = harness();

    toasts.waiting(parked());
    FakeNotification.instances[0].clicked?.();

    expect(openDashboard).toHaveBeenCalledWith('job-1');
  });
});
