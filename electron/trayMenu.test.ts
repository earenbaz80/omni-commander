import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trayTooltip, trayMenuTemplate } = require('./trayMenu.cjs');

type State = {
  hasLiveWork: boolean;
  activeCount: number;
  task: { id: string; title: string; status: string; progress: number } | null;
  labels: Record<string, string>;
};

const state = (overrides: Partial<State> = {}): State => ({
  hasLiveWork: true,
  activeCount: 1,
  task: { id: 'job_1', title: 'Copy 2 items', status: 'running', progress: 40 },
  labels: {
    resume: 'Reanudar',
    pause: 'Pausar',
    cancel: 'Cancelar',
    dashboard: 'Abrir panel de transferencias',
    waiting: 'Esperando tu respuesta',
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
    const waiting = state({ task: { ...state().task!, status: 'waiting', progress: 0 } });
    expect(trayTooltip(waiting)).toBe('OmniCommander Pro · Copy 2 items — Esperando tu respuesta');

    const template = trayMenuTemplate(waiting, actions());
    expect(row(template, 'Copy 2 items — Esperando tu respuesta')?.enabled).toBe(false);
    expect(row(template, 'Cancelar')?.enabled).toBe(true);
    expect(row(template, 'Pausar')?.enabled).toBe(false);
    expect(row(template, 'Reanudar')?.enabled).toBe(false);
  });

  it('leaves a transfer with nothing to say without controls', () => {
    const idle = trayMenuTemplate(state({ task: null, hasLiveWork: false, activeCount: 0 }), actions());
    expect(row(idle, '—')).toBeTruthy();
    expect(row(idle, 'Reanudar')?.enabled).toBe(false);
    expect(row(idle, 'Pausar')?.enabled).toBe(false);
    expect(row(idle, 'Cancelar')?.enabled).toBe(false);
    expect(trayTooltip(state({ task: null }))).toBe('OmniCommander Pro');
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
