import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trayTooltip, trayMenuTemplate } = require('./trayMenu.cjs');

type State = {
  hasLiveWork: boolean;
  activeCount: number;
  canRepeat: boolean;
  waiting: {
    id: string;
    jobId: string;
    title: string;
    conflict: { source: string; destination: string } | null;
  } | null;
  task: { id: string; title: string; status: string; progress: number } | null;
  labels: Record<string, string>;
};

const state = (overrides: Partial<State> = {}): State => ({
  hasLiveWork: true,
  activeCount: 1,
  canRepeat: false,
  waiting: null,
  task: { id: 'job_1', title: 'Copy 2 items', status: 'running', progress: 40 },
  labels: {
    resume: 'Reanudar',
    pause: 'Pausar',
    cancel: 'Cancelar',
    dashboard: 'Abrir panel de transferencias',
    waiting: 'Esperando tu respuesta',
    answer: 'Responder en el panel',
    repeat: 'Repetir el último cancelado',
    quit: 'Salir',
  },
  ...overrides,
});

const actions = () => ({
  showWindow: vi.fn(),
  command: vi.fn(),
  openDashboard: vi.fn(),
  quit: vi.fn(),
  dashboardReady: true,
});

/** The row a user reads, found by the label the snapshot carried. */
const row = (template: MenuRow[], label: string) => template.find((entry) => entry.label === label);

type MenuRow = { label?: string; enabled?: boolean; click?: () => void };

describe('the tray menu', () => {
  it('offers pause for what is running and resume for what is paused, never both', () => {
    const running = trayMenuTemplate(state(), actions());
    expect(row(running, 'Pausar')?.enabled).toBe(true);
    expect(row(running, 'Reanudar')?.enabled).toBe(false);

    const paused = trayMenuTemplate(state({ task: { ...state().task!, status: 'paused' } }), actions());
    expect(row(paused, 'Reanudar')?.enabled).toBe(true);
    expect(row(paused, 'Pausar')?.enabled).toBe(false);
  });

  it('says a transfer is waiting for an answer, and still lets it be cancelled', () => {
    const waiting = state({
      task: { ...state().task!, status: 'waiting', progress: 0 },
      waiting: { id: 'job_1', jobId: 'job_1', title: 'Copy 2 items', conflict: null },
    });
    expect(trayTooltip(waiting)).toBe('OmniCommander Pro · Copy 2 items — Esperando tu respuesta');

    const template = trayMenuTemplate(waiting, actions());
    expect(row(template, 'Copy 2 items — Esperando tu respuesta')?.enabled).toBe(false);
    expect(row(template, 'Cancelar')?.enabled).toBe(true);
    expect(row(template, 'Pausar')?.enabled).toBe(false);
    expect(row(template, 'Reanudar')?.enabled).toBe(false);
  });

  it('names the transfer waiting on an answer even when the controls are elsewhere', () => {
    // The selected transfer is what Pause and Cancel act on; the parked one is what
    // the user has to do something about, so it is the one the title names.
    const parked = state({ waiting: { id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null } });

    expect(trayTooltip(parked)).toBe('OmniCommander Pro · Move 5 items — Esperando tu respuesta');
    const template = trayMenuTemplate(parked, actions());
    expect(row(template, 'Move 5 items — Esperando tu respuesta')?.enabled).toBe(false);
    expect(row(template, 'Pausar')?.enabled).toBe(true);
  });

  it('opens the dashboard on the waiting row, and only when one is waiting', () => {
    const handlers = actions();
    const template = trayMenuTemplate(
      state({ waiting: { id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null } }),
      handlers,
    );

    expect(row(template, 'Responder en el panel')?.enabled).toBe(true);
    row(template, 'Responder en el panel')?.click?.();
    expect(handlers.openDashboard.mock.calls).toEqual([['job_2']]);

    expect(row(trayMenuTemplate(state(), actions()), 'Responder en el panel')?.enabled).toBe(false);
    const noPage = trayMenuTemplate(
      state({ waiting: { id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null } }),
      {
        ...actions(),
        dashboardReady: false,
      },
    );
    expect(row(noPage, 'Responder en el panel')?.enabled).toBe(false);
  });

  it('leaves a transfer with nothing to say without controls', () => {
    const idle = trayMenuTemplate(state({ task: null, hasLiveWork: false, activeCount: 0 }), actions());
    expect(row(idle, '—')).toBeTruthy();
    expect(row(idle, 'Reanudar')?.enabled).toBe(false);
    expect(row(idle, 'Pausar')?.enabled).toBe(false);
    expect(row(idle, 'Cancelar')?.enabled).toBe(false);
    expect(trayTooltip(state({ task: null }))).toBe('OmniCommander Pro');
  });

  it('offers a repeat only when a stopped transfer left a plan', () => {
    const handlers = actions();
    const offered = trayMenuTemplate(state({ canRepeat: true }), handlers);
    row(offered, 'Repetir el último cancelado')?.click?.();
    expect(handlers.command.mock.calls).toEqual([['repeat']]);

    const idle = trayMenuTemplate(state(), actions());
    expect(row(idle, 'Repetir el último cancelado')?.enabled).toBe(false);
  });

  it('counts the transfers that are in flight in the header', () => {
    const template = trayMenuTemplate(state({ activeCount: 3 }), actions());
    expect(template[0].label).toBe('OmniCommander Pro (3)');
  });

  it('hands each row to the action it names', () => {
    const handlers = actions();
    const template = trayMenuTemplate(state({ task: { ...state().task!, status: 'paused' } }), handlers);
    template[0].click();
    row(template, 'Reanudar')?.click?.();
    row(template, 'Cancelar')?.click?.();
    row(template, 'Abrir panel de transferencias')?.click?.();
    row(template, 'Salir')?.click?.();
    expect(handlers.showWindow).toHaveBeenCalledTimes(1);
    expect(handlers.command.mock.calls).toEqual([['resume'], ['cancel']]);
    expect(handlers.openDashboard).toHaveBeenCalledTimes(1);
    expect(handlers.quit).toHaveBeenCalledTimes(1);
  });

  it('disables the dashboard row when no page can be addressed', () => {
    const template = trayMenuTemplate(state(), { ...actions(), dashboardReady: false });
    expect(row(template, 'Abrir panel de transferencias')?.enabled).toBe(false);
  });
});
