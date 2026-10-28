'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import '../cases/styles.css';

type Event = {
  id: string;
  title: string;
  at?: string;
  starts_at?: string;
  date?: string;
  type?: string;
  case_title?: string;
  case_id?: string;
  all_day?: boolean;
};
const eventLabels: Record<string, string> = {
  all_day_event: 'All-day event',
  first_hearing: 'First hearing',
  hearing_completed: 'Hearing completed',
};
function eventLabel(event: Event) {
  return (
    eventLabels[event.type || ''] ||
    eventLabels[event.title] ||
    (event.title || 'Case event').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
function isAllDay(event: Event) {
  return event.all_day === true || event.type === 'all_day_event' || event.title === 'all_day_event';
}
const zone = 'Asia/Kolkata';
function todayInZone() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (key: string) => Number(parts.find((part) => part.type === key)?.value);
  return new Date(get('year'), get('month') - 1, get('day'));
}
function localKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
function offsetIso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`;
}
function eventDate(event: Event) {
  return new Date(event.at || event.starts_at || event.date || '');
}
function eventList(data: unknown): Event[] {
  if (Array.isArray(data)) return data as Event[];
  if (
    data &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as { items: unknown }).items)
  )
    return (data as { items: Event[] }).items;
  return [];
}
export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => todayInZone());
  const [view, setView] = useState<'Month' | 'Week' | 'Agenda'>('Month');
  const [agendaPage, setAgendaPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  useEffect(() => {
    if (window.matchMedia('(max-width: 650px)').matches) setView('Agenda');
  }, []);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const firstDay =
    view === 'Week'
      ? (() => {
          const d = new Date(cursor);
          d.setDate(d.getDate() - d.getDay());
          return d;
        })()
      : monthStart;
  const rangeStart = view === 'Week' ? firstDay : monthStart;
  const rangeEnd =
    view === 'Week'
      ? new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 7)
      : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const from = offsetIso(rangeStart.getFullYear(), rangeStart.getMonth() + 1, rangeStart.getDate());
  const to = offsetIso(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, rangeEnd.getDate());
  const q = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () =>
      api.get<unknown>(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  });
  const casesQuery = useQuery({
    queryKey: ['calendar-case-titles'],
    queryFn: () => api.get<{ items: Array<{ id: string; title: string }> }>('/cases?page_size=100'),
  });
  const events = eventList(q.data);
  const caseTitles = new Map((casesQuery.data?.items || []).map((item) => [item.id, item.title]));
  useEffect(() => setAgendaPage(0), [cursor, view]);
  const days = useMemo(
    () =>
      view === 'Week'
        ? Array.from(
            { length: 7 },
            (_, i) => new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i),
          )
        : Array.from(
            {
              length: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate(),
            },
            (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1),
          ),
    [view, cursor, firstDay],
  );
  const today = localKey(new Date());
  const back = () =>
    setCursor(
      view === 'Week'
        ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7)
        : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
    );
  const next = () =>
    setCursor(
      view === 'Week'
        ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
        : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
    );
  const displayEvents = (day: Date) => events.filter((event) => localKey(eventDate(event)) === localKey(day));
  const datedDays = days.filter((day) => displayEvents(day).length > 0);
  const agendaPages = Math.max(1, Math.ceil(datedDays.length / 7));
  const visibleAgendaDays = datedDays.slice(agendaPage * 7, agendaPage * 7 + 7);
  const heading =
    view === 'Week'
      ? `${firstDay.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: zone })} – ${new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 6).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone })}`
      : cursor.toLocaleDateString('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: zone,
        });
  return (
    <section className="matter-wrap">
      <div className="matter-head">
        <div>
          <h1 className="matter-title">Calendar</h1>
          <p className="subheading">Hearings, deadlines and case events · Asia/Kolkata</p>
        </div>
        <button className="matter-action" onClick={() => setCursor(todayInZone())}>
          Today
        </button>
      </div>
      <div className="matter-card" data-calendar-settled={!q.isLoading}>
        <div className="calendar-toolbar">
          <div className="calendar-nav">
            <button aria-label="Previous period" onClick={back}>
              ‹
            </button>
            <strong>{heading}</strong>
            <button aria-label="Next period" onClick={next}>
              ›
            </button>
          </div>
          <div className="calendar-views" role="group" aria-label="Calendar view">
            {(['Month', 'Week', 'Agenda'] as const).map((name) => (
              <button
                key={name}
                className={view === name ? 'active' : ''}
                aria-pressed={view === name}
                onClick={() => setView(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        {q.isError ? (
          <div className="matter-error">
            Calendar events are unavailable. <button onClick={() => void q.refetch()}>Retry</button>
          </div>
        ) : q.isLoading ? (
          <div className="matter-skeleton" />
        ) : view === 'Agenda' ? (
          <div className="calendar-agenda" data-calendar-agenda-settled="true">
            {visibleAgendaDays.map((day) => {
              const dated = displayEvents(day);
              return (
                <section key={localKey(day)}>
                  <h2>
                    {day.toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      timeZone: zone,
                    })}
                  </h2>
                  {dated.map((event) => (
                    <button
                      className="calendar-agenda-row"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      aria-label={`View ${isAllDay(event) ? 'All-day event' : eventLabel(event)}`}
                    >
                      {!isAllDay(event) && (
                        <time>
                          {eventDate(event).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: zone,
                          })}
                        </time>
                      )}
                      <span>
                        {eventLabel(event)}
                        {event.case_title || caseTitles.get(event.case_id || '')
                          ? ` · ${event.case_title || caseTitles.get(event.case_id || '')}`
                          : ''}
                      </span>
                    </button>
                  ))}
                </section>
              );
            })}
            {events.length === 0 && <p>No events in this period</p>}
            {datedDays.length > 7 && (
              <nav className="calendar-agenda-pages" aria-label="Agenda pages">
                <button disabled={agendaPage === 0} onClick={() => setAgendaPage((p) => p - 1)}>
                  Previous days
                </button>
                <span>
                  Days {agendaPage * 7 + 1}–{Math.min((agendaPage + 1) * 7, datedDays.length)} of{' '}
                  {datedDays.length}
                </span>
                <button disabled={agendaPage + 1 >= agendaPages} onClick={() => setAgendaPage((p) => p + 1)}>
                  Next days
                </button>
              </nav>
            )}
          </div>
        ) : (
          <div className="calendar-grid" data-view={view}>
            {view === 'Month' &&
              ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <strong className="calendar-weekday" key={d}>
                  {d}
                </strong>
              ))}
            {view === 'Month' &&
              Array.from({ length: monthStart.getDay() }, (_, i) => (
                <div className="calendar-blank" key={`blank-${i}`} />
              ))}
            {days.map((day) => {
              const isToday = localKey(day) === today;
              return (
                <div
                  className={`calendar-day${isToday ? ' is-today' : ''}`}
                  data-calendar-day
                  key={localKey(day)}
                >
                  <span
                    className="calendar-date"
                    aria-label={isToday ? `${day.getDate()}, today` : String(day.getDate())}
                  >
                    {day.getDate()}
                    {isToday && <small>Today</small>}
                  </span>
                  {displayEvents(day).map((event) => (
                    <button
                      className="calendar-event"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      aria-label={`View ${isAllDay(event) ? 'All-day event' : eventLabel(event)}`}
                    >
                      {!isAllDay(event) && (
                        <time>
                          {eventDate(event).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: zone,
                          })}
                        </time>
                      )}
                      {!isAllDay(event) && ' '}
                      {eventLabel(event)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {selectedEvent && (
          <div className="calendar-event-detail" role="dialog" aria-label="Event details">
            <button
              className="calendar-event-close"
              aria-label="Close event details"
              onClick={() => setSelectedEvent(null)}
            >
              ×
            </button>
            <h2>{eventLabel(selectedEvent)}</h2>
            <p>{selectedEvent.case_title || caseTitles.get(selectedEvent.case_id || '') || 'Case event'}</p>
            <p>
              {isAllDay(selectedEvent)
                ? 'All-day'
                : eventDate(selectedEvent).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: zone,
                  })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
