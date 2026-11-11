import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import {
  addMonths,
  countByDate,
  eventsForDate,
  isoDate,
  isSameMonth,
  loadEvents,
  makeEvent,
  monthMatrix,
  parseIsoDate,
  removeEvent,
  saveEvents,
  upsertEvent,
  type CalendarEvent,
  type MonthStep,
} from '../../services/calendarStore';

import ModalShell from '../ModalShell';

interface CalendarModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

const LOCALES: Record<LanguageCode, string> = {
  es: 'es-ES',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  pt: 'pt-PT',
  it: 'it-IT',
  ru: 'ru-RU',
  ja: 'ja-JP',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Weekday headers, taken from a week that really starts on Monday. */
function weekdayLabels(locale: string): string[] {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(monday.getTime() + index * DAY_MS)),
  );
}

/**
 * The built-in calendar. It is a personal tool, so its events live in
 * localStorage instead of a file in the user's folders: nothing appears in the
 * panels and closing the app never leaves a calendar file behind.
 */
export const CalendarModal: React.FC<CalendarModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);
  const locale = LOCALES[lang] ?? 'es-ES';
  const today = useMemo(() => isoDate(new Date()), []);
  const [view, setView] = useState<MonthStep>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>(loadEvents);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTime, setDraftTime] = useState('');

  useEffect(() => {
    saveEvents(events);
  }, [events]);

  const weeks = useMemo(() => monthMatrix(view.year, view.month), [view.year, view.month]);
  const counts = useMemo(() => countByDate(events), [events]);
  const dayEvents = useMemo(() => eventsForDate(events, selected), [events, selected]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(view.year, view.month, 1)),
    [locale, view.year, view.month],
  );
  const selectedLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
        parseIsoDate(selected),
      ),
    [locale, selected],
  );
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const step = (delta: number) => {
    soundManager.playKeyTick();
    setView((current) => addMonths(current, delta));
  };

  const goToday = () => {
    soundManager.playKeyTick();
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(today);
  };

  const addEvent = () => {
    const title = draftTitle.trim();
    if (!title) return;
    soundManager.playKeyTick();
    setEvents((previous) => upsertEvent(previous, makeEvent(selected, title, draftTime)));
    setDraftTitle('');
    setDraftTime('');
  };

  const deleteEvent = (id: string) => {
    soundManager.playKeyTick();
    setEvents((previous) => removeEvent(previous, id));
  };

  return (
    <ModalShell title={t.toolCalendar} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div className="flex flex-col gap-[var(--space-4)] font-mono lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-2)]">
            <div className="flex items-center gap-[var(--space-1)]">
              <button
                onClick={() => step(-1)}
                aria-label={t.calendarPreviousMonth}
                className="cursor-pointer rounded border border-white/15 bg-white/5 p-[var(--space-1)] hover:bg-white/15"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => step(1)}
                aria-label={t.calendarNextMonth}
                className="cursor-pointer rounded border border-white/15 bg-white/5 p-[var(--space-1)] hover:bg-white/15"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <span className="text-sm font-bold capitalize">{monthLabel}</span>
            <button
              onClick={goToday}
              className="cursor-pointer rounded border border-amber-300 bg-amber-400 px-[var(--space-2)] py-[var(--space-1)] text-xs font-bold text-black hover:bg-amber-300"
            >
              {t.calendarToday}
            </button>
          </div>

          <div className="grid grid-cols-7 gap-[2px] text-center text-[11px] uppercase opacity-70">
            {weekdays.map((label) => (
              <span key={label} className="py-[var(--space-1)]">
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-[2px]">
            {weeks.flat().map((iso) => {
              const inMonth = isSameMonth(iso, view.year, view.month);
              const isToday = iso === today;
              const isSelected = iso === selected;
              const count = counts[iso] || 0;
              return (
                <button
                  key={iso}
                  onClick={() => {
                    soundManager.playKeyTick();
                    setSelected(iso);
                    if (!inMonth) {
                      const date = parseIsoDate(iso);
                      setView({ year: date.getFullYear(), month: date.getMonth() });
                    }
                  }}
                  className={`relative flex h-12 cursor-pointer flex-col items-center justify-center rounded border text-xs transition-colors ${
                    isSelected
                      ? 'border-amber-300 bg-amber-400/25 font-bold text-white'
                      : isToday
                        ? 'border-cyan-400/70 bg-cyan-400/10 text-white'
                        : inMonth
                          ? 'border-white/10 bg-white/5 text-white hover:bg-white/15'
                          : 'border-transparent text-white/35 hover:bg-white/10'
                  }`}
                >
                  <span>{Number(iso.slice(8, 10))}</span>
                  {count > 0 && (
                    <span className="mt-0.5 flex gap-[2px]" aria-hidden="true">
                      {Array.from({ length: Math.min(count, 3) }, (_, index) => (
                        <span key={index} className="h-1 w-1 rounded-full bg-emerald-400" />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-full flex-col lg:w-72">
          <div className="mb-[var(--space-1)] flex items-center gap-[var(--space-1)] text-xs font-bold capitalize">
            <CalendarDays className="h-3.5 w-3.5" /> {selectedLabel}
          </div>

          <div className="mb-[var(--space-2)] max-h-48 min-h-24 flex-1 overflow-y-auto rounded border border-white/15 bg-black/30 p-[var(--space-1)] text-xs">
            {dayEvents.length === 0 ? (
              <p className="p-[var(--space-1)] opacity-60">{t.calendarNoEvents}</p>
            ) : (
              dayEvents.map((event) => (
                <div
                  key={event.id}
                  className="mb-[2px] flex items-center justify-between gap-[var(--space-1)] rounded px-[var(--space-1)] py-1 hover:bg-white/10"
                >
                  <span className="min-w-0 truncate">
                    {event.time && <span className="mr-[var(--space-1)] text-amber-300">{event.time}</span>}
                    <span className="text-white">{event.title}</span>
                  </span>
                  <button
                    onClick={() => deleteEvent(event.id)}
                    aria-label={t.calendarDeleteEvent}
                    title={t.calendarDeleteEvent}
                    className="shrink-0 cursor-pointer rounded p-[2px] nc-danger-ink hover:nc-danger-surface-strong"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-[var(--space-1)]">
            <input
              type="time"
              value={draftTime}
              onChange={(event) => setDraftTime(event.target.value)}
              className="rounded border border-white/15 bg-black/30 px-[var(--space-2)] py-[var(--space-1)] text-xs text-white"
              aria-label={t.calendarTime}
            />
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addEvent();
              }}
              placeholder={t.calendarEventTitle}
              aria-label={t.calendarEventTitle}
              className="rounded border border-white/15 bg-black/30 px-[var(--space-2)] py-[var(--space-1)] text-xs text-white placeholder:text-white/40"
            />
            <button
              onClick={addEvent}
              disabled={!draftTitle.trim()}
              className="flex cursor-pointer items-center justify-center gap-[var(--space-1)] rounded border border-amber-300 bg-amber-400 px-[var(--space-2)] py-[var(--space-1)] text-xs font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> {t.calendarAddEvent}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
