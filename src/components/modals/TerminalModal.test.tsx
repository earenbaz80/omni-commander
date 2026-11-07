import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminalModal } from './TerminalModal';
import { ThemeConfig } from '../../services/themeManager';
import { CommandHistoryItem, LanguageCode } from '../../types';
import { getTranslations } from '../../i18n/translations';

const theme = {
  overlay: '#00000088',
  modalBg: '#000000',
  modalBorder: '#334433',
  modalHeaderBg: '#0a1a0a',
  modalHeaderText: '#88ff88',
  promptBg: '#020402',
  promptText: '#33ff66',
  itemText: '#cccccc',
  isRetro: true,
} as ThemeConfig;

const t = getTranslations('es');

function open(overrides: Partial<React.ComponentProps<typeof TerminalModal>> = {}) {
  const props = {
    theme,
    lang: 'es' as LanguageCode,
    currentPath: 'C:\\Windows',
    commandHistory: [] as CommandHistoryItem[],
    onExecuteCommand: vi.fn(),
    onClearHistory: vi.fn(),
    isAdminMode: false,
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TerminalModal {...props} />);
  return props;
}

const prompt = () => screen.getByLabelText(t.cmdPlaceholder) as HTMLInputElement;

describe('TerminalModal', () => {
  it('explains the shell before anything has run', () => {
    open();
    expect(screen.getByText(t.terminalHint)).toBeTruthy();
  });

  it('runs what is typed with Enter, as the screen has no button', () => {
    const props = open();
    fireEvent.change(prompt(), { target: { value: 'dir' } });
    fireEvent.keyDown(prompt(), { key: 'Enter' });

    expect(props.onExecuteCommand).toHaveBeenCalledWith('dir');
    expect(prompt().value).toBe('');
  });

  it('does not send an empty line to the shell', () => {
    const props = open();
    fireEvent.change(prompt(), { target: { value: '   ' } });
    fireEvent.keyDown(prompt(), { key: 'Enter' });
    expect(props.onExecuteCommand).not.toHaveBeenCalled();
  });

  it('types on the screen itself instead of in a field below it', () => {
    open();
    // The prompt belongs to the scrollback and Enter is the only way to send a
    // line; a visible input row with its own button is what this replaced.
    expect(prompt().closest('[data-terminal-log]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(t.runCommand) })).toBeNull();
  });

  it('prints the command and its output, with errors apart', () => {
    open({
      commandHistory: [
        { id: 'a', timestamp: '10:00:00', command: 'dir', output: 'uno.txt', status: 'ok' },
        { id: 'b', timestamp: '10:00:01', command: 'type nope', output: 'no existe', status: 'error' },
      ],
    });

    expect(screen.getByText('dir')).toBeTruthy();
    expect(screen.getByText('uno.txt')).toBeTruthy();
    expect(screen.getByText('no existe').className).toContain('text-red-400');
  });

  it('walks the history with the arrow keys from the newest command', () => {
    open({
      commandHistory: [
        { id: 'a', timestamp: '10:00:00', command: 'cd ..', output: '', status: 'ok' },
        { id: 'b', timestamp: '10:00:01', command: 'tasklist', output: '', status: 'ok' },
      ],
    });

    fireEvent.keyDown(prompt(), { key: 'ArrowUp' });
    expect(prompt().value).toBe('tasklist');
    fireEvent.keyDown(prompt(), { key: 'ArrowUp' });
    expect(prompt().value).toBe('cd ..');
    fireEvent.keyDown(prompt(), { key: 'ArrowDown' });
    expect(prompt().value).toBe('tasklist');
    fireEvent.keyDown(prompt(), { key: 'ArrowDown' });
    expect(prompt().value).toBe('');
  });

  it('clears the log from the monitor toolbar', () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.clearLabel) }));
    expect(props.onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('marks the elevated shell and offers the switch only when the host can elevate', () => {
    const props = open({ isAdminMode: true, onRequestElevation: vi.fn() });
    expect(screen.getByText(t.cmdAdminElevated)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.cmdElevatedShell }));
    expect(props.onRequestElevation).toHaveBeenCalledTimes(1);
  });

  it('hides the elevation switch when the host has none', () => {
    open();
    expect(screen.queryByRole('button', { name: t.cmdUserShell })).toBeNull();
  });
});
