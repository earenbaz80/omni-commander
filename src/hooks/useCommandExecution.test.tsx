import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CommandHistoryItem } from '../types';
import { useCommandExecution } from './useCommandExecution';

/**
 * The command bar reads the machine, and two things must hold at that boundary:
 * a read that fails has to say so, and a read that succeeds has to be printed as
 * it came. The first one is a bug this file was written for — an exception
 * escaping the command left the output drawer empty, so a failed `tasklist` was
 * indistinguishable from a command that did nothing.
 */
const engine = vi.hoisted(() => ({
  getProcesses: vi.fn(),
  getNetworkAdapters: vi.fn(),
  getFolderTree: vi.fn(),
}));

vi.mock('../services/fileSystem', () => ({ fsEngine: engine }));

const makeDeps = () => ({
  lang: 'es' as const,
  activeItems: [],
  currentActiveTab: { currentPath: 'C:\\temp', driveId: 'real_C' },
  activePanel: 'left' as const,
  isAdminMode: false,
  handleGoParent: vi.fn(),
  handleNavigate: vi.fn(),
  setCommandHistory: vi.fn(),
});

type Deps = ReturnType<typeof makeDeps>;

/** The single history entry a command pushed. */
function pushedEntry(deps: Deps): CommandHistoryItem {
  expect(deps.setCommandHistory).toHaveBeenCalledTimes(1);
  const [update] = deps.setCommandHistory.mock.calls[0] as [(prev: CommandHistoryItem[]) => CommandHistoryItem[]];
  return update([])[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCommandExecution', () => {
  it('shows why a read failed instead of returning nothing', async () => {
    engine.getProcesses.mockRejectedValueOnce(new Error('tasklist timed out'));
    const deps = makeDeps();
    const { result } = renderHook(() => useCommandExecution(deps));

    await result.current.handleExecuteCommand('tasklist');

    const entry = pushedEntry(deps);
    expect(entry.status).toBe('error');
    expect(entry.output).toContain('El comando falló');
    expect(entry.output).toContain('tasklist timed out');
  });

  it('prints the process rows the server returned', async () => {
    engine.getProcesses.mockResolvedValueOnce([
      { pid: 4, name: 'System', memoryKb: 128 },
      { pid: 1234, name: 'node.exe', memoryKb: 2048 },
    ]);
    const deps = makeDeps();
    const { result } = renderHook(() => useCommandExecution(deps));

    await result.current.handleExecuteCommand('tasklist');

    const entry = pushedEntry(deps);
    expect(entry.status).toBe('ok');
    const lines = entry.output.split('\n');
    expect(lines[0]).toContain('PID');
    expect(lines[0]).toContain('Imagen');
    expect(lines[1]).toContain('System');
    expect(lines[2]).toContain('node.exe');
    // The table the shell used to print is gone, not merely unused.
    expect(entry.output).not.toContain('omnicmd.exe');
  });

  it('draws the tree the server walked for the active folder', async () => {
    engine.getFolderTree.mockResolvedValueOnce({
      path: 'C:\\temp',
      entries: [
        { name: 'alfa', depth: 1 },
        { name: 'beta', depth: 2 },
      ],
      unreadable: [],
      truncated: false,
    });
    const deps = makeDeps();
    const { result } = renderHook(() => useCommandExecution(deps));

    await result.current.handleExecuteCommand('tree');

    expect(engine.getFolderTree).toHaveBeenCalledWith('real_C', 'C:\\temp');
    const entry = pushedEntry(deps);
    const lines = entry.output.split('\n');
    expect(lines[0]).toBe('C:\\temp');
    expect(lines[1]).toBe('alfa');
    expect(lines[2]).toBe('   beta');
    expect(entry.output).not.toContain('OMNICMD');
  });
});
