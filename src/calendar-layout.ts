import { DateTime } from "luxon";

export type CalendarMode = "day" | "week" | "month";
export type CalendarEvent = {
  id: string;
  sourceName: string;
  color: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  calendarId?: string;
  eventId?: string;
  writable?: boolean;
};

// Hours shown without scrolling: the waking day, widened to fit events.
export function visibleHours(events: CalendarEvent[], days: DateTime[]) {
  let first = 7;
  let last = 23;
  for (const day of days)
    for (const { top, bottom } of timedLayout(events, day)) {
      first = Math.min(first, Math.floor(top / 60));
      last = Math.max(last, Math.ceil(bottom / 60));
    }
  return { first, last };
}

export function calendarRange(anchor: DateTime, mode: CalendarMode) {
  const first = anchor.startOf(
    mode === "month" ? "month" : mode === "week" ? "week" : "day",
  );
  const end = first.plus(
    mode === "month" ? { months: 1 } : { days: mode === "week" ? 7 : 1 },
  );
  // Month includes complete Monday–Sunday rows, including adjacent months.
  const from = mode === "month" ? first.startOf("week") : first;
  const to =
    mode === "month"
      ? end.minus({ days: 1 }).endOf("week").plus({ milliseconds: 1 })
      : end;
  const days: DateTime[] = [];
  for (let day = from; day < to; day = day.plus({ days: 1 })) days.push(day);
  return { from, to, days };
}

export function eventTouchesDay(event: CalendarEvent, day: DateTime) {
  if (event.allDay)
    return event.start <= day.toISODate()! && event.end > day.toISODate()!;
  const start = DateTime.fromISO(event.start);
  const end = DateTime.fromISO(event.end);
  return (
    start < day.plus({ days: 1 }) && (end > start ? end > day : start >= day)
  );
}

// Pack overlapping events into separate columns; clip overnight events to this day.
export function timedLayout(events: CalendarEvent[], day: DateTime) {
  const minutes = (d: DateTime) => d.hour * 60 + d.minute + d.second / 60;
  const entries = events
    .filter((e) => !e.allDay && eventTouchesDay(e, day))
    .map((event) => {
      const start = DateTime.fromISO(event.start).setZone(day.zone);
      const end = DateTime.fromISO(event.end).setZone(day.zone);
      const top = start < day ? 0 : minutes(start);
      const bottom = end >= day.plus({ days: 1 }) ? 1440 : minutes(end);
      return {
        event,
        top,
        bottom: Math.min(1440, Math.max(top + 24, bottom)),
        column: 0,
        columns: 1,
      };
    })
    .sort(
      (a, b) =>
        a.top - b.top ||
        b.bottom - a.bottom ||
        a.event.id.localeCompare(b.event.id),
    );
  let group: typeof entries = [];
  let edges: number[] = [];
  let until = -1;
  const finish = () => {
    for (const e of group) e.columns = edges.length;
  };
  for (const entry of entries) {
    if (entry.top >= until) {
      finish();
      group = [];
      edges = [];
    }
    const free = edges.findIndex((end) => end <= entry.top);
    entry.column = free < 0 ? edges.length : free;
    edges[entry.column] = entry.bottom;
    group.push(entry);
    until = Math.max(...edges);
  }
  finish();
  return entries;
}
