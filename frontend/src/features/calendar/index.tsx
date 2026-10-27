"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import "../cases/styles.css";

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
const zone = "Asia/Kolkata";
function todayInZone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (key: string) =>
    Number(parts.find((part) => part.type === key)?.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}
function localKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function offsetIso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+05:30`;
}
function eventDate(event: Event) {
  return new Date(event.at || event.starts_at || event.date || "");
}
function eventList(data: unknown): Event[] {
  if (Array.isArray(data)) return data as Event[];
  if (
    data &&
    typeof data === "object" &&
    "items" in data &&
    Array.isArray((data as { items: unknown }).items)
  )
    return (data as { items: Event[] }).items;
  return [];
}
export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => todayInZone());
  const [view, setView] = useState<"Month" | "Week" | "Agenda">("Month");
  useEffect(() => {
    if (window.matchMedia("(max-width: 650px)").matches) setView("Agenda");
  }, []);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const firstDay =
    view === "Week"
      ? (() => {
          const d = new Date(cursor);
          d.setDate(d.getDate() - d.getDay());
          return d;
        })()
      : monthStart;
  const rangeStart = view === "Week" ? firstDay : monthStart;
  const rangeEnd =
    view === "Week"
      ? new Date(
          firstDay.getFullYear(),
          firstDay.getMonth(),
          firstDay.getDate() + 7,
        )
      : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const from = offsetIso(
    rangeStart.getFullYear(),
    rangeStart.getMonth() + 1,
    rangeStart.getDate(),
  );
  const to = offsetIso(
    rangeEnd.getFullYear(),
    rangeEnd.getMonth() + 1,
    rangeEnd.getDate(),
  );
  const q = useQuery({
    queryKey: ["calendar", from, to],
    queryFn: () =>
      api.get<unknown>(
        `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });
  const events = eventList(q.data);
  const days = useMemo(
    () =>
      view === "Week"
        ? Array.from(
            { length: 7 },
            (_, i) =>
              new Date(
                firstDay.getFullYear(),
                firstDay.getMonth(),
                firstDay.getDate() + i,
              ),
          )
        : Array.from(
            {
              length: new Date(
                cursor.getFullYear(),
                cursor.getMonth() + 1,
                0,
              ).getDate(),
            },
            (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1),
          ),
    [view, cursor, firstDay],
  );
  const today = localKey(new Date());
  const back = () =>
    setCursor(
      view === "Week"
        ? new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() - 7,
          )
        : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
    );
  const next = () =>
    setCursor(
      view === "Week"
        ? new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 7,
          )
        : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
    );
  const displayEvents = (day: Date) =>
    events.filter((event) => localKey(eventDate(event)) === localKey(day));
  const heading =
    view === "Week"
      ? `${firstDay.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: zone })} – ${new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 6).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: zone })}`
      : cursor.toLocaleDateString("en-IN", {
          month: "long",
          year: "numeric",
          timeZone: zone,
        });
  return (
    <section className="matter-wrap">
      <div className="matter-head">
        <div>
          <h1 className="matter-title">Calendar</h1>
          <p className="subheading">
            Hearings, deadlines and case events · Asia/Kolkata
          </p>
        </div>
        <button
          className="matter-action"
          onClick={() => setCursor(todayInZone())}
        >
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
          <div
            className="calendar-views"
            role="group"
            aria-label="Calendar view"
          >
            {(["Month", "Week", "Agenda"] as const).map((name) => (
              <button
                key={name}
                className={view === name ? "active" : ""}
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
            Calendar events are unavailable.{" "}
            <button onClick={() => void q.refetch()}>Retry</button>
          </div>
        ) : q.isLoading ? (
          <div className="matter-skeleton" />
        ) : view === "Agenda" ? (
          <div className="calendar-agenda" data-calendar-agenda-settled="true">
            {days.flatMap((day) => {
              const dated = displayEvents(day);
              return dated.length
                ? [
                    <section key={localKey(day)}>
                      <h2>
                        {day.toLocaleDateString("en-IN", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          timeZone: zone,
                        })}
                      </h2>
                      {dated.map((event) => (
                        <div className="calendar-agenda-row" key={event.id}>
                          <time>
                            {event.all_day
                              ? "All day"
                              : eventDate(event).toLocaleTimeString("en-IN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: zone,
                                })}
                          </time>
                          <span>
                            {event.title}
                            {event.case_title ? ` · ${event.case_title}` : ""}
                          </span>
                        </div>
                      ))}
                    </section>,
                  ]
                : [];
            })}
            {events.length === 0 && <p>No events in this period</p>}
          </div>
        ) : (
          <div className="calendar-grid" data-view={view}>
            {view === "Month" &&
              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <strong className="calendar-weekday" key={d}>
                  {d}
                </strong>
              ))}
            {view === "Month" &&
              Array.from({ length: monthStart.getDay() }, (_, i) => (
                <div className="calendar-blank" key={`blank-${i}`} />
              ))}
            {days.map((day) => {
              const isToday = localKey(day) === today;
              return (
                <div
                  className={`calendar-day${isToday ? " is-today" : ""}`}
                  data-calendar-day
                  key={localKey(day)}
                >
                  <span
                    className="calendar-date"
                    aria-label={
                      isToday
                        ? `${day.getDate()}, today`
                        : String(day.getDate())
                    }
                  >
                    {day.getDate()}
                    {isToday && <small>Today</small>}
                  </span>
                  {displayEvents(day).map((event) => (
                    <div className="calendar-event" key={event.id}>
                      <time>
                        {event.all_day
                          ? "All day"
                          : eventDate(event).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: zone,
                            })}
                      </time>{" "}
                      {event.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
