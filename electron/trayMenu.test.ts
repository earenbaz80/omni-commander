import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { getTranslations } from '../src/i18n/translations';
import { LanguageCode } from '../src/types';

const require = createRequire(import.meta.url);
const { trayTooltip, trayMenuTemplate } = require('./trayMenu.cjs');
const { clampText, TRAY_LABEL_LIMIT, normalizeTrayState } = require('./trayState.cjs');

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
    overwrite: 'Sobrescribir',
    skip: 'Omitir',
    rename: 'Conservar ambos',
    applyAll: 'Siempre…',
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
  applyToAll: false,
  toggleApplyToAll: vi.fn(),
});

/** The row a user reads, found by the label the snapshot carried. */
const row = (template: MenuRow[], label: string) => template.find((entry) => entry.label === label);

type MenuRow = { label?: string; enabled?: boolean; type?: string; click?: () => void; submenu?: MenuRow[] };

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

  it('answers the parked conflict from a submenu of its own', () => {
    const handlers = actions();
    const parked = state({
      waiting: {
        id: 'task_1',
        jobId: 'job_9',
        title: 'Move 5 items',
        conflict: { source: 'C:\\a.txt', destination: 'D:\\a.txt' },
      },
    });
    const answer = row(trayMenuTemplate(parked, handlers), 'Responder en el panel');

    expect(answer?.submenu?.map((entry) => entry.label ?? entry.type)).toEqual([
      // The file first: the answers below it are answers about this destination.
      'D:\\a.txt',
      'separator',
      'Sobrescribir',
      'Omitir',
      'Conservar ambos',
      'separator',
      'Siempre…',
    ]);
    expect(answer?.submenu?.[0]).toMatchObject({ label: 'D:\\a.txt', enabled: false });
    answer?.submenu?.[4].click?.();
    expect(handlers.command.mock.calls).toEqual([[{ resolve: 'rename', jobId: 'job_9', applyToAll: false }]]);
    // The row answers the conflict; it no longer needs to send anyone to the page.
    expect(handlers.openDashboard).not.toHaveBeenCalled();

    answer?.submenu?.[6].click?.();
    expect(handlers.toggleApplyToAll).toHaveBeenCalledTimes(1);

    // Once main holds the choice, the next answer carries it, and the box is drawn
    // checked instead of losing the tick on the next rebuild.
    const all = row(trayMenuTemplate(parked, { ...handlers, applyToAll: true }), 'Responder en el panel');
    expect(all?.submenu?.[6]).toMatchObject({ type: 'checkbox', checked: true });
    all?.submenu?.[3].click?.();
    expect(handlers.command.mock.calls[1][0]).toEqual({ resolve: 'skip', jobId: 'job_9', applyToAll: true });
  });

  it('keeps every label it draws inside the width of a menu row', () => {
    // A label that does not fit arrives at the tray ending in an ellipsis, which reads
    // as a broken entry. The submenu decides on a whole batch, so its words count too.
    const languages: LanguageCode[] = ['en', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ru'];
    for (const lang of languages) {
      const t = getTranslations(lang);
      for (const label of [
        t.trayAnswer,
        t.collisionOverwrite,
        t.collisionSkip,
        t.collisionRename,
        t.conflictAlwaysMode,
      ]) {
        expect(clampText(label, TRAY_LABEL_LIMIT), `${lang}: ${label}`).toBe(label);
      }
    }

    const parked = normalizeTrayState({ waiting: { id: 'task_1', jobId: 'job_9', title: 'Move 5 items' } });
    expect(row(trayMenuTemplate(parked, actions()), getTranslations('en').trayAnswer)?.enabled).toBe(true);
  });

  it('names the file the conflict is about, in the row and in the tooltip', () => {
    const parked = state({
      waiting: {
        id: 'task_1',
        jobId: 'job_9',
        title: 'Move 5 items',
        conflict: { source: 'C:\\origen\\respaldo.zip', destination: 'D:\\destino\\respaldo.zip' },
      },
    });

    // "A transfer is waiting" does not say which of its files needs an answer, and two
    // copies stop on the same name: the destination is the one being decided about.
    expect(
      row(trayMenuTemplate(parked, actions()), 'Move 5 items — Esperando tu respuesta — respaldo.zip')?.enabled,
    ).toBe(false);
    expect(trayTooltip(parked)).toBe(
      'OmniCommander Pro · Move 5 items — Esperando tu respuesta — D:\\destino\\respaldo.zip',
    );
  });

  it('falls back to the source when the snapshot carried no destination', () => {
    const parked = state({
      waiting: {
        id: 'task_1',
        jobId: 'job_9',
        title: 'Move 5 items',
        conflict: { source: 'C:\\origen\\respaldo.zip', destination: '' },
      },
    });

    expect(trayTooltip(parked)).toBe(
      'OmniCommander Pro · Move 5 items — Esperando tu respuesta — C:\\origen\\respaldo.zip',
    );
    expect(row(trayMenuTemplate(parked, actions()), 'Responder en el panel')?.submenu?.[0].label).toBe(
      'C:\\origen\\respaldo.zip',
    );
  });

  it('leaves the answer row disabled when there is nothing parked to answer', () => {
    expect(row(trayMenuTemplate(state(), actions()), 'Responder en el panel')?.enabled).toBe(false);
    // A waiting transfer without the details answers nothing; the dashboard row below
    // is what still leads to its page.
    const noConflict = trayMenuTemplate(
      state({ waiting: { id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null } }),
      actions(),
    );
    expect(row(noConflict, 'Responder en el panel')?.enabled).toBe(false);
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
