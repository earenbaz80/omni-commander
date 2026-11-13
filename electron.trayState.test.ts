// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeTrayState } from './electron/trayState.cjs';

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

  it('cuts a label too long for a menu row without losing the entry', () => {
    const state = normalizeTrayState({ labels: { dashboard: 'd'.repeat(80) } });
    expect(state.labels.dashboard).toHaveLength(32);
    expect(state.labels.dashboard.endsWith('…')).toBe(true);
  });
});
