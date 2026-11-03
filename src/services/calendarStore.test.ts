import { describe, it, expect } from 'vitest';
import {
  CALENDAR_STORAGE_KEY,
  addMonths,
  countByDate,
  eventsForDate,
  isoDate,
  loadEvents,
  makeEvent,
  monthMatrix,
  parseIsoDate,
  removeEvent,
  saveEvents,
  upsertEvent,
  type CalendarEvent,
} from './calendarStore';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('calendar store', () => {
  it('formats local dates without the UTC shift', () => {
    expect(isoDate(new Date(2026, 10, 3))).toBe('2026-11-03');
    expect(isoDate(new Date(2026, 0, 9))).toBe('2026-01-09');
    expect(parseIsoDate('2026-11-03').getDate()).toBe(3);
  });

  it('steps months across year boundaries', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
  });

  it('builds a six-week grid that starts on Monday', () => {
    // November 2026 starts on a Sunday, so the first row begins on 26 October.
    const weeks = monthMatrix(2026, 10);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe('2026-10-26');
    expect(weeks[0][6]).toBe('2026-11-01');
    expect(weeks[5][6]).toBe('2026-12-06');
    for (const week of weeks) {
      expect(parseIsoDate(week[0]).getDay()).toBe(1);
    }
  });

  it('sorts the events of a day by time, all-day entries last', () => {
    const events: CalendarEvent[] = [
      { id: 'c', date: '2026-11-03', time: '', title: 'Todo el día', notes: '' },
      { id: 'a', date: '2026-11-03', time: '18:00', title: 'Cena', notes: '' },
      { id: 'b', date: '2026-11-03', time: '09:30', title: 'Reunión', notes: '' },
      { id: 'd', date: '2026-11-04', time: '10:00', title: 'Otro día', notes: '' },
    ];
    expect(eventsForDate(events, '2026-11-03').map((event) => event.id)).toEqual(['b', 'a', 'c']);
    expect(countByDate(events)).toEqual({ '2026-11-03': 3, '2026-11-04': 1 });
  });

  it('adds, replaces and removes events by id', () => {
    const first = makeEvent('2026-11-03', 'Reunión', '09:30');
    expect(first.title).toBe('Reunión');
    let events = upsertEvent([], first);
    expect(events).toHaveLength(1);

    const edited = { ...first, title: 'Reunión movida' };
    events = upsertEvent(events, edited);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Reunión movida');

    expect(removeEvent(events, first.id)).toHaveLength(0);
  });

  it('round-trips events through storage', () => {
    const storage = new MemoryStorage();
    const event = makeEvent('2026-11-03', 'Cita', '12:00', 'nota');
    saveEvents([event], storage as unknown as Storage);
    expect(loadEvents(storage as unknown as Storage)).toEqual([event]);
  });

  it('drops corrupted or foreign entries instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(CALENDAR_STORAGE_KEY, '{not json');
    expect(loadEvents(storage as unknown as Storage)).toEqual([]);

    storage.setItem(
      CALENDAR_STORAGE_KEY,
      JSON.stringify([{ date: '2026-11-03' }, { date: 'nope', title: 'x' }, { date: '2026-11-04', title: 'ok' }]),
    );
    expect(loadEvents(storage as unknown as Storage).map((event) => event.title)).toEqual(['ok']);
  });

  it('returns an empty list when there is no storage at all', () => {
    expect(loadEvents(null)).toEqual([]);
  });
});
