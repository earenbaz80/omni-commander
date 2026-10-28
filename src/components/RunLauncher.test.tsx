import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';
import { RUN_EXAMPLE_ROWS } from '../services/runLauncher';

/**
 * The Run box has to do four things right, and they are the four that make it
 * useful rather than decorative:
 *
 * - a folder navigates the active panel (not a second Explorer window);
 * - a refusal is worded, not swallowed, so a typo does not look like a no-op;
 * - the last targets come back on Up, which is what the real Run box trained;
 * - a program starts on that same Enter, with no card in between.
 *
 * The server calls are mocked: what they decide is covered by
 * server.open.test.ts and server.run.test.ts. Here the question is only what the
 * dialog does with each answer.
 */
const openRunTarget = vi.fn();
const runCommand = vi.fn();
const fetchRunSuggestions = vi.fn();

vi.mock('../services/runLauncher', async () => {
  const actual = await vi.importActual<typeof import('../services/runLauncher')>('../services/runLauncher');
  return {
    ...actual,
    openRunTarget: (...args: unknown[]) => openRunTarget(...args),
    runCommand: (...args: unknown[]) => runCommand(...args),
    fetchRunSuggestions: (...args: unknown[]) => fetchRunSuggestions(...args),
  };
});

const { RunLauncher } = await import('./RunLauncher');

const t = translations.es;

const renderLauncher = (onNavigate = vi.fn()) => {
  render(<RunLauncher t={t} currentTheme={themes.classic_blue} activePanel="right" onNavigate={onNavigate} />);
  return onNavigate;
};

/**
 * The line lives in the toolbar permanently, so there is no box to open: giving
 * it focus is what brings the panel (hint, suggestions, confirmation) up.
 */
const openBox = () => {
  const input = screen.getByLabelText(t.runPlaceholder) as HTMLInputElement;
  fireEvent.focus(input);
  return input;
};

beforeEach(() => {
  openRunTarget.mockReset();
  runCommand.mockReset();
  fetchRunSuggestions.mockReset();
  fetchRunSuggestions.mockResolvedValue([]);
  localStorage.clear();
});

describe('RunLauncher', () => {
  it('is in the toolbar from the start, and explains itself once it has focus', () => {
    renderLauncher();
    const input = screen.getByLabelText(t.runPlaceholder) as HTMLInputElement;
    // A permanently visible panel would cover the file list it sits above.
    expect(screen.queryByText(t.runHint)).toBeNull();

    fireEvent.focus(input);

    expect(screen.getByText(t.runHint)).toBeDefined();
  });

  it('navigates the active panel when the target is a folder', async () => {
    openRunTarget.mockResolvedValue({ kind: 'folder', path: 'C:\\Windows' });
    const onNavigate = renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'C:\\Windows' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('right', 'C:\\Windows'));
    expect(openRunTarget).toHaveBeenCalledWith('C:\\Windows');
    // Success leaves the line ready for the next target.
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not navigate when the target was launched by Windows', async () => {
    openRunTarget.mockResolvedValue({ kind: 'opened', target: 'ms-settings:display' });
    const onNavigate = renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'ms-settings:display' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(input.value).toBe(''));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows the reason a target was refused and keeps the box open to fix it', async () => {
    openRunTarget.mockResolvedValue({ kind: 'error', reason: 'not-found' });
    const onNavigate = renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'C:\\no-existe' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t.runErrorNotFound);
    expect(screen.getByLabelText(t.runPlaceholder)).toBeDefined();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('starts a program on that same Enter, with no card in between', async () => {
    openRunTarget.mockResolvedValue({ kind: 'error', reason: 'unsupported-target' });
    runCommand.mockResolvedValue({ kind: 'launched', argv: ['notepad'] });
    renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('notepad'));
    // One Enter is one window, and the line is ready for the next target.
    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openRunTarget).toHaveBeenCalledWith('notepad');
  });

  it('launches elevated on Ctrl+Shift+Enter, without opening it first', async () => {
    runCommand.mockResolvedValue({ kind: 'launched', argv: ['notepad'] });
    renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true });

    // Elevation is a decision to run, so the shell is never asked to open it.
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('notepad', true));
    expect(openRunTarget).not.toHaveBeenCalled();
  });

  it('says Windows refused the elevation instead of blaming the program', async () => {
    runCommand.mockResolvedValue({ kind: 'error', reason: 'elevation-denied' });
    renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true });

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t.runErrorElevationDenied);
  });

  it('names the program Windows could not find', async () => {
    openRunTarget.mockResolvedValue({ kind: 'error', reason: 'unsupported-target' });
    runCommand.mockResolvedValue({ kind: 'error', reason: 'program-not-found', program: 'omnicmd-ghost' });
    renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: 'omnicmd-ghost' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      t.runErrorProgramNotFound.replace('{program}', 'omnicmd-ghost'),
    );
    // A refusal keeps the line, so a typo can be fixed instead of retyped.
    expect(input.value).toBe('omnicmd-ghost');
  });

  it('ignores an empty target without calling the server', () => {
    renderLauncher();

    const input = openBox();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);

    expect(openRunTarget).not.toHaveBeenCalled();
  });

  it('recalls the last target with Up, and clears it again with Down', async () => {
    openRunTarget.mockResolvedValue({ kind: 'folder', path: 'C:\\Windows' });
    renderLauncher();

    const first = openBox();
    fireEvent.change(first, { target: { value: 'C:\\Windows' } });
    fireEvent.submit(first.closest('form')!);
    await waitFor(() => expect(first.value).toBe(''));

    const second = openBox();
    // On an empty field the memory list is what the arrows move through, so
    // recall starts by putting that list away.
    fireEvent.keyDown(second, { key: 'Escape' });

    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(second.value).toBe('C:\\Windows');

    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(second.value).toBe('');
  });

  it('runs the typed line with Ctrl+R, like Enter', async () => {
    openRunTarget.mockResolvedValue({ kind: 'opened', target: 'notepad' });
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });

    await waitFor(() => expect(openRunTarget).toHaveBeenCalledWith('notepad'));
  });

  it('starts the typed program with Ctrl+R, like Enter', async () => {
    openRunTarget.mockResolvedValue({ kind: 'error', reason: 'unsupported-target' });
    runCommand.mockResolvedValue({ kind: 'launched', argv: ['notepad'] });
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });

    fireEvent.keyDown(window, { key: 'R', ctrlKey: true });

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('notepad'));
  });

  it('leaves Ctrl+Shift+R to the app-wide focus shortcut', () => {
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true, shiftKey: true });

    expect(openRunTarget).not.toHaveBeenCalled();
  });

  it('takes the focus, again and again, when the app-wide shortcut bumps the request counter', () => {
    const props = { t, currentTheme: themes.classic_blue, activePanel: 'right' as const, onNavigate: vi.fn() };
    const { rerender } = render(<RunLauncher {...props} openRequest={0} />);
    const input = screen.getByLabelText(t.runPlaceholder) as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    rerender(<RunLauncher {...props} openRequest={1} />);
    // Focus follows the shortcut, so the key can be followed by typing.
    expect(document.activeElement).toBe(input);

    act(() => input.blur());
    expect(document.activeElement).not.toBe(input);

    rerender(<RunLauncher {...props} openRequest={2} />);
    expect(document.activeElement).toBe(input);
  });

  it('shows its own key table on demand, and takes it away on Escape or typing', () => {
    renderLauncher();
    const input = openBox();

    fireEvent.click(screen.getByRole('button', { name: t.runKeysButtonLabel }));

    const table = screen.getByRole('table', { name: t.runKeysTitle });
    const keys = [...table.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
    expect(keys).toEqual(['Enter', 'Ctrl + R', 'Ctrl + Shift + Enter', 'Tab', '↑ / ↓', 'Ctrl + D', 'Esc']);
    expect(table.textContent).toContain(t.runKeysEnter);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('table', { name: t.runKeysTitle })).toBeNull();

    // Typing is a new question: the card gives way to the suggestions.
    fireEvent.click(screen.getByRole('button', { name: t.runKeysButtonLabel }));
    expect(screen.getByRole('table', { name: t.runKeysTitle })).toBeDefined();
    fireEvent.change(input, { target: { value: 'note' } });
    expect(screen.queryByRole('table', { name: t.runKeysTitle })).toBeNull();
  });

  it('lists what the field accepts in that same card, so the manual is not needed', () => {
    renderLauncher();
    openBox();

    fireEvent.click(screen.getByRole('button', { name: t.runKeysButtonLabel }));

    const card = screen.getByRole('table', { name: t.runKeysTitle }).parentElement as HTMLElement;
    expect(card.textContent).toContain(t.helpRunExamplesTitle);
    // Every example in the shared list is on the card, each with its sentence.
    for (const row of RUN_EXAMPLE_ROWS) {
      for (const example of row.examples) expect(card.textContent).toContain(example);
      expect(card.textContent).toContain(t[row.descriptionKey]);
    }
  });

  it('fills the line from an example, ready to edit or run', async () => {
    renderLauncher();
    const input = openBox();

    fireEvent.click(screen.getByRole('button', { name: t.runKeysButtonLabel }));
    // The second alternative of a row is its own button, not part of a phrase.
    fireEvent.click(screen.getByRole('button', { name: 'google chrome' }));

    expect((input as HTMLInputElement).value).toBe('google chrome');
    // The card gives way to the line it filled, and the field keeps the caret.
    expect(screen.queryByRole('table', { name: t.runKeysTitle })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));

    // Typing over it is normal editing, without a second click on the field.
    fireEvent.change(input, { target: { value: 'notepad' } });
    expect((input as HTMLInputElement).value).toBe('notepad');
  });

  it('undoes one thing per Escape: the list, then the focus', () => {
    localStorage.setItem('omni-run-history', JSON.stringify(['C:\\Windows']));
    renderLauncher();
    const input = openBox();
    expect(screen.getByRole('listbox', { name: t.runSuggestions })).toBeDefined();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: t.runSuggestions })).toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('clears the typed line on Escape, without launching it', () => {
    renderLauncher();
    const input = openBox();

    fireEvent.change(input, { target: { value: 'C:\\Windows' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('');
    expect(openRunTarget).not.toHaveBeenCalled();
  });
});

describe('RunLauncher standing on its own', () => {
  const renderStandalone = (onDismiss = vi.fn()) =>
    render(
      <RunLauncher
        t={t}
        currentTheme={themes.classic_blue}
        activePanel="right"
        onNavigate={vi.fn()}
        autoFocus
        onDismiss={onDismiss}
      />,
    );

  it('takes the focus on mount and reports when it should go away', () => {
    const onDismiss = vi.fn();
    renderStandalone(onDismiss);

    const input = screen.getByLabelText(t.runPlaceholder) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // Focusing is not enough: the line must also be in its "in use" state, with
    // the hint and the keys, or Escape would have nothing to act on.
    expect(screen.getByText(t.runHint)).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes from its own button, and after a launch', async () => {
    const onDismiss = vi.fn();
    openRunTarget.mockResolvedValue({ kind: 'folder', path: 'C:\\Windows' });
    renderStandalone(onDismiss);

    fireEvent.click(screen.getByRole('button', { name: t.runDismiss }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText(t.runPlaceholder) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'C:\\Windows' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
  });
});

describe('RunLauncher autocomplete', () => {
  const programs = [
    { value: 'notepad', kind: 'system' as const },
    { value: 'C:\\Menu Inicio\\Notepad++.lnk', label: 'Notepad++', kind: 'app' as const },
  ];

  /** Types into the field and waits for the debounced list to arrive. */
  const typeAndWait = async (text: string) => {
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: text } });
    await screen.findByRole('listbox', { name: t.runSuggestions });
    return input;
  };

  it('offers programs and destinations while the first word is being typed', async () => {
    fetchRunSuggestions.mockResolvedValue(programs);
    await typeAndWait('note');

    expect(fetchRunSuggestions).toHaveBeenCalledWith('note');
    expect(screen.getByRole('option', { name: /Notepad\+\+/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /notepad/ })).toBeDefined();
  });

  it('runs the typed line on Enter without stopping at a suggestion', async () => {
    fetchRunSuggestions.mockResolvedValue(programs);
    openRunTarget.mockResolvedValue({ kind: 'opened', target: 'note' });
    const input = await typeAndWait('note');

    fireEvent.submit(input.closest('form')!);

    // What was typed is what acts; completing it would cost a second Enter.
    await waitFor(() => expect(openRunTarget).toHaveBeenCalledWith('note'));
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('completes the highlighted suggestion with Tab', async () => {
    fetchRunSuggestions.mockResolvedValue(programs);
    const input = await typeAndWait('note');

    fireEvent.keyDown(input, { key: 'Tab' });

    expect(input.value).toBe('notepad');
    expect(openRunTarget).not.toHaveBeenCalled();
  });

  it('acts on the row under the cursor when the field is empty', async () => {
    openRunTarget.mockResolvedValue({ kind: 'opened', target: 'ms-settings:display' });
    localStorage.setItem('omni-run-favorites', JSON.stringify(['ms-settings:display']));
    renderLauncher();
    const input = openBox();

    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(openRunTarget).toHaveBeenCalledWith('ms-settings:display'));
  });

  it('accepts a suggestion with the pointer', async () => {
    fetchRunSuggestions.mockResolvedValue(programs);
    const input = await typeAndWait('note');

    const row = screen.getByRole('option', { name: /Notepad\+\+/ });
    fireEvent.click(row.querySelector('button')!);

    expect(input.value).toBe('C:\\Menu Inicio\\Notepad++.lnk');
  });

  it('stops suggesting once the line has arguments', async () => {
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad C:\\nota.txt' } });

    // Past the debounce, so a stray request would have happened by now.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fetchRunSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hides the list on Escape without eating the typed line', async () => {
    fetchRunSuggestions.mockResolvedValue(programs);
    const input = await typeAndWait('note');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('note');
  });
});

describe('RunLauncher memory', () => {
  /** Seeds what the box remembers before it mounts, which is when it reads it. */
  const seed = (favorites: string[], history: string[]) => {
    localStorage.setItem('omni-run-favorites', JSON.stringify(favorites));
    localStorage.setItem('omni-run-history', JSON.stringify(history));
  };

  it('shows favourites and then recent targets when the field is empty', () => {
    seed(['ms-settings:display'], ['C:\\Windows']);
    renderLauncher();
    openBox();

    const rows = screen.getAllByRole('option').map((row) => row.textContent);
    expect(rows).toEqual(['ms-settings:display', 'C:\\Windows']);
    expect(screen.getByRole('listbox', { name: t.runSuggestions })).toBeDefined();
  });

  it('removes a favourite from the list itself, and writes the change back', () => {
    seed(['ms-settings:display', 'C:\\Windows'], []);
    renderLauncher();
    openBox();

    fireEvent.click(screen.getByLabelText(`${t.runFavRemove} — ms-settings:display`));

    expect(screen.queryByLabelText(`${t.runFavRemove} — ms-settings:display`)).toBeNull();
    expect(JSON.parse(localStorage.getItem('omni-run-favorites') || '[]')).toEqual(['C:\\Windows']);
  });

  it('reorders favourites from the list itself, and stops at the edges', () => {
    seed(['ms-settings:display', 'C:\\Windows'], []);
    renderLauncher();
    openBox();

    fireEvent.click(screen.getByLabelText(`${t.runFavMoveDown} — ms-settings:display`));

    const rows = screen.getAllByRole('option').map((row) => row.textContent);
    expect(rows[0]).toContain('C:\\Windows');
    expect(rows[1]).toContain('ms-settings:display');
    expect(JSON.parse(localStorage.getItem('omni-run-favorites') || '[]')).toEqual([
      'C:\\Windows',
      'ms-settings:display',
    ]);

    // The order the list shows is the order that gets saved, and its edges have
    // nothing further to move.
    expect((screen.getByLabelText(`${t.runFavMoveUp} — C:\\Windows`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(`${t.runFavMoveDown} — ms-settings:display`) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('filters what it remembers with the same text typed', () => {
    seed(['ms-settings:display', 'C:\\Windows'], ['notepad']);
    renderLauncher();
    const input = openBox();

    fireEvent.change(input, { target: { value: 'win' } });

    const rows = screen.getAllByRole('option').map((row) => row.textContent);
    expect(rows).toEqual(['C:\\Windows']);
  });

  it('pins the typed line with Ctrl+D and unpins it with the same shortcut', () => {
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'notepad' } });

    fireEvent.keyDown(input, { key: 'd', ctrlKey: true });
    expect(JSON.parse(localStorage.getItem('omni-run-favorites') || '[]')).toEqual(['notepad']);

    fireEvent.keyDown(input, { key: 'd', ctrlKey: true });
    expect(JSON.parse(localStorage.getItem('omni-run-favorites') || '[]')).toEqual([]);
  });

  it('pins the row under the cursor rather than the raw text', () => {
    fetchRunSuggestions.mockResolvedValue([
      { value: 'notepad', kind: 'system' as const },
      { value: 'C:\\Menu\\Notepad++.lnk', label: 'Notepad++', kind: 'app' as const },
    ]);
    renderLauncher();
    const input = openBox();
    fireEvent.change(input, { target: { value: 'note' } });

    return waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2)).then(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'd', ctrlKey: true });

      // The field still says "note": pinning is not choosing.
      expect(input.value).toBe('note');
      expect(JSON.parse(localStorage.getItem('omni-run-favorites') || '[]')).toEqual(['C:\\Menu\\Notepad++.lnk']);
    });
  });
});
