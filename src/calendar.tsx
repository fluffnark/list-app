import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  LogIn,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api, apiRoot } from "./db";
import { calendarDate, isActive, type Item } from "../shared/model";

import {
  calendarRange,
  eventTouchesDay,
  timedLayout,
  visibleHours,
  type CalendarEvent,
  type CalendarMode,
} from "./calendar-layout";

type EventsResponse = {
  events: CalendarEvent[];
  errors: { source: string; message: string }[];
};
function readCache(key: string): EventsResponse | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
}
type Draft = {
  calendarId: string;
  eventId?: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
};
function draftFrom(event: CalendarEvent): Draft {
  const start = DateTime.fromISO(event.start);
  const end = DateTime.fromISO(event.end);
  const last = event.allDay ? end.minus({ days: 1 }) : end;
  return {
    calendarId: event.calendarId!,
    eventId: event.eventId,
    title: event.title === "(No title)" ? "" : event.title,
    allDay: event.allDay,
    startDate: start.toISODate()!,
    startTime: event.allDay ? "09:00" : start.toFormat("HH:mm"),
    endDate: (last < start ? start : last).toISODate()!,
    endTime: event.allDay ? "10:00" : end.toFormat("HH:mm"),
    location: event.location || "",
    description: event.description || "",
  };
}
function draftBody(d: Draft) {
  const at = (date: string, time: string) =>
    DateTime.fromISO(`${date}T${time}`).toISO({ suppressMilliseconds: true });
  return {
    title: d.title,
    allDay: d.allDay,
    start: d.allDay ? d.startDate : at(d.startDate, d.startTime),
    end: d.allDay
      ? DateTime.fromISO(d.endDate).plus({ days: 1 }).toISODate()
      : at(d.endDate, d.endTime),
    location: d.location,
    description: d.description,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
const focusable =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href]";

// All-day ends are exclusive; show the inclusive last day for multi-day events.
function allDayRange(start: string, end: string) {
  const first = DateTime.fromISO(start);
  const last = DateTime.fromISO(end).minus({ days: 1 });
  return last > first
    ? `${first.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")} · All day`
    : `${first.toFormat("d LLL yyyy")} · All day`;
}

export function CalendarView({
  items,
  signedIn,
  onOpen,
  onSettings,
}: {
  items: Item[];
  signedIn: boolean;
  onOpen: (id: string) => void;
  onSettings: () => void;
}) {
  const [mode, setMode] = useState<CalendarMode>(() => {
    const saved = localStorage.getItem("listflow-calendar-view");
    return saved === "day" || saved === "month" ? saved : "week";
  });
  const [anchor, setAnchor] = useState<DateTime>(() =>
    DateTime.local().startOf("day"),
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [eventError, setEventError] = useState("");
  const client = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  const eventTrigger = useRef<HTMLElement | null>(null);
  const open = !!(selectedEvent || draft);
  const showEvent = (event: CalendarEvent) => {
    eventTrigger.current = document.activeElement as HTMLElement;
    setSelectedEvent(event);
  };
  const closeEvent = () => {
    setSelectedEvent(null);
    setDraft(null);
    setConfirmDelete(false);
    setEventError("");
    eventTrigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    dialog.current
      ?.querySelector<HTMLElement>(draft ? "input" : focusable)
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closeEvent();
      } else if (e.key === "Tab" && dialog.current) {
        const all = [
          ...dialog.current.querySelectorAll<HTMLElement>(focusable),
        ];
        const i = all.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? i <= 0
            ? all.length - 1
            : i - 1
          : (i + 1) % all.length;
        e.preventDefault();
        all[next]?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, !!draft]);
  const sources = useQuery<{
    google: {
      ready: boolean;
      calendars: {
        id: string;
        name: string;
        primary?: boolean;
        writable: boolean;
        selected: boolean;
      }[];
    };
  }>({
    queryKey: ["calendar-sources"],
    queryFn: () => api("/api/calendar/sources"),
    enabled: signedIn,
    staleTime: 300000,
  });
  const writable = (
    sources.data?.google.ready ? sources.data.google.calendars : []
  )
    .filter((c) => c.writable)
    .sort(
      (a, b) =>
        Number(!!b.primary) - Number(!!a.primary) ||
        Number(b.selected) - Number(a.selected),
    );
  const newEvent = (day: DateTime, minutes = 9 * 60) => {
    if (!writable.length) return;
    eventTrigger.current = document.activeElement as HTMLElement;
    const start = day.startOf("day").plus({ minutes });
    const end = start.plus({ hours: 1 });
    setSelectedEvent(null);
    setDraft({
      calendarId: writable[0].id,
      title: "",
      allDay: false,
      startDate: start.toISODate()!,
      startTime: start.toFormat("HH:mm"),
      endDate: end.toISODate()!,
      endTime: end.toFormat("HH:mm"),
      location: "",
      description: "",
    });
  };
  const mutate = async (method: "POST" | "PATCH" | "DELETE", d: Draft) => {
    setSaving(true);
    setEventError("");
    try {
      const path =
        `/api/calendar/google/${encodeURIComponent(d.calendarId)}/events` +
        (d.eventId ? "/" + encodeURIComponent(d.eventId) : "");
      await api(path, {
        method,
        ...(method === "DELETE" ? {} : { body: JSON.stringify(draftBody(d)) }),
      });
      await client.invalidateQueries({ queryKey: ["calendar-events"] });
      closeEvent();
    } catch (e) {
      setEventError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const today = DateTime.local().startOf("day");
  const { from, to, days } = calendarRange(anchor, mode);
  const cacheKey = `listflow-calendar:${from.toISODate()}:${to.toISODate()}`;
  const events = useQuery<EventsResponse>({
    queryKey: ["calendar-events", from.toISODate(), to.toISODate()],
    queryFn: async () => {
      const q = new URLSearchParams({
        from: from.toUTC().toISO()!,
        to: to.toUTC().toISO()!,
      });
      const data = await api("/api/calendar/events?" + q);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch {}
      return data;
    },
    enabled: signedIn,
    staleTime: 120000,
    placeholderData: () => (signedIn ? readCache(cacheKey) : undefined),
  });
  const remote = signedIn ? events.data?.events || [] : [];
  const tasks = items.filter(
    (x) => x.type === "task" && isActive(x) && (x.scheduled_for || x.due_at),
  );
  const sections = days.map((day) => ({
    day,
    tasks: tasks.filter(
      (x) => calendarDate(x.scheduled_for || x.due_at) === day.toISODate(),
    ),
    events: remote
      .filter((e) => eventTouchesDay(e, day))
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
      ),
  }));
  const changeMode = (next: CalendarMode) => {
    setMode(next);
    localStorage.setItem("listflow-calendar-view", next);
  };
  const openDay = (day: DateTime) => {
    setAnchor(day);
    changeMode("day");
  };
  const shift = (n: number) =>
    setAnchor(
      mode === "month"
        ? anchor.plus({ months: n }).startOf("month")
        : anchor.plus({ days: n * (mode === "week" ? 7 : 1) }),
    );
  const label =
    mode === "day"
      ? anchor.toFormat("cccc, d LLLL yyyy")
      : mode === "month"
        ? anchor.toFormat("LLLL yyyy")
        : `${from.toFormat("d LLL")} – ${to.minus({ days: 1 }).toFormat("d LLL yyyy")}`;
  const scroll = useRef<HTMLDivElement>(null);
  const range = visibleHours(mode === "month" ? [] : remote, days);
  const [hour, setHour] = useState(48);
  // Size the timeline to the window and its hours so the whole day fits.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const fit = () => {
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const below =
        (nav && getComputedStyle(nav).display !== "none"
          ? nav.offsetHeight
          : 0) +
        parseFloat(getComputedStyle(el).marginBottom) +
        12;
      const height = Math.max(
        360,
        innerHeight - el.getBoundingClientRect().top - scrollY - below,
      );
      el.style.height = height + "px";
      const header =
        el.querySelector<HTMLElement>(".calendar-timeline-header")
          ?.offsetHeight || 0;
      const next = Math.max(
        26,
        Math.floor((height - header - 2) / (range.last - range.first)),
      );
      setHour(next);
      el.scrollTop = range.first * next;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    const header = el.querySelector(".calendar-timeline-header");
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [mode, range.first, range.last]);
  useEffect(() => {
    const el = scroll.current;
    if (el && mode === "week") {
      const index = days.findIndex((day) => day.hasSame(anchor, "day"));
      el.scrollLeft = (Math.max(0, index) * (el.scrollWidth - 54)) / 7;
    }
  }, [mode, from.toISODate()]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = range.first * hour;
  }, [from.toISODate()]);
  const taskChip = (task: Item) => (
    <button
      key={task.id}
      className="calendar-chip calendar-task"
      onClick={() => onOpen(task.id)}
      title={task.title}
    >
      <Circle size={12} />
      <span>{task.title}</span>
    </button>
  );
  const eventChip = (event: CalendarEvent) => (
    <button
      key={event.id}
      className="calendar-chip"
      onClick={() => showEvent(event)}
      style={{ borderLeftColor: event.color }}
      title={`${event.title} · ${event.sourceName}${event.location ? " · " + event.location : ""}`}
    >
      <span>
        {!event.allDay && (
          <small>{DateTime.fromISO(event.start).toFormat("t")} </small>
        )}
        {event.title}
      </span>
    </button>
  );
  return (
    <section className="calendar-view" aria-label="Calendar">
      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <button className="secondary-button" onClick={() => setAnchor(today)}>
            Today
          </button>
          <button
            className="icon-button"
            aria-label={`Previous ${mode}`}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label={`Next ${mode}`}
            onClick={() => shift(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <strong aria-live="polite">{label}</strong>
        <div className="calendar-modes" role="group" aria-label="Calendar view">
          {(["day", "week", "month"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => changeMode(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        {writable.length > 0 && (
          <button
            className="secondary-button calendar-new"
            onClick={() =>
              newEvent(
                mode === "month" || !days.some((d) => d.hasSame(today, "day"))
                  ? days[
                      mode === "month" ? days.findIndex((d) => d.day === 1) : 0
                    ]
                  : today,
                Math.min(22, DateTime.local().hour + 1) * 60,
              )
            }
          >
            <Plus size={15} /> Event
          </button>
        )}
        <button
          className="text-button calendar-connect"
          onClick={onSettings}
          aria-label="Calendars & connections"
        >
          <LogIn size={15} />
          <span>Calendars & connections</span>
        </button>
      </div>
      {!signedIn && (
        <p className="calendar-note">
          Your dated tasks appear here.{" "}
          <button className="text-button" onClick={onSettings}>
            Connect Google Calendar in Settings
          </button>
        </p>
      )}
      {signedIn && events.isFetching && (
        <p role="status" className="calendar-note">
          Loading calendars…
        </p>
      )}
      {signedIn && events.error && (
        <p role="alert" className="warning-text">
          Couldn’t load calendars. {String(events.error)}{" "}
          <button className="text-button" onClick={() => void events.refetch()}>
            Retry
          </button>
        </p>
      )}
      {signedIn &&
        events.data?.errors.map((x) => (
          <p className="calendar-note warning-text" key={x.source}>
            {x.source}: {x.message}
          </p>
        ))}
      {mode === "month" ? (
        <div className="calendar-month" aria-label={label}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div className="calendar-weekday" key={d}>
              {d}
            </div>
          ))}
          {sections.map((s) => (
            <div
              key={s.day.toISODate()}
              className={`calendar-month-day ${s.day.month !== anchor.month ? "outside-month" : ""} ${s.day.hasSame(today, "day") ? "is-today" : ""}`}
            >
              <button
                className="calendar-date"
                aria-label={`Open ${s.day.toFormat("cccc, d LLLL yyyy")}`}
                onClick={() => openDay(s.day)}
              >
                {s.day.day}
              </button>
              {s.events.slice(0, 3).map(eventChip)}
              {s.tasks.slice(0, Math.max(0, 3 - s.events.length)).map(taskChip)}
              {s.events.length + s.tasks.length > 3 && (
                <button
                  className="calendar-more"
                  onClick={() => openDay(s.day)}
                >
                  +{s.events.length + s.tasks.length - 3} more
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="calendar-timeline-scroll" ref={scroll}>
          <div
            className={`calendar-timeline calendar-${mode}`}
            style={
              {
                "--calendar-days": days.length,
                "--calendar-hour": hour + "px",
              } as React.CSSProperties
            }
          >
            <div className="calendar-timeline-header">
              <span className="calendar-zone">{today.toFormat("ZZZZ")}</span>
              {sections.map((s) => (
                <button
                  key={s.day.toISODate()}
                  className={`calendar-day-heading ${s.day.hasSame(today, "day") ? "is-today" : ""}`}
                  onClick={() => openDay(s.day)}
                  aria-label={`Open ${s.day.toFormat("cccc, d LLLL yyyy")}`}
                >
                  <span>{s.day.toFormat("ccc")}</span>
                  <strong>{s.day.day}</strong>
                </button>
              ))}
              <span className="calendar-allday-label">All day</span>
              {sections.map((s) => (
                <div className="calendar-allday" key={s.day.toISODate()}>
                  {s.events.filter((e) => e.allDay).map(eventChip)}
                  {s.tasks.map(taskChip)}
                </div>
              ))}
            </div>
            <div className="calendar-timeline-body">
              <div className="calendar-hours">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h}>
                    {today.set({ hour: h }).toFormat("ha").toLowerCase()}
                  </span>
                ))}
              </div>
              {sections.map((s) => (
                <div
                  key={s.day.toISODate()}
                  className={`calendar-time-column ${writable.length ? "can-create" : ""}`}
                  aria-label={s.day.toFormat("cccc, d LLLL yyyy")}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const minutes = (e.nativeEvent.offsetY / hour) * 60;
                    newEvent(
                      s.day,
                      Math.min(23 * 60, Math.floor(minutes / 30) * 30),
                    );
                  }}
                >
                  {timedLayout(s.events, s.day).map(
                    ({ event, top, bottom, column, columns }) => (
                      <button
                        key={event.id}
                        className="calendar-timed-event"
                        onClick={() => showEvent(event)}
                        style={{
                          top: (top * hour) / 60,
                          height: ((bottom - top) * hour) / 60,
                          left: `calc(${(column * 100) / columns}% + 2px)`,
                          width: `calc(${100 / columns}% - 4px)`,
                          borderLeftColor: event.color,
                        }}
                        title={`${event.title} · ${event.sourceName}${event.location ? " · " + event.location : ""}`}
                      >
                        <strong>{event.title}</strong>
                        <small>
                          {DateTime.fromISO(event.start).toFormat("t")} –{" "}
                          {DateTime.fromISO(event.end).toFormat("t")}
                        </small>
                        {event.location && <small>{event.location}</small>}
                      </button>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={closeEvent}>
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-event-title"
            className="calendar-event-dialog settings-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h3 id="calendar-event-title">
                {draft
                  ? draft.eventId
                    ? "Edit event"
                    : "New event"
                  : selectedEvent!.title}
              </h3>
              <button
                className="icon-button"
                aria-label="Close event"
                onClick={closeEvent}
              >
                <X size={20} />
              </button>
            </div>
            {draft ? (
              <form
                className="calendar-event-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(draft.eventId ? "PATCH" : "POST", draft);
                }}
              >
                <input
                  aria-label="Event title"
                  placeholder="Title"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
                <label className="calendar-check">
                  <input
                    type="checkbox"
                    checked={draft.allDay}
                    onChange={(e) =>
                      setDraft({ ...draft, allDay: e.target.checked })
                    }
                  />
                  All day
                </label>
                <div className="calendar-event-times">
                  <label>
                    Starts
                    <span>
                      <input
                        type="date"
                        aria-label="Start date"
                        value={draft.startDate}
                        required
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          // Keep the duration when moving the start.
                          const shift = DateTime.fromISO(v).diff(
                            DateTime.fromISO(draft.startDate),
                            "days",
                          ).days;
                          setDraft({
                            ...draft,
                            startDate: v,
                            endDate: DateTime.fromISO(draft.endDate)
                              .plus({ days: shift })
                              .toISODate()!,
                          });
                        }}
                      />
                      {!draft.allDay && (
                        <input
                          type="time"
                          aria-label="Start time"
                          value={draft.startTime}
                          required
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            const at = (d: string, t: string) =>
                              DateTime.fromISO(`${d}T${t}`);
                            const length = at(
                              draft.endDate,
                              draft.endTime,
                            ).diff(at(draft.startDate, draft.startTime));
                            const end = at(draft.startDate, v).plus(length);
                            setDraft({
                              ...draft,
                              startTime: v,
                              endDate: end.toISODate()!,
                              endTime: end.toFormat("HH:mm"),
                            });
                          }}
                        />
                      )}
                    </span>
                  </label>
                  <label>
                    Ends
                    <span>
                      <input
                        type="date"
                        aria-label="End date"
                        value={draft.endDate}
                        min={draft.startDate}
                        required
                        onChange={(e) =>
                          setDraft({ ...draft, endDate: e.target.value })
                        }
                      />
                      {!draft.allDay && (
                        <input
                          type="time"
                          aria-label="End time"
                          value={draft.endTime}
                          required
                          onChange={(e) =>
                            setDraft({ ...draft, endTime: e.target.value })
                          }
                        />
                      )}
                    </span>
                  </label>
                </div>
                <input
                  aria-label="Event location"
                  placeholder="Location"
                  value={draft.location}
                  onChange={(e) =>
                    setDraft({ ...draft, location: e.target.value })
                  }
                />
                <textarea
                  aria-label="Event notes"
                  placeholder="Notes"
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
                {!draft.eventId && writable.length > 1 && (
                  <select
                    aria-label="Calendar"
                    value={draft.calendarId}
                    onChange={(e) =>
                      setDraft({ ...draft, calendarId: e.target.value })
                    }
                  >
                    {writable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {eventError && (
                  <p role="alert" className="warning-text">
                    {eventError}
                  </p>
                )}
                <div className="calendar-event-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      selectedEvent ? setDraft(null) : closeEvent()
                    }
                  >
                    Cancel
                  </button>
                  <button className="primary-button" disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  {selectedEvent!.allDay
                    ? allDayRange(selectedEvent!.start, selectedEvent!.end)
                    : `${DateTime.fromISO(selectedEvent!.start).toFormat("ccc, d LLL yyyy · t")} – ${DateTime.fromISO(selectedEvent!.end).toFormat("ccc, d LLL yyyy · t")}`}
                </p>
                <p>{selectedEvent!.sourceName}</p>
                {selectedEvent!.location && <p>{selectedEvent!.location}</p>}
                {selectedEvent!.description && (
                  <p className="calendar-event-notes">
                    {selectedEvent!.description}
                  </p>
                )}
                {eventError && (
                  <p role="alert" className="warning-text">
                    {eventError}
                  </p>
                )}
                {selectedEvent!.writable && selectedEvent!.calendarId && (
                  <div className="calendar-event-actions">
                    <button
                      className={
                        confirmDelete ? "text-button danger" : "text-button"
                      }
                      disabled={saving}
                      onClick={() =>
                        confirmDelete
                          ? void mutate("DELETE", draftFrom(selectedEvent!))
                          : setConfirmDelete(true)
                      }
                    >
                      <Trash2 size={15} />
                      {confirmDelete ? "Delete event?" : "Delete"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setDraft(draftFrom(selectedEvent!))}
                    >
                      <Pencil size={15} /> Edit
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type Sources = {
  feeds: { id: string; name: string; color: string }[];
  google: {
    connected: boolean;
    ready: boolean;
    calendars: {
      id: string;
      name: string;
      color: string;
      writable: boolean;
      selected: boolean;
    }[];
    push: string | null;
    pushError: string | null;
    error: string | null;
  };
};

export function CalendarSettings({
  googleConfigured,
  signedIn,
  onConfigured,
  onError,
}: {
  googleConfigured: boolean;
  signedIn: boolean;
  onConfigured: () => void;
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const sources = useQuery<Sources>({
    queryKey: ["calendar-sources"],
    queryFn: () => api("/api/calendar/sources"),
    enabled: signedIn,
  });
  const config = useQuery<{
    configured: boolean;
    ownerEmail: string;
    redirectUri: string;
    authorizationUrl: string;
  }>({
    queryKey: ["google-config"],
    queryFn: () => api("/api/google/config"),
    enabled: signedIn,
  });
  const [ownerEmail, setOwnerEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [setupError, setSetupError] = useState("");
  useEffect(() => {
    if (config.data?.ownerEmail) setOwnerEmail(config.data.ownerEmail);
  }, [config.data?.ownerEmail]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["calendar-sources"] });
    void client.invalidateQueries({ queryKey: ["calendar-events"] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (sources.error) onError(String(sources.error));
  }, [sources.error]);
  const g = sources.data?.google;
  const selected =
    g?.calendars.filter((c) => c.selected).map((c) => c.id) || [];
  const saveGoogle = (patch: { selected?: string[]; push?: string | null }) =>
    run(() =>
      api("/api/calendar/google", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    );
  return (
    <div className="settings-card calendar-settings">
      <h3>
        <CalendarDays size={16} /> Calendars
      </h3>
      <h4>Google Calendar</h4>
      <p>
        See your Google events alongside your tasks. Choose which calendars to
        show after signing in.
      </p>
      {new URLSearchParams(location.search).get("google") === "connected" && (
        <p className="calendar-note" role="status">
          Google connected. Choose your calendars below.
        </p>
      )}
      {new URLSearchParams(location.search).get("google") === "error" && (
        <p className="warning-text" role="alert">
          Google connection wasn’t completed. Try again with the configured
          owner account and check the callback URL in Google Cloud.
        </p>
      )}
      {!signedIn ? (
        googleConfigured ? (
          <a
            className="secondary-button google-button"
            href={apiRoot() + "/auth/google"}
          >
            <LogIn size={15} />
            Sign in with Google
          </a>
        ) : (
          <p className="calendar-note">
            Sign in to your workspace above to set up Google Calendar.
          </p>
        )
      ) : (
        <>
          {config.isPending && (
            <p className="calendar-note">Checking Google setup…</p>
          )}
          {config.error && (
            <p role="alert" className="warning-text">
              Couldn’t check Google setup.{" "}
              <button
                className="text-button"
                onClick={() => void config.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {(config.data?.configured ?? googleConfigured) && (
            <>
              <a
                className="secondary-button google-button"
                href={apiRoot() + "/auth/google"}
              >
                <LogIn size={15} />
                {g?.ready ? "Reconnect Google Calendar" : "Sign in with Google"}
              </a>
              {config.data?.ownerEmail && (
                <p className="tiny muted">
                  Use {config.data.ownerEmail}. Google opens on the workspace’s
                  HTTPS address.
                </p>
              )}
            </>
          )}
          {saved && (
            <p role="status" className="calendar-note">
              Setup saved. Select “Sign in with Google” to connect your account.
            </p>
          )}
          {config.data && (
            <details
              className="google-setup"
              open={!config.data.configured || setupOpen}
              onToggle={(e) => setSetupOpen(e.currentTarget.open)}
            >
              <summary>
                {config.data.configured
                  ? "Google connection setup"
                  : "Set up Google Calendar"}
              </summary>
              <ol>
                <li>
                  Open{" "}
                  <a
                    href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Cloud → Google Calendar API
                  </a>
                  , select or create your project, and enable the API.
                </li>
                <li>
                  In{" "}
                  <a
                    href="https://console.cloud.google.com/auth/overview"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Auth Platform
                  </a>
                  , set up the consent screen. If the app is in Testing, add
                  your Google email under Audience → Test users.
                </li>
                <li>
                  Under Clients, create a <strong>Web application</strong>{" "}
                  client. Add this exact authorized redirect URI:{" "}
                  <code>{config.data.redirectUri}</code>
                </li>
                <li>
                  Paste your client details below, save, then sign in with
                  Google. Your password stays with Google.
                </li>
              </ol>
              <form
                className="google-setup"
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  setSetupError("");
                  void api("/api/google/config", {
                    method: "PUT",
                    body: JSON.stringify({
                      ownerEmail,
                      clientId,
                      clientSecret,
                    }),
                  })
                    .then(async () => {
                      setClientSecret("");
                      setClientId("");
                      setSaved(true);
                      setSetupOpen(false);
                      onConfigured();
                      await client.invalidateQueries({
                        queryKey: ["google-config"],
                      });
                      refresh();
                    })
                    .catch((e) =>
                      setSetupError(e instanceof Error ? e.message : String(e)),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                <label>
                  Your Google email
                  <input
                    type="email"
                    aria-label="Google owner email"
                    placeholder="you@gmail.com"
                    autoComplete="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Web client ID
                  <input
                    aria-label="Google client ID"
                    placeholder="…apps.googleusercontent.com"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Client secret
                  <input
                    type="password"
                    aria-label="Google client secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                {setupError && (
                  <p role="alert" className="warning-text">
                    {setupError}
                  </p>
                )}
                <button className="primary-button" disabled={busy || !signedIn}>
                  Save Google setup
                </button>
                <p className="tiny muted">
                  Client credentials are encrypted on your workspace server.
                  Enable the Google Sheets and Drive APIs too if you use the
                  optional Sheets copy.
                </p>
              </form>
            </details>
          )}
          {sources.isPending && (
            <p className="calendar-note">Loading connected calendars…</p>
          )}
          {g?.error && <p className="warning-text">{g.error}</p>}
          {g?.ready && (
            <>
              <p className="calendar-note">
                Connected
                {config.data?.ownerEmail ? " as " + config.data.ownerEmail : ""}
                . Select calendars to display:
              </p>
              {g.calendars.map((c) => (
                <label className="calendar-check" key={c.id}>
                  <input
                    type="checkbox"
                    checked={c.selected}
                    disabled={busy || !signedIn}
                    onChange={(e) =>
                      void saveGoogle({
                        selected: e.target.checked
                          ? [...selected, c.id]
                          : selected.filter((x) => x !== c.id),
                      })
                    }
                  />
                  <span
                    className="calendar-swatch"
                    style={{ background: c.color }}
                  />
                  {c.name}
                </label>
              ))}
              <label className="calendar-push">
                Put dated tasks on
                <select
                  value={g.push || ""}
                  disabled={busy || !signedIn}
                  onChange={(e) =>
                    void saveGoogle({ push: e.target.value || null })
                  }
                >
                  <option value="">Don’t add tasks</option>
                  {g.calendars
                    .filter((c) => c.writable)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              {g.pushError && <p className="warning-text">{g.pushError}</p>}
            </>
          )}
        </>
      )}
      <h4>Calendar links (ICS)</h4>
      {sources.data?.feeds.map((f) => (
        <div className="calendar-feed" key={f.id}>
          <span className="calendar-swatch" style={{ background: f.color }} />
          <span>{f.name}</span>
          <button
            className="icon-button"
            aria-label={`Remove ${f.name}`}
            disabled={busy || !signedIn}
            onClick={() =>
              void run(() =>
                api("/api/calendar/feeds/" + f.id, { method: "DELETE" }),
              )
            }
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <form
        className="calendar-feed-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api("/api/calendar/feeds", {
              method: "POST",
              body: JSON.stringify({ name, url }),
            });
            setName("");
            setUrl("");
          });
        }}
      >
        <input
          aria-label="Calendar name"
          placeholder="Name (e.g. Work)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <input
          aria-label="Calendar link"
          placeholder="https://… or webcal://… .ics link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          inputMode="url"
        />
        <button className="primary-button" disabled={busy || !signedIn}>
          <Plus size={16} />
          Add
        </button>
      </form>
      <p className="tiny muted">
        Outlook: Settings → Calendar → Shared calendars → Publish a calendar →
        copy the ICS link.
      </p>
    </div>
  );
}
