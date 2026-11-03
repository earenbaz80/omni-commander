/**
 * Storage and date arithmetic for the built-in calendar.
 *
 * Events live in the renderer's localStorage: the calendar is a personal tool,
 * so it must not write into the user's folders, and it must survive a restart
 * without a server round trip. Everything here is pure except the two storage
 * helpers, which take the storage object as a parameter so the tests can hand in
 * a fake.
 */

export interface CalendarEvent {
  id: string;
  /** Local calendar day, `YYYY-MM-DD`; never a UTC timestamp, which would shift the day. */
  date: string;
  /** `HH:MM`, empty for an all-day entry. */
  time: string;
  title: string;
  notes: string;
}

export const CALENDAR_STORAGE_KEY = 'omni.calendar.events';

/** A month view always shows six weeks so the grid never jumps in height. */
export const WEEKS_IN_VIEW = 6;

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for a local date, without the UTC shift `toISOString` applies. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoDateFor(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export interface MonthStep {
  year: number;
  /** Zero-based, as `Date` uses. */
  month: number;
}

export function addMonths({ year, month }: MonthStep, delta: number): MonthStep {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * The six-by-seven grid of ISO dates for a month, weeks starting on Monday.
 * Days outside the month are included so the first and last week are complete.
 */
export function monthMatrix(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  // getDay() is 0 for Sunday; the grid starts on Monday, so Sunday becomes 6.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: string[][] = [];
  for (let week = 0; week < WEEKS_IN_VIEW; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      days.push(isoDate(current));
    }
    weeks.push(days);
  }
  return weeks;
}

export function isSameMonth(iso: string, year: number, month: number): boolean {
  const date = parseIsoDate(iso);
  return date.getFullYear() === year && date.getMonth() === month;
}

export function eventsForDate(events: CalendarEvent[], iso: string): CalendarEvent[] {
  return events
    .filter((event) => event.date === iso)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title));
}

/** One event per day for the little dot the grid shows under a date. */
export function countByDate(events: CalendarEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.date] = (counts[event.date] || 0) + 1;
  return counts;
}

export function makeEvent(date: string, title: string, time = '', notes = ''): CalendarEvent {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${date}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, date, time, title: title.trim(), notes };
}

export function upsertEvent(events: CalendarEvent[], event: CalendarEvent): CalendarEvent[] {
  const index = events.findIndex((candidate) => candidate.id === event.id);
  if (index < 0) return [...events, event];
  const next = [...events];
  next[index] = event;
  return next;
}

export function removeEvent(events: CalendarEvent[], id: string): CalendarEvent[] {
  return events.filter((event) => event.id !== id);
}

/**
 * Reads the stored events. A corrupted entry must not take the calendar down, so
 * anything that does not look like an event is dropped instead of thrown.
 */
export function loadEvents(storage?: Storage | null): CalendarEvent[] {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(CALENDAR_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const date = typeof record.date === 'string' ? record.date : '';
      const title = typeof record.title === 'string' ? record.title : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title.trim()) return [];
      return [
        {
          id: typeof record.id === 'string' && record.id ? record.id : `${date}-${title}`,
          date,
          time: typeof record.time === 'string' ? record.time : '',
          title,
          notes: typeof record.notes === 'string' ? record.notes : '',
        },
      ];
    });
  } catch {
    return [];
  }
}

export function saveEvents(events: CalendarEvent[], storage?: Storage | null): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return;
  try {
    store.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // A full or disabled storage must not break the dialog; the app keeps the
    // events in memory for this session.
  }
}
