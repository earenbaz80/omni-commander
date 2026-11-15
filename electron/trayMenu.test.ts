import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { getTranslations } from '../src/i18n/translations';
import { LanguageCode } from '../src/types';

const require = createRequire(import.meta.url);
const { trayTooltip, trayMenuTemplate } = require('./trayMenu.cjs');
const { clampText, TRAY_LABEL_LIMIT, normalizeTrayState } = require('./trayState.cjs');

/** A transfer the engine is holding open for an answer. */
type Park = {
  id: string;
  jobId: string;
  title: string;
  conflict: { source: string; destination: string; expiresInMs?: number } | null;
};

type State = {
  hasLiveWork: boolean;
  activeCount: number;
  canRepeat: boolean;
  waiting: Park[];
  task: {
    id: string;
    title: string;
    status: string;
    progress: number;
    speed?: string;
    etaSeconds?: number;
  } | null;
  labels: Record<string, string>;
};

const state = (overrides: Partial<State> = {}): State => ({
  hasLiveWork: true,
  activeCount: 1,
  canRepeat: false,
  waiting: [],
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

// main keeps apply-to-all per job, so the stand-in does too.
const actions = () => {
  const all = new Set<string>();
  return {
    showWindow: vi.fn(),
    command: vi.fn(),
    openDashboard: vi.fn(),
    quit: vi.fn(),
    dashboardReady: true,
    applyToAll: (jobId: string) => all.has(jobId),
    toggleApplyToAll: (jobId: string) => {
      if (!all.delete(jobId)) all.add(jobId);
    },
  };
};

/** The row a user reads, found by the label the snapshot carried. */
const row = (template: MenuRow[], label: string) => template.find((entry) => entry.label === label);

type MenuRow = {
  id?: string;
  label?: string;
  enabled?: boolean;
  type?: string;
  checked?: boolean;
  click?: () => void;
  submenu?: MenuRow[];
};

/** The answer row for a job, found by the id the menu gives it. */
const byId = (template: MenuRow[], id: string) => template.find((entry) => entry.id === id);

/** A parked transfer as the snapshot carries it. */
const park = (jobId: string, destination: string, expiresInMs?: number): Park => ({
  id: `task_${jobId}`,
  jobId,
  title: 'Copy 2 items',
  conflict: { source: 'C:\\a.txt', destination, expiresInMs },
});

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
      waiting: [{ id: 'job_1', jobId: 'job_1', title: 'Copy 2 items', conflict: null }],
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
    const parked = state({ waiting: [{ id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null }] });

    expect(trayTooltip(parked)).toBe('OmniCommander Pro · Move 5 items — Esperando tu respuesta');
    const template = trayMenuTemplate(parked, actions());
    expect(row(template, 'Move 5 items — Esperando tu respuesta')?.enabled).toBe(false);
    expect(row(template, 'Pausar')?.enabled).toBe(true);
  });

  it('answers the parked conflict from a submenu of its own', () => {
    const handlers = actions();
    const parked = state({
      waiting: [
        {
          id: 'task_1',
          jobId: 'job_9',
          title: 'Move 5 items',
          conflict: { source: 'C:\\a.txt', destination: 'D:\\a.txt', expiresInMs: 4 * 60 * 1000 },
        },
      ],
    });
    const answer = byId(trayMenuTemplate(parked, handlers), 'answer:job_9');

    expect(answer?.submenu?.map((entry) => entry.label ?? entry.type)).toEqual([
      // The file first, with the wait it has left: the answers below are about this
      // destination, and the deadline is what makes them urgent.
      'D:\\a.txt · 4:00',
      'separator',
      'Sobrescribir',
      'Omitir',
      'Conservar ambos',
      'separator',
      'Siempre…',
      'separator',
      'Cancelar',
    ]);
    expect(answer?.submenu?.[0]).toMatchObject({ label: 'D:\\a.txt · 4:00', enabled: false });
    answer?.submenu?.[4].click?.();
    expect(handlers.command.mock.calls).toEqual([[{ resolve: 'rename', jobId: 'job_9', applyToAll: false }]]);

    answer?.submenu?.[6].click?.();

    // main holds the choice, so the next rebuild draws the box checked instead of
    // losing the tick with the item.
    const all = byId(trayMenuTemplate(parked, handlers), 'answer:job_9');
    expect(all?.submenu?.[6]).toMatchObject({ type: 'checkbox', checked: true });
    all?.submenu?.[3].click?.();
    expect(handlers.command.mock.calls[1][0]).toEqual({ resolve: 'skip', jobId: 'job_9', applyToAll: true });

    // Stopping is an answer too: the engine cancels the whole job.
    all?.submenu?.[8].click?.();
    expect(handlers.command.mock.calls[2][0]).toEqual({ resolve: 'cancel', jobId: 'job_9', applyToAll: false });
  });

  it('keeps every label it draws inside the width of a menu row', () => {
    // A label that does not fit arrives at the tray ending in an ellipsis, which reads
    // as a broken entry. The submenu decides on a whole batch, so its words count too.
    const languages: LanguageCode[] = ['en', 'es', 'de', 'fr', 'it', 'pt', 'ru'];
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

    const parked = normalizeTrayState({
      waiting: [
        {
          id: 'task_1',
          jobId: 'job_9',
          title: 'Move 5 items',
          conflict: { source: 'C:\\a.txt', destination: 'D:\\a.txt' },
        },
      ],
    });
    expect(byId(trayMenuTemplate(parked, actions()), 'answer:job_9')?.enabled).toBe(true);
  });

  it('names the file the conflict is about, in the row and in the tooltip', () => {
    const parked = state({
      waiting: [
        {
          id: 'task_1',
          jobId: 'job_9',
          title: 'Move 5 items',
          conflict: {
            source: 'C:\\origen\\respaldo.zip',
            destination: 'D:\\destino\\respaldo.zip',
            expiresInMs: 4 * 60 * 1000,
          },
        },
      ],
    });

    // "A transfer is waiting" does not say which of its files needs an answer, and two
    // copies stop on the same name: the destination is the one being decided about.
    expect(
      row(trayMenuTemplate(parked, actions()), 'Move 5 items — Esperando tu respuesta — respaldo.zip')?.enabled,
    ).toBe(false);
    // The tooltip has room for the wait left, which is what makes the stop urgent.
    expect(trayTooltip(parked)).toBe(
      'OmniCommander Pro · Move 5 items — Esperando tu respuesta · 4:00 · D:\\destino\\respaldo.zip',
    );
  });

  it('keeps the clock inside the 120 characters when the path is long', () => {
    // A stop deep in a user profile used to end the line before the deadline: the
    // tooltip named the file and said nothing about the wait that was running out.
    const parked = state({
      waiting: [
        {
          id: 'task_1',
          jobId: 'job_9',
          title: 'Copiar 1 elemento(s)',
          conflict: {
            source: 'C:\\Users\\edel\\Documents\\respaldo\\nota.txt',
            destination: 'C:\\Users\\edel\\Documents\\Proyectos AI\\omni-commander\\nota.txt',
            expiresInMs: 4 * 60 * 1000,
          },
        },
      ],
    });

    const tooltip = trayTooltip(parked);
    expect(tooltip).toHaveLength(120);
    // The clock keeps its room whatever the path is.
    expect(tooltip).toContain('· 4:00 · ');
    expect(tooltip.indexOf('4:00')).toBeLessThan(tooltip.indexOf('C:\\Users'));
    // What gives is the middle of the path: the drive still leads and the file name
    // still closes the line, which is how the file is recognised.
    expect(
      tooltip.startsWith('OmniCommander Pro · Copiar 1 elemento(s) — Esperando tu respuesta · 4:00 · C:\\Users'),
    ).toBe(true);
    expect(tooltip).toContain('…');
    expect(tooltip.endsWith('nota.txt')).toBe(true);
  });

  it('falls back to the source when the snapshot carried no destination', () => {
    const parked = state({
      waiting: [
        {
          id: 'task_1',
          jobId: 'job_9',
          title: 'Move 5 items',
          conflict: { source: 'C:\\origen\\respaldo.zip', destination: '' },
        },
      ],
    });

    expect(trayTooltip(parked)).toBe(
      'OmniCommander Pro · Move 5 items — Esperando tu respuesta · C:\\origen\\respaldo.zip',
    );
    expect(byId(trayMenuTemplate(parked, actions()), 'answer:job_9')?.submenu?.[0].label).toBe(
      'C:\\origen\\respaldo.zip',
    );
  });

  it('says how fast a live transfer goes, and when it will end', () => {
    const running = state({
      task: { id: 'job_1', title: 'Copy 2 items', status: 'running', progress: 40, speed: '12.5 MB/s', etaSeconds: 95 },
    });

    // With the window minimized the tooltip is the only place this is visible.
    expect(trayTooltip(running)).toBe('OmniCommander Pro · Copy 2 items — 40% · 12.5 MB/s · 1:35');
  });

  it('leaves the answer row disabled when there is nothing parked to answer', () => {
    expect(row(trayMenuTemplate(state(), actions()), 'Responder en el panel')?.enabled).toBe(false);
    // A waiting transfer without the details answers nothing; the dashboard row below
    // is what still leads to its page.
    const noConflict = trayMenuTemplate(
      state({ waiting: [{ id: 'job_2', jobId: 'job_9', title: 'Move 5 items', conflict: null }] }),
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

  it('offers a row per parked transfer, each answering its own job', () => {
    const handlers = actions();
    const parked = state({ waiting: [park('job_b', 'E:\\b.txt', 120_000), park('job_a', 'D:\\a.txt', 269_000)] });
    const template = trayMenuTemplate(parked, handlers);

    // One row per park, naming the file it stops on and its own wait: a single row
    // answered whichever park the menu was built for and left the other timing out.
    expect(byId(template, 'answer:job_b')?.label).toBe('Responder en el panel — b.txt · 2:00');
    expect(byId(template, 'answer:job_a')?.label).toBe('Responder en el panel — a.txt · 4:29');

    byId(template, 'answer:job_b')?.submenu?.[3].click?.();
    byId(template, 'answer:job_a')?.submenu?.[4].click?.();
    expect(handlers.command.mock.calls).toEqual([
      [{ resolve: 'skip', jobId: 'job_b', applyToAll: false }],
      [{ resolve: 'rename', jobId: 'job_a', applyToAll: false }],
    ]);
  });

  it('ticks apply-to-all on the transfer it was set on and no other', () => {
    const handlers = actions();
    const parked = state({ waiting: [park('job_b', 'E:\\b.txt', 120_000), park('job_a', 'D:\\a.txt', 269_000)] });

    byId(trayMenuTemplate(parked, handlers), 'answer:job_b')?.submenu?.[6].click?.();

    const after = trayMenuTemplate(parked, handlers);
    expect(byId(after, 'answer:job_b')?.submenu?.[6]).toMatchObject({ type: 'checkbox', checked: true });
    expect(byId(after, 'answer:job_a')?.submenu?.[6]).toMatchObject({ type: 'checkbox', checked: false });

    // The other park still answers one file at a time, even though the checkbox of
    // the one above the row is ticked.
    byId(after, 'answer:job_a')?.submenu?.[2].click?.();
    expect(handlers.command.mock.calls).toEqual([[{ resolve: 'overwrite', jobId: 'job_a', applyToAll: false }]]);
  });
});
