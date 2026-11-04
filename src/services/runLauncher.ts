import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * The "Ejecutar" box: what Windows' Run dialog does.
 *
 * The server owns the decision (it is the only side that can stat a path, hand a
 * target to the shell or start a process), so this module is a thin translation
 * layer between the routes' answers and the words the dialog shows. A folder
 * comes back as a path the panel navigates to; a document or a destination is
 * already open with its own program; a program is started, not previewed, which
 * is what one Enter means in the Run box.
 */
export type RunFailure =
  | 'not-found'
  | 'not-accessible'
  | 'unsupported-target'
  | 'invalid-target'
  | 'launch-failed'
  | 'unreachable'
  | 'program-not-found'
  | 'program-not-accessible'
  | 'elevation-denied';

/** One row of the autocomplete: a Start Menu shortcut, a Windows destination, or local memory. */
export interface RunSuggestion {
  /** What gets typed into the field: a shortcut path, or the destination itself. */
  value: string;
  /** Human name of the program, when it differs from the value. */
  label?: string;
  kind: 'app' | 'system' | 'favorite' | 'recent';
}

/**
 * What the Run box could complete to, for what has been typed so far.
 *
 * A failure here is silent on purpose: an autocomplete that cannot reach the
 * local server must not put an error under the field the user is typing in.
 */
export async function fetchRunSuggestions(query: string): Promise<RunSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/run/suggestions?q=${encodeURIComponent(trimmed)}`, {
      timeoutMs: 4000,
      retries: 0,
    });
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as { suggestions?: unknown } | null;
    if (!Array.isArray(body?.suggestions)) return [];
    return body.suggestions
      .filter((entry): entry is RunSuggestion => !!entry && typeof (entry as RunSuggestion).value === 'string')
      .map((entry) => ({
        value: entry.value,
        label: typeof entry.label === 'string' && entry.label ? entry.label : undefined,
        kind: entry.kind === 'app' ? 'app' : 'system',
      }));
  } catch {
    return [];
  }
}

export type RunResult =
  { kind: 'folder'; path: string } | { kind: 'opened'; target: string } | { kind: 'error'; reason: RunFailure };

/** Route status to the reason the dialog words its message with. */
const STATUS_REASONS: Record<number, RunFailure> = {
  400: 'invalid-target',
  403: 'not-accessible',
  404: 'not-found',
  422: 'unsupported-target',
  502: 'launch-failed',
};

/** Same, for the route that starts a program. */
const RUN_STATUS_REASONS: Record<number, RunFailure> = {
  400: 'invalid-target',
  403: 'program-not-accessible',
  404: 'program-not-found',
  502: 'launch-failed',
};

/**
 * The reason for a refused request: the body can name one the status alone does
 * not carry (a refused UAC prompt is a 403 that is not a permissions problem),
 * so the body wins when it knows more.
 */
const reasonFor = (status: number, body: unknown, fallback: RunFailure): RunFailure =>
  (body as { error?: unknown } | null)?.error === 'elevation-denied'
    ? 'elevation-denied'
    : (RUN_STATUS_REASONS[status] ?? fallback);

/** Result of a confirmed launch. */
export type RunLaunch = { kind: 'launched'; argv: string[] } | { kind: 'error'; reason: RunFailure; program?: string };

async function postRun(body: { command: string; confirmed?: boolean; elevated?: boolean }) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 15000,
      // A retried launch would start the program twice.
      retries: 0,
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Starts a program. The server resolves the line first, so a name this machine
 * does not know comes back as a refusal naming that word instead of a generic
 * failure, and what it starts is the line that was typed.
 */
export async function runCommand(command: string, elevated = false): Promise<RunLaunch> {
  const answer = await postRun(elevated ? { command, confirmed: true, elevated: true } : { command, confirmed: true });
  if (!answer) return { kind: 'error', reason: 'unreachable' };
  if (answer.status === 200) {
    const argv = answer.body?.argv;
    return { kind: 'launched', argv: Array.isArray(argv) ? argv.map(String) : [] };
  }
  return {
    kind: 'error',
    reason: reasonFor(answer.status, answer.body, 'launch-failed'),
    program: typeof answer.body?.program === 'string' ? answer.body.program : undefined,
  };
}

export async function openRunTarget(target: string): Promise<RunResult> {
  let response: Response;
  try {
    response = await fetchWithRetry(`${API_BASE}/api/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
      timeoutMs: 15000,
      // Launching is not idempotent: a retried request would open a second window.
      retries: 0,
    });
  } catch {
    return { kind: 'error', reason: 'unreachable' };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) return { kind: 'error', reason: STATUS_REASONS[response.status] ?? 'launch-failed' };
  if (body?.kind === 'folder' && typeof body.path === 'string') return { kind: 'folder', path: body.path };
  if (body?.kind === 'opened') {
    const opened = typeof body.path === 'string' ? body.path : String(body.target || target);
    return { kind: 'opened', target: opened };
  }
  return { kind: 'error', reason: 'unreachable' };
}

/** Translation key of the sentence that explains one example. */
export type RunExampleKey =
  | 'helpRunExampleFolders'
  | 'helpRunExampleFiles'
  | 'helpRunExamplePrograms'
  | 'helpRunExampleServices'
  | 'helpRunExampleCommands'
  | 'helpRunExampleDestinations'
  | 'helpRunExampleWeb';

/** One row of "what this field accepts". */
export interface RunExampleRow {
  /**
   * What is typed, in the words of Windows: it is not translated. Each entry is
   * one separate example, because the launcher fills the field from a single one.
   */
  examples: string[];
  /** Which sentence explains them. */
  descriptionKey: RunExampleKey;
}

/**
 * The examples behind the field, shared by the launcher's own card and by the
 * help manual: one list, so the two places cannot drift apart.
 */
export const RUN_EXAMPLE_ROWS: RunExampleRow[] = [
  { examples: ['C:\\Users', 'temp', 'prefetch'], descriptionKey: 'helpRunExampleFolders' },
  { examples: ['C:\\notas.txt'], descriptionKey: 'helpRunExampleFiles' },
  { examples: ['notepad', 'google chrome'], descriptionKey: 'helpRunExamplePrograms' },
  { examples: ['services.msc', 'appwiz.cpl'], descriptionKey: 'helpRunExampleServices' },
  { examples: ['cmd /c dir', 'notepad %TEMP%'], descriptionKey: 'helpRunExampleCommands' },
  { examples: ['ms-settings:display', 'shell:startup'], descriptionKey: 'helpRunExampleDestinations' },
  { examples: ['google.com', 'https://freebuff.com'], descriptionKey: 'helpRunExampleWeb' },
];

const HISTORY_KEY = 'omni-run-history';
export const RUN_HISTORY_LIMIT = 8;

/**
 * The Run box recalls what was typed, and so does this one. Only successful
 * targets are stored: an entry in the history is an entry that did something,
 * which is what makes recalling it worth a keystroke.
 */
export function loadRunHistory(storage: Pick<Storage, 'getItem'> | null = globalStorage()): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      .slice(0, RUN_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function rememberRunTarget(
  target: string,
  history: string[],
  storage: Pick<Storage, 'setItem'> | null = globalStorage(),
): string[] {
  const cleaned = target.trim();
  if (!cleaned) return history;
  const next = [cleaned, ...history.filter((entry) => entry.toLowerCase() !== cleaned.toLowerCase())].slice(
    0,
    RUN_HISTORY_LIMIT,
  );
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled storage costs the user the history, never the launch.
  }
  return next;
}

const FAVORITES_KEY = 'omni-run-favorites';
export const RUN_FAVORITES_LIMIT = 8;

/**
 * Favourites are a short list the user pins by hand, kept next to the history
 * because they are the same kind of thing: what this box has been pointed at.
 */
export function loadRunFavorites(storage: Pick<Storage, 'getItem'> | null = globalStorage()): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(FAVORITES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      .slice(0, RUN_FAVORITES_LIMIT);
  } catch {
    return [];
  }
}

/** Every edit of the list follows the same write path, including its failure. */
function saveRunFavorites(favorites: string[], storage: Pick<Storage, 'setItem'> | null): string[] {
  try {
    storage?.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // Same as the history: storage trouble must not break the box.
  }
  return favorites;
}

/** Drops a favourite, matched without regard to case. */
export function removeRunFavorite(
  target: string,
  favorites: string[],
  storage: Pick<Storage, 'setItem'> | null = globalStorage(),
): string[] {
  const key = target.trim().toLowerCase();
  if (!key) return favorites;
  return saveRunFavorites(
    favorites.filter((entry) => entry.toLowerCase() !== key),
    storage,
  );
}

/**
 * Moves a favourite one place up (-1) or down (1) in the stored order, which is
 * the order the list shows. An edge is not an error: the list stays as it was,
 * so a repeated click never moves something the user did not mean to move.
 */
export function moveRunFavorite(
  target: string,
  offset: -1 | 1,
  favorites: string[],
  storage: Pick<Storage, 'setItem'> | null = globalStorage(),
): string[] {
  const key = target.trim().toLowerCase();
  const index = favorites.findIndex((entry) => entry.toLowerCase() === key);
  const destination = index + offset;
  if (index === -1 || destination < 0 || destination >= favorites.length) return favorites;
  const next = [...favorites];
  [next[index], next[destination]] = [next[destination], next[index]];
  return saveRunFavorites(next, storage);
}

/** Pins the target if it is not pinned yet, and unpins it if it is. */
export function toggleRunFavorite(
  target: string,
  favorites: string[],
  storage: Pick<Storage, 'setItem'> | null = globalStorage(),
): string[] {
  const cleaned = target.trim();
  if (!cleaned) return favorites;
  const already = favorites.some((entry) => entry.toLowerCase() === cleaned.toLowerCase());
  const next = already
    ? favorites.filter((entry) => entry.toLowerCase() !== cleaned.toLowerCase())
    : [cleaned, ...favorites].slice(0, RUN_FAVORITES_LIMIT);
  try {
    storage?.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // Same as the history: storage trouble must not break the box.
  }
  return next;
}

function globalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
