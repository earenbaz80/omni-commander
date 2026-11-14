// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeTrayState, TRAY_TITLE_LIMIT } from './electron/trayState.cjs';

/**
 * The tray entry that opens the dashboard is labelled by the renderer, which
 * translates it. Everything the renderer sends is rebuilt here field by field, so
 * a label added on that side survives only if this side copies it -- the menu row
 * it lands on is the one control that leaves the app for a browser.
 */
describe('the state the tray mirrors', () => {
  it('keeps the dashboard label the renderer sent', () => {
    const state = normalizeTrayState({ labels: { dashboard: 'Abrir panel de transferencias' } });
    expect(state.labels.dashboard).toBe('Abrir panel de transferencias');
  });

  it('writes the entry in English when no label arrived', () => {
    expect(normalizeTrayState({}).labels.dashboard).toBe('Open transfer dashboard');
    expect(normalizeTrayState({ labels: { dashboard: 42 } }).labels.dashboard).toBe('Open transfer dashboard');
  });

  it('keeps a transfer the engine parked on a conflict', () => {
    // `waiting` is live work: dropping it from the snapshot made a transfer that
    // needed an answer vanish from the tray.
    const state = normalizeTrayState({
      task: { id: 'job_1', title: 'Copy 2 items', status: 'waiting', progress: 0 },
      labels: { waiting: 'Esperando tu respuesta' },
    });
    expect(state.task?.status).toBe('waiting');
    expect(state.hasLiveWork).toBe(true);
    expect(state.labels.waiting).toBe('Esperando tu respuesta');
    expect(normalizeTrayState({}).labels.waiting).toBe('Waiting for your answer');
  });

  it('keeps the job waiting on an answer apart from the selected one', () => {
    // The selected transfer is what the tray's controls act on, and it is not always
    // the parked one: the title and the answer row have to name the parked one, with
    // the conflict it is parked on and the job the answer has to reach.
    const state = normalizeTrayState({
      task: { id: 'job_1', title: 'Copy 2 items', status: 'running', progress: 40 },
      waiting: {
        id: 'task_2',
        jobId: 'job_9',
        title: 'Move 5 items',
        conflict: { source: 'C:\\a.txt', destination: 'D:\\a.txt' },
      },
      labels: { overwrite: 'Sobrescribir', applyAll: 'Aplicar a todos' },
    });

    expect(state.task?.id).toBe('job_1');
    expect(state.waiting).toEqual({
      id: 'task_2',
      jobId: 'job_9',
      title: 'Move 5 items',
      // No deadline in the payload: the menu then shows no clock rather than a zero.
      conflict: { source: 'C:\\a.txt', destination: 'D:\\a.txt', expiresInMs: 0 },
    });
    expect(state.labels.overwrite).toBe('Sobrescribir');
    expect(state.labels.applyAll).toBe('Aplicar a todos');
  });

  it('drops a waiting entry it cannot address, and names a nameless one', () => {
    expect(normalizeTrayState({ waiting: { title: 'Move 5 items' } }).waiting).toBeNull();
    expect(normalizeTrayState({ waiting: { id: 'job_2' } }).waiting).toEqual({
      id: 'job_2',
      jobId: '',
      title: 'Transfer',
      conflict: null,
    });
    expect(normalizeTrayState({}).waiting).toBeNull();
    // No conflict means nothing to answer, and the menu disables the row for it.
    expect(normalizeTrayState({ waiting: { id: 'task_1', jobId: 'job_9' } }).waiting?.conflict).toBeNull();
    expect(normalizeTrayState({}).labels.answer).toBe('Answer the conflict');
    expect(normalizeTrayState({}).labels.overwrite).toBe('Overwrite');
  });

  it('keeps the wait left on a conflict, so the menu can count it down', () => {
    const state = normalizeTrayState({
      waiting: {
        id: 'task_1',
        jobId: 'job_9',
        conflict: { source: 'C:\a.txt', destination: 'D:\a.txt', expiresInMs: 239_900 },
      },
    });

    expect(state.waiting?.conflict?.expiresInMs).toBe(239_900);
  });
  it('keeps both sides of a conflict, inside the width a menu row has', () => {
    // The menu names the file the conflict is about, so the path has to survive this
    // side in one piece -- long enough to tell two folders apart, short enough that the
    // tray still draws the entry.
    const long = `D:\\${'carpeta\\'.repeat(20)}archivo.txt`;
    const state = normalizeTrayState({
      waiting: { id: 'task_1', jobId: 'job_9', conflict: { source: 'C:\\a.txt', destination: long } },
    });

    expect(state.waiting?.conflict?.source).toBe('C:\\a.txt');
    expect(state.waiting?.conflict?.destination).toHaveLength(TRAY_TITLE_LIMIT);
    expect(state.waiting?.conflict?.destination.startsWith('D:\\carpeta\\')).toBe(true);
  });

  it('offers the repeat row only for an explicit true', () => {
    // The renderer decides; this side must not turn a truthy string into a row that
    // repeats a transfer nobody stopped.
    expect(normalizeTrayState({ canRepeat: true }).canRepeat).toBe(true);
    expect(normalizeTrayState({ canRepeat: 'yes' }).canRepeat).toBe(false);
    expect(normalizeTrayState({}).canRepeat).toBe(false);
    expect(normalizeTrayState({}).labels.repeat).toBe('Repeat last cancelled or failed');
  });

  it('cuts a label too long for a menu row without losing the entry', () => {
    const state = normalizeTrayState({ labels: { dashboard: 'd'.repeat(80) } });
    expect(state.labels.dashboard).toHaveLength(32);
    expect(state.labels.dashboard.endsWith('…')).toBe(true);
  });
});
