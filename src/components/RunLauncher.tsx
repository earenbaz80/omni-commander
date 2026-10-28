import React from 'react';
import {
  AppWindow,
  ChevronDown,
  ChevronUp,
  History,
  Keyboard,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Star,
  X,
} from 'lucide-react';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import {
  RUN_EXAMPLE_ROWS,
  RunFailure,
  RunSuggestion,
  fetchRunSuggestions,
  loadRunFavorites,
  loadRunHistory,
  moveRunFavorite,
  openRunTarget,
  planRunCommand,
  rememberRunTarget,
  removeRunFavorite,
  runCommand,
  toggleRunFavorite,
} from '../services/runLauncher';

interface RunLauncherProps {
  t: Record<string, string>;
  currentTheme: ThemeConfig;
  activePanel: 'left' | 'right';
  onNavigate: (side: 'left' | 'right', path: string) => void;
  /**
   * Bumped by the app-wide shortcut. A counter instead of a boolean so the same
   * key focuses the field again after the user looked elsewhere.
   */
  openRequest?: number;
  /** Takes the focus on mount, for the one-line row that exists only on demand. */
  autoFocus?: boolean;
  /** Present only when the launcher is standing on its own and can be closed. */
  onDismiss?: () => void;
}

/** Words each refusal is shown with, so the dialog never says "error" alone. */
const FAILURE_KEYS: Record<RunFailure, string> = {
  'not-found': 'runErrorNotFound',
  'not-accessible': 'runErrorNotAccessible',
  'unsupported-target': 'runErrorUnsupported',
  'invalid-target': 'runErrorInvalid',
  'launch-failed': 'runErrorFailed',
  unreachable: 'runErrorUnreachable',
  'program-not-found': 'runErrorProgramNotFound',
  'program-not-accessible': 'runErrorProgramNotAccessible',
  'elevation-denied': 'runErrorElevationDenied',
};

/** Quotes an argument the way the confirmation line should read it back. */
const printableCommand = (argv: string[]) => argv.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');

/**
 * The toolbar's Run line, in the spirit of the Windows Run dialog: a field that
 * is always there instead of a box behind a button, because opening it was a
 * gesture the line itself can spare. Win+R belongs to the operating system and
 * cannot be taken over, so this one has its own key (Ctrl+Shift+R).
 *
 * Three outcomes, in increasing order of trust:
 *
 * - a folder navigates the active panel (a file manager should not open a second
 *   Explorer window for a path it is already showing);
 * - a document or a system destination is handed to the shell;
 * - anything else is treated as a program, and that never starts on the first
 *   Enter. The server returns the argv it parsed, the panel below shows that
 *   line verbatim and waits for a second, explicit confirmation, because "open"
 *   and "run this" are not the same thing to agree to.
 *
 * While the first token is being typed, the server offers what exists — Start
 * Menu programs (as their shortcut path, which is what the opener can act on)
 * and the destinations Windows answers to by name — so a line does not have to
 * be remembered exactly. Memory (favourites and recents) is shown whenever the
 * empty field has focus, which is the moment a target is about to be typed.
 *
 * Escape undoes one thing at a time: the confirmation, the suggestion list, the
 * typed line. Up recalls the last targets, because those are the reflexes the
 * real Run box has trained. Ctrl+Shift+Enter is the Run box's "run as
 * administrator": the same plan, with Windows' UAC prompt behind it, which is
 * also a box in the confirmation so the key is not the only way in. The keyboard
 * button in the line opens a short table of these keys, so none of it has to be
 * learned from the help manual.
 */
export const RunLauncher: React.FC<RunLauncherProps> = ({
  t,
  currentTheme,
  activePanel,
  onNavigate,
  openRequest,
  autoFocus = false,
  onDismiss,
}) => {
  const [value, setValue] = React.useState('');
  // The panel below the line (hint, suggestions, confirmation) belongs to the
  // moment it is being used; a permanently visible dropdown would eat the file
  // list it sits above.
  const [focused, setFocused] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>(() => loadRunHistory());
  const [favorites, setFavorites] = React.useState<string[]>(() => loadRunFavorites());
  const [recall, setRecall] = React.useState(-1);
  // The parsed plan waiting for approval: the command as typed, its argv, and
  // whether the user asked Windows for administrator rights.
  const [pending, setPending] = React.useState<{ command: string; argv: string[]; elevated: boolean } | null>(null);
  // Only what the server proposed; the list below also holds what this line
  // remembers, which needs no round trip.
  const [remoteSuggestions, setRemoteSuggestions] = React.useState<RunSuggestion[]>([]);
  const [highlight, setHighlight] = React.useState(0);
  // Hidden after choosing a row or pressing Escape, so the list does not pop back
  // under the cursor. Typing reveals it again.
  const [listHidden, setListHidden] = React.useState(false);
  // The keys card replaces the suggestions while it is open: it is read, not
  // typed into, so the two have no reason to share the panel.
  const [keysOpen, setKeysOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  // The latest run action for the window-level keys, which outlive a render.
  const runLineRef = React.useRef<(options?: { elevated?: boolean }) => Promise<void>>(async () => {});

  /** Lowercase without accents, so the local filter agrees with the server's. */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  // What this line remembers, first: a favourite is a deliberate choice, and a
  // recent target is what was just used. Both are filtered by the same text the
  // server sees, so the list reads as one thing instead of two groups.
  const localSuggestions = React.useMemo<RunSuggestion[]>(() => {
    const query = fold(value.trim());
    const rows: RunSuggestion[] = [];
    const seen = new Set<string>();
    const add = (target: string, kind: 'favorite' | 'recent') => {
      const key = target.toLowerCase();
      if (!target.trim() || seen.has(key)) return;
      if (query && !fold(target).includes(query)) return;
      seen.add(key);
      rows.push({ value: target, kind });
    };
    favorites.forEach((target) => add(target, 'favorite'));
    history.forEach((target) => add(target, 'recent'));
    return rows;
  }, [favorites, history, value]);

  const suggestions = React.useMemo<RunSuggestion[]>(() => {
    const seen = new Set<string>();
    const merged: RunSuggestion[] = [];
    for (const row of [...localSuggestions, ...remoteSuggestions]) {
      const key = row.value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    return merged.slice(0, 8);
  }, [localSuggestions, remoteSuggestions]);

  const showList = focused && !pending && !listHidden && suggestions.length > 0;

  // Suggestions follow what is being typed, with a short debounce so a word does
  // not become one request per keystroke. Only the first token is completed:
  // once the line has a space the user is typing arguments, and replacing the
  // whole line with a suggestion would eat them.
  React.useEffect(() => {
    if (!focused || pending || listHidden) {
      setRemoteSuggestions([]);
      return;
    }
    const query = value.trim();
    if (!query || /\s/.test(query)) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await fetchRunSuggestions(query);
      if (cancelled) return;
      setRemoteSuggestions(found);
      setHighlight(0);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [focused, pending, listHidden, value]);

  // While a plan waits, focus moves to the button that approves it.
  React.useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  // A launcher that exists because the shortcut asked for it starts focused; it
  // has no toolbar around it to click first.
  React.useEffect(() => {
    if (!autoFocus) return;
    // The state follows the focus call explicitly: a programmatic focus does not
    // always reach React's handler, and an "open" line without it would show no
    // hint and would not answer Escape.
    setFocused(true);
    inputRef.current?.focus();
  }, [autoFocus]);

  // Ctrl+Shift+R focuses the line from anywhere in the window. The owning app
  // increments the counter, so the focusing itself stays in one place: this
  // component still decides what a used line looks like. The last handled value
  // is remembered so a remount (the toolbar can be hidden and shown again) does
  // not steal the focus on its own.
  const handledOpenRequest = React.useRef(openRequest ?? 0);
  React.useEffect(() => {
    if (!openRequest || openRequest === handledOpenRequest.current) return;
    handledOpenRequest.current = openRequest;
    setListHidden(false);
    setFocused(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [openRequest]);

  // The keys that outlive focus are handled on the window: Ctrl+R because focus
  // sits on the confirmation button while a plan waits, and Escape for the same
  // reason.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+R is the Ejecutar button's other face. Shift is excluded: that is
      // the app-wide shortcut that brings the line into focus.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'r') {
        if (!focused && !pending) return;
        // Also keep it away from the browser, where it means reload.
        event.preventDefault();
        event.stopPropagation();
        void runLineRef.current();
        return;
      }
      // Ctrl+Shift+Enter is elevation. On a waiting plan it is the answer, and
      // it has to live here: the focus is on the confirm button then, so the
      // field never sees the key. On the line the field's own handler acts.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
        if (!pending) return;
        event.preventDefault();
        event.stopPropagation();
        void runLineRef.current({ elevated: true });
        return;
      }
      if (event.key !== 'Escape') return;
      // The listener is always attached now that the line never unmounts; it
      // must not eat an Escape meant for a dialog elsewhere in the window.
      if (!focused && !pending && !keysOpen) return;
      event.stopPropagation();
      // One thing at a time: the keys card, the confirmation, the list, the line.
      if (keysOpen) {
        setKeysOpen(false);
        return;
      }
      if (pending) {
        setPending(null);
        setError('');
        inputRef.current?.focus();
        return;
      }
      if (!listHidden && suggestions.length) {
        setRemoteSuggestions([]);
        setListHidden(true);
        return;
      }
      if (value) {
        setValue('');
        setError('');
        setRecall(-1);
        return;
      }
      inputRef.current?.blur();
      // With nothing left to undo, Escape is how the one-line row goes away.
      onDismiss?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focused, pending, keysOpen, listHidden, suggestions.length, value, onDismiss]);

  const cancelPending = () => {
    setPending(null);
    setError('');
    setRemoteSuggestions([]);
    // The line stays in the field so it can be edited instead of retyped.
    inputRef.current?.focus();
  };

  const failureText = (reason: RunFailure, program?: string) => {
    const key = FAILURE_KEYS[reason] || 'runErrorFailed';
    return (t[key] || t.runErrorFailed).replace('{program}', program || '');
  };

  const pick = (suggestion: RunSuggestion) => {
    setListHidden(true);
    setValue(suggestion.value);
    setRemoteSuggestions([]);
    setHighlight(0);
    setError('');
    setRecall(-1);
    inputRef.current?.focus();
  };

  // Favourites are the one part of this list the user owns, so its order and its
  // members can be changed here instead of through Ctrl+D and hope.
  const shiftFavorite = (target: string, offset: -1 | 1) => {
    soundManager.playKeyTick();
    setFavorites((current) => moveRunFavorite(target, offset, current));
    setHighlight(0);
  };

  const dropFavorite = (target: string) => {
    soundManager.playKeyTick();
    setFavorites((current) => removeRunFavorite(target, current));
    setHighlight(0);
  };

  /** A line that did something leaves the field ready for the next one. */
  const resetLine = () => {
    setValue('');
    setError('');
    setRecall(-1);
    setListHidden(false);
    inputRef.current?.focus();
    // A launch is the end of the errand when the row exists only for this.
    onDismiss?.();
  };

  const confirmRun = async (elevatedOverride?: boolean) => {
    if (!pending || busy) return;
    const elevated = elevatedOverride ?? pending.elevated;
    setBusy(true);
    setError('');
    const result = elevated ? await runCommand(pending.command, true) : await runCommand(pending.command);
    setBusy(false);

    if (result.kind === 'error') {
      soundManager.playError();
      setError(failureText(result.reason, result.program));
      return;
    }

    soundManager.playSuccess();
    setHistory((previous) => rememberRunTarget(pending.command, previous));
    setPending(null);
    resetLine();
  };

  /**
   * The one action behind Enter, the Ejecutar button and Ctrl+R: answer the
   * waiting confirmation, or run the line as it was typed.
   */
  const runLine = async (options?: { elevated?: boolean }) => {
    // While a plan waits, Enter is the same answer as the confirm button, and
    // Ctrl+Shift+Enter is that answer with elevation on top.
    if (pending) {
      await confirmRun(options?.elevated);
      return;
    }

    // Enter always acts on a line. What is typed is what runs; with the field
    // empty there is no line, so the row under the cursor is the answer. Tab and
    // the pointer are what complete a suggestion — Enter never stops at filling
    // the field, because a launcher that needs two Enters is a form.
    const typed = value.trim();
    const target = typed || (listHidden ? '' : (suggestions[highlight]?.value ?? '')).trim();
    if (!target || busy) return;

    // Asking for elevation is a decision to run, so it skips the open step: a
    // folder opened "as administrator" would be a second window where the panel
    // should navigate, and the plan is what the UAC prompt will act on anyway.
    if (options?.elevated) {
      setBusy(true);
      setError('');
      const plan = await planRunCommand(target, true);
      setBusy(false);
      if ('argv' in plan) setPending({ command: target, argv: plan.argv, elevated: true });
      else {
        soundManager.playError();
        setError(failureText(plan.error, plan.program));
      }
      return;
    }

    setBusy(true);
    setError('');
    const result = await openRunTarget(target);

    // Not something to open: ask the server what it would become, and show that
    // instead of starting it.
    if (result.kind === 'error' && result.reason === 'unsupported-target') {
      const plan = await planRunCommand(target);
      setBusy(false);
      if ('argv' in plan) setPending({ command: target, argv: plan.argv, elevated: false });
      else {
        soundManager.playError();
        setError(failureText(plan.error, plan.program));
      }
      return;
    }

    setBusy(false);
    if (result.kind === 'error') {
      soundManager.playError();
      setError(failureText(result.reason));
      return;
    }

    soundManager.playSuccess();
    setHistory((previous) => rememberRunTarget(target, previous));
    resetLine();
    if (result.kind === 'folder') onNavigate(activePanel, result.path);
  };

  runLineRef.current = runLine;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await runLine();
  };

  /** The keys this line answers to, as a small table instead of prose. */
  const shortcutRows: Array<[string, string]> = [
    ['Enter', t.runKeysEnter],
    ['Ctrl + R', t.runKeysCtrlR],
    ['Ctrl + Shift + Enter', t.runKeysElevate],
    ['Tab', t.runKeysTab],
    ['↑ / ↓', t.runKeysArrows],
    ['Ctrl + D', t.runKeysPin],
    ['Esc', t.runKeysEscape],
  ];

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Ctrl+Shift+Enter is the Run box's "run as administrator": the line is
    // parsed and shown with elevation already chosen, so the UAC prompt follows
    // the same confirmation as any other program instead of arriving unannounced.
    if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      void runLine({ elevated: true });
      return;
    }
    // While a list is open the arrows move inside it; with the field empty they
    // walk the history, the way the Run box does. Both are captured here so the
    // panel keeps its own arrow-key navigation untouched.
    // Ctrl+D pins (or unpins) whatever the row under the cursor points at, so a
    // target can be kept without adding it to a dialog nobody opens.
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const target = (listHidden ? undefined : suggestions[highlight])?.value ?? value.trim();
      if (!target) return;
      soundManager.playKeyTick();
      setFavorites((current) => toggleRunFavorite(target, current));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!listHidden && suggestions.length) {
        setHighlight((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (!history.length) return;
      const next = Math.min(recall + 1, history.length - 1);
      setRecall(next);
      setValue(history[next]);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!listHidden && suggestions.length) {
        setHighlight((current) => (current + 1) % suggestions.length);
        return;
      }
      const next = recall - 1;
      setRecall(next);
      setValue(next < 0 ? '' : history[next]);
      return;
    }
    // Tab is the other reflex for accepting a completion, so it does the same as
    // Enter on a highlighted row, without submitting the line.
    if (event.key === 'Tab' && !listHidden && suggestions.length) {
      event.preventDefault();
      pick(suggestions[highlight]);
    }
  };

  /**
   * Puts one example in the line, ready to edit or to run with Enter. The pointer
   * never takes the focus (the button cancels its own mousedown), so the caret is
   * still in the field when the text arrives; the card closes because the line is
   * now the user's, not a menu's.
   */
  const fillExample = (example: string) => {
    soundManager.playKeyTick();
    setPending(null);
    setError('');
    setRecall(-1);
    setKeysOpen(false);
    // The example answers the question the suggestions were asking; the list
    // comes back with the next keystroke, when there is something new to match.
    setListHidden(true);
    setValue(example);
    inputRef.current?.focus();
  };

  const panelOpen = pending !== null || showList || !!error || focused || keysOpen;

  return (
    <div className="relative flex-1 min-w-[11rem] max-w-[26rem]">
      <form
        onSubmit={submit}
        title={t.runTitle}
        className="flex items-center gap-[var(--space-2)] rounded border bg-black/50 px-[var(--space-2)] py-[var(--space-1)]"
        style={{ borderColor: currentTheme.borderPanel }}
      >
        <SquareTerminal className="w-3.5 h-3.5 shrink-0 text-amber-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            // Typing again is a new question for the autocomplete, and a new
            // line invalidates a plan that was parsed from the old one.
            setPending(null);
            setKeysOpen(false);
            setListHidden(false);
            setValue(event.target.value);
            setError('');
            setRecall(-1);
          }}
          onFocus={() => {
            setFocused(true);
            setKeysOpen(false);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={t.runPlaceholder}
          aria-label={t.runPlaceholder}
          aria-invalid={error ? true : undefined}
          aria-busy={busy}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? 'run-suggestions' : undefined}
          aria-activedescendant={showList ? `run-suggestion-${highlight}` : undefined}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-white font-mono"
        />
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => {
            soundManager.playKeyTick();
            setKeysOpen((open) => !open);
          }}
          className={`shrink-0 rounded px-[var(--space-1)] disabled:opacity-30 disabled:cursor-default ${
            keysOpen ? 'text-amber-300 cursor-pointer' : 'text-white/40 hover:text-white/80 cursor-pointer'
          }`}
          title={t.runKeysTitle}
          aria-label={t.runKeysButtonLabel}
          aria-expanded={keysOpen}
          aria-controls={keysOpen ? 'run-keys' : undefined}
        >
          <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              onDismiss();
            }}
            className="shrink-0 rounded px-[var(--space-1)] text-white/40 hover:text-red-300 cursor-pointer"
            title={t.runDismiss}
            aria-label={t.runDismiss}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </form>

      {panelOpen && (
        <div
          role={pending ? 'dialog' : undefined}
          aria-label={pending ? t.runConfirmLead : undefined}
          className="absolute right-0 z-[70] mt-1 w-[min(26rem,calc(100vw-2rem))] rounded border bg-black/95 p-[var(--space-2)] shadow-lg"
          style={{ borderColor: currentTheme.borderPanel }}
        >
          {pending ? (
            <form onSubmit={submit} className="flex flex-col gap-[var(--space-2)]">
              <p className="text-[11px] text-amber-200">{t.runConfirmLead}</p>
              <code className="block break-all rounded border border-amber-400/40 bg-black/70 px-[var(--space-2)] py-[var(--space-1)] text-[11px] text-amber-100 font-mono">
                {printableCommand(pending.argv)}
              </code>
              {/* The box is checked when Ctrl+Shift+Enter asked for elevation, and
                  can be changed here: Windows' Run box hides this behind the key,
                  which leaves anyone who does not know it without a way in. */}
              <label className="flex items-center gap-[var(--space-1)] text-[10px] text-white/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pending.elevated}
                  onChange={(event) =>
                    setPending((current) => (current ? { ...current, elevated: event.target.checked } : current))
                  }
                  className="accent-amber-400"
                />
                <ShieldCheck className="w-3 h-3 shrink-0 text-amber-300" aria-hidden="true" />
                {t.runElevate}
              </label>
              <div className="flex items-center gap-[var(--space-2)]">
                <button
                  ref={confirmRef}
                  type="submit"
                  disabled={busy}
                  className="px-[var(--space-3)] py-[var(--space-1)] rounded border border-amber-300 bg-amber-400 text-black text-[11px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {t.runConfirmRun}
                </button>
                <button
                  type="button"
                  onClick={cancelPending}
                  className="px-[var(--space-3)] py-[var(--space-1)] rounded border border-white/20 text-[11px] cursor-pointer hover:bg-white/10"
                >
                  {t.runConfirmCancel}
                </button>
              </div>
            </form>
          ) : keysOpen ? (
            <div className="space-y-[var(--space-2)]">
              <table id="run-keys" aria-label={t.runKeysTitle} className="w-full text-[10px] leading-tight">
                <tbody>
                  {shortcutRows.map(([key, description]) => (
                    <tr key={key} className="align-top">
                      <th scope="row" className="py-[2px] pr-[var(--space-2)] text-left align-top">
                        <kbd className="inline-block rounded border border-amber-400/40 bg-black/60 px-[var(--space-1)] font-bold text-amber-300">
                          {key}
                        </kbd>
                      </th>
                      <td className="py-[2px] text-white/70">{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The same examples the manual lists, next to the field they are
                  for: the card is where people look before typing, not the F1
                  manual they would have to leave the line to open. */}
              <div className="space-y-[var(--space-1)] border-t border-white/10 pt-[var(--space-2)]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  {t.helpRunExamplesTitle}
                </p>
                <dl className="space-y-[3px] text-[10px] leading-tight">
                  {RUN_EXAMPLE_ROWS.map((row) => (
                    <div key={row.descriptionKey} className="flex flex-wrap items-baseline gap-x-[var(--space-2)]">
                      <dt className="flex flex-wrap gap-[3px]">
                        {row.examples.map((example) => (
                          <button
                            key={example}
                            type="button"
                            // Cancelling the mousedown keeps the caret in the field,
                            // which is where the text is about to appear.
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => fillExample(example)}
                            title={example}
                            className="break-all rounded border border-amber-400/30 bg-black/50 px-[3px] font-mono text-amber-200 hover:bg-amber-400 hover:text-black cursor-pointer"
                          >
                            {example}
                          </button>
                        ))}
                      </dt>
                      <dd className="text-white/70">{t[row.descriptionKey]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ) : (
            <>
              {showList && (
                <ul
                  id="run-suggestions"
                  role="listbox"
                  aria-label={t.runSuggestions}
                  className="max-h-44 overflow-y-auto rounded border border-white/15 bg-black/80"
                >
                  {suggestions.map((suggestion, index) => {
                    const active = index === highlight;
                    const label = suggestion.label ?? suggestion.value;
                    // Only a pinned row can be rearranged, and only within the
                    // pinned list: an edge simply has nothing further to do.
                    const pinnedIndex = favorites.findIndex(
                      (entry) => entry.toLowerCase() === suggestion.value.toLowerCase(),
                    );
                    return (
                      <li
                        key={`${suggestion.kind}:${suggestion.value}`}
                        id={`run-suggestion-${index}`}
                        role="option"
                        aria-selected={active}
                        className="flex items-stretch"
                      >
                        <button
                          type="button"
                          // The pointer must not steal focus from the field before
                          // the click lands, or the list would close under the cursor.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pick(suggestion)}
                          onMouseEnter={() => setHighlight(index)}
                          className={`flex-1 min-w-0 flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-left cursor-pointer ${
                            active ? 'bg-amber-400 text-black' : 'text-white/90 hover:bg-white/10'
                          }`}
                        >
                          {suggestion.kind === 'favorite' ? (
                            <Star className="w-3 h-3 shrink-0 fill-current" aria-hidden="true" />
                          ) : suggestion.kind === 'recent' ? (
                            <History className="w-3 h-3 shrink-0" aria-hidden="true" />
                          ) : suggestion.kind === 'app' ? (
                            <AppWindow className="w-3 h-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <Settings className="w-3 h-3 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate text-[11px]">{suggestion.label ?? suggestion.value}</span>
                          {suggestion.label && (
                            <span
                              className={`ml-auto truncate text-[9px] ${active ? 'text-black/60' : 'text-white/40'}`}
                            >
                              {suggestion.value}
                            </span>
                          )}
                        </button>
                        {suggestion.kind === 'favorite' && (
                          <div className="flex shrink-0 items-center bg-black/40">
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => shiftFavorite(suggestion.value, -1)}
                              disabled={pinnedIndex <= 0}
                              title={t.runFavMoveUp}
                              aria-label={`${t.runFavMoveUp} — ${label}`}
                              className="px-[2px] text-white/50 hover:text-amber-300 disabled:opacity-25 disabled:cursor-default cursor-pointer"
                            >
                              <ChevronUp className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => shiftFavorite(suggestion.value, 1)}
                              disabled={pinnedIndex === -1 || pinnedIndex >= favorites.length - 1}
                              title={t.runFavMoveDown}
                              aria-label={`${t.runFavMoveDown} — ${label}`}
                              className="px-[2px] text-white/50 hover:text-amber-300 disabled:opacity-25 disabled:cursor-default cursor-pointer"
                            >
                              <ChevronDown className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => dropFavorite(suggestion.value)}
                              title={t.runFavRemove}
                              aria-label={`${t.runFavRemove} — ${label}`}
                              className="px-[2px] text-white/50 hover:text-red-300 cursor-pointer"
                            >
                              <X className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {showList && (
                <p className="mt-[var(--space-1)] text-[9px] leading-tight text-white/40">{t.runFavoriteHint}</p>
              )}
            </>
          )}
          {/* The refusal belongs to whichever step was running: a program the
              shell cannot find must say so without dropping the confirmation. */}
          {!keysOpen && (error || !pending) && (
            <p
              className={`text-[10px] leading-tight ${error ? 'text-red-300' : 'text-white/50'} ${
                showList || pending ? 'mt-[var(--space-1)]' : ''
              }`}
              role={error ? 'alert' : undefined}
            >
              {error || t.runHint}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
