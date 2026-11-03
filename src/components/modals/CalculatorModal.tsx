import React, { useCallback, useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { CalculatorError, evaluateExpression, formatResult, tryEvaluateExpression } from '../../services/calculator';

import ModalShell from '../ModalShell';

interface CalculatorModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

const HISTORY_KEY = 'omni.calculator.history';
const HISTORY_LIMIT = 24;

interface HistoryEntry {
  expression: string;
  result: string;
}

interface KeyDef {
  label: string;
  insert?: string;
  action?: 'clear' | 'back' | 'equals';
  tone?: 'action' | 'accent';
}

/** What each key inserts; `C`, `⌫` and `=` are actions, not text. */
const KEYS: KeyDef[] = [
  { label: 'C', action: 'clear', tone: 'action' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '⌫', action: 'back', tone: 'action' },
  { label: '^', insert: '^' },
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '÷', insert: '÷', tone: 'accent' },
  { label: '√', insert: 'sqrt(' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '×', insert: '×', tone: 'accent' },
  { label: '!', insert: '!' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '−', insert: '−', tone: 'accent' },
  { label: 'π', insert: 'pi' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '%', insert: '%' },
  { label: '+', insert: '+', tone: 'accent' },
  { label: '=', action: 'equals', tone: 'accent' },
];

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.expression !== 'string' || typeof record.result !== 'string') return [];
      return [{ expression: record.expression, result: record.result }];
    });
  } catch {
    return [];
  }
}

const keyClasses = (key: KeyDef): string => {
  if (key.tone === 'accent') return 'bg-amber-400 text-black border-amber-300 hover:bg-amber-300';
  if (key.tone === 'action') return 'bg-white/10 text-white border-white/20 hover:bg-white/20';
  return 'bg-white/5 text-white border-white/10 hover:bg-white/15';
};

/**
 * The built-in calculator. Keystrokes go through one handler instead of the
 * input caret, so the keypad, the physical keyboard and a paste all produce the
 * same well-formed expression, and nothing is ever handed to `eval`.
 */
export const CalculatorModal: React.FC<CalculatorModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);
  const [expression, setExpression] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);

  const preview = expression.trim() ? tryEvaluateExpression(expression) : null;

  const commit = useCallback(
    (value: string) => {
      if (!value.trim()) return;
      try {
        const text = formatResult(evaluateExpression(value));
        setError(null);
        setExpression(text);
        setHistory((previous) => {
          const next = [{ expression: value, result: text }, ...previous].slice(0, HISTORY_LIMIT);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
          } catch {
            // A disabled storage only costs the history, not the calculation.
          }
          return next;
        });
      } catch (caught) {
        const reason = caught instanceof CalculatorError ? caught.reason : 'invalid';
        setError(reason === 'division-by-zero' ? t.calcDivisionByZero : t.calcInvalidExpression);
      }
    },
    [t.calcDivisionByZero, t.calcInvalidExpression],
  );

  const press = useCallback(
    (key: KeyDef) => {
      soundManager.playKeyTick();
      if (key.action === 'clear') {
        setExpression('');
        setError(null);
        return;
      }
      if (key.action === 'back') {
        setExpression((previous) => previous.slice(0, -1));
        setError(null);
        return;
      }
      if (key.action === 'equals') {
        commit(expression);
        return;
      }
      setError(null);
      setExpression((previous) => `${previous}${key.insert ?? ''}`);
    },
    [commit, expression],
  );

  // The physical keyboard drives the same key handling, so the number pad, the
  // main row and the operator column all behave like the buttons.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const { key } = event;
      if (key === 'Enter' || key === '=') {
        event.preventDefault();
        commit(expression);
        return;
      }
      if (key === 'Backspace') {
        event.preventDefault();
        setExpression((previous) => previous.slice(0, -1));
        return;
      }
      if (key === 'Escape') return;
      if (/^[0-9+\-*/().%^!]$/.test(key)) {
        event.preventDefault();
        setError(null);
        setExpression((previous) => `${previous}${key}`);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [commit, expression]);

  const clearHistory = () => {
    soundManager.playKeyTick();
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Nothing to do: the list is already gone from the screen.
    }
  };

  return (
    <ModalShell title={t.toolCalculator} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div className="flex flex-col gap-[var(--space-3)] font-mono sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="rounded border border-white/15 bg-black/40 p-[var(--space-3)] text-right">
            <div className="min-h-6 break-all text-lg text-white" aria-live="polite">
              {expression || '0'}
            </div>
            <div className="mt-[var(--space-1)] min-h-5 text-xs">
              {error ? (
                <span className="text-red-400">{error}</span>
              ) : preview !== null ? (
                <span className="text-emerald-300">= {formatResult(preview)}</span>
              ) : (
                '\u00a0'
              )}
            </div>
          </div>

          <div className="mt-[var(--space-2)] grid grid-cols-5 gap-[var(--space-1)]">
            {KEYS.map((key) => (
              <button
                key={key.label}
                onClick={() => press(key)}
                className={`cursor-pointer rounded border py-[var(--space-2)] text-sm font-bold transition-colors ${keyClasses(key)}`}
              >
                {key.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex w-full flex-col sm:w-60">
          <div className="mb-[var(--space-1)] flex items-center justify-between text-xs opacity-80">
            <span className="flex items-center gap-[var(--space-1)]">
              <History className="h-3 w-3" /> {t.calcHistory}
            </span>
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="flex cursor-pointer items-center gap-[var(--space-1)] hover:text-red-300"
                title={t.calcClearHistory}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="min-h-28 flex-1 overflow-y-auto rounded border border-white/15 bg-black/30 p-[var(--space-1)] text-xs">
            {history.length === 0 ? (
              <p className="p-[var(--space-1)] opacity-60">{t.calcNoHistory}</p>
            ) : (
              history.map((entry, index) => (
                <button
                  key={`${entry.expression}-${index}`}
                  onClick={() => {
                    soundManager.playKeyTick();
                    setExpression(entry.result);
                    setError(null);
                  }}
                  className="w-full cursor-pointer rounded px-[var(--space-1)] py-0.5 text-right hover:bg-white/10"
                  title={t.calcReuse}
                >
                  <span className="block truncate opacity-60">{entry.expression}</span>
                  <span className="block truncate text-emerald-300">= {entry.result}</span>
                </button>
              ))
            )}
          </div>
          <p className="mt-[var(--space-2)] text-[10px] leading-snug opacity-60">{t.calcKeyboardHint}</p>
        </div>
      </div>
    </ModalShell>
  );
};
