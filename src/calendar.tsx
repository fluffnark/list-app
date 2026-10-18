import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  LogIn,
  Plus,
  Trash2,
} from "lucide-react";
import { api, apiRoot } from "./db";
import { calendarDate, isActive, type Item } from "../shared/model";

type CalendarEvent = {
  id: string;
  sourceName: string;
  color: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};
type EventsResponse = {
  events: CalendarEvent[];
  errors: { source: string; message: string }[];
};
const DAYS = 14;

function readCache(key: string): EventsResponse | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
}

// Local calendar days an event touches (all-day ends are exclusive).
function eventDays(e: CalendarEvent): [string, string] {
  if (e.allDay)
    return [e.start, DateTime.fromISO(e.end).minus({ days: 1 }).toISODate()!];
  const start = DateTime.fromISO(e.start);
  const end = DateTime.fromISO(e.end).minus({ milliseconds: 1 });
  return [start.toISODate()!, DateTime.max(start, end).toISODate()!];
}

export function CalendarView({
  items,
  signedIn,
  onOpen,
}: {
  items: Item[];
  signedIn: boolean;
  onOpen: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const today = DateTime.local().startOf("day");
  const first = today.plus({ days: offset * DAYS });
  const last = first.plus({ days: DAYS });
  const cacheKey = "listflow-calendar:" + first.toISODate();
  const events = useQuery<EventsResponse>({
    queryKey: ["calendar-events", first.toISODate()],
    queryFn: async () => {
      const q = new URLSearchParams({
        from: first.toUTC().toISO()!,
        to: last.toUTC().toISO()!,
      });
      const data = await api("/api/calendar/events?" + q);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch {}
      return data;
    },
    enabled: signedIn,
    staleTime: 120000,
    placeholderData: () => readCache(cacheKey),
  });
  const days = Array.from({ length: DAYS }, (_, i) =>
    first.plus({ days: i }).toISODate()!,
  );
  const tasks = items.filter(
    (x) => x.type === "task" && isActive(x) && (x.scheduled_for || x.due_at),
  );
  const spans = (events.data?.events || []).map((e) => ({
    e,
    span: eventDays(e),
  }));
  const label = `${first.toFormat("d LLL")} – ${last.minus({ days: 1 }).toFormat("d LLL")}`;
  const sections = days
    .map((day) => ({
      day,
      tasks: tasks.filter(
        (x) => calendarDate(x.scheduled_for || x.due_at) === day,
      ),
      events: spans
        .filter(({ span }) => span[0] <= day && span[1] >= day)
        .map(({ e }) => e)
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            a.start.localeCompare(b.start),
        ),
    }))
    .filter(
      (s) => s.tasks.length || s.events.length || s.day === today.toISODate(),
    );
  return (
    <section className="calendar-view" aria-label="Calendar">
      <div className="calendar-toolbar">
        <button
          className="icon-button"
          aria-label="Previous two weeks"
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <strong>{label}</strong>
        <button
          className="icon-button"
          aria-label="Next two weeks"
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight size={18} />
        </button>
        {offset !== 0 && (
          <button className="text-button" onClick={() => setOffset(0)}>
            Today
          </button>
        )}
      </div>
      {!signedIn && (
        <p className="calendar-note">Sign in to show your calendars.</p>
      )}
      {events.data?.errors.map((x) => (
        <p className="calendar-note warning-text" key={x.source}>
          {x.source}: {x.message}
        </p>
      ))}
      {sections.map((s) => {
        const d = DateTime.fromISO(s.day);
        return (
          <div className="calendar-day" key={s.day}>
            <h3>
              {s.day === today.toISODate()
                ? "Today"
                : s.day === today.plus({ days: 1 }).toISODate()
                  ? "Tomorrow"
                  : d.toFormat("cccc")}
              <span>{d.toFormat("d LLL")}</span>
            </h3>
            {!s.tasks.length && !s.events.length && (
              <p className="calendar-empty">Nothing scheduled</p>
            )}
            {s.events.map((e) => (
              <div className="calendar-event" key={e.id + s.day}>
                <span className="calendar-time">
                  {e.allDay
                    ? "All day"
                    : DateTime.fromISO(e.start).toISODate() === s.day
                      ? DateTime.fromISO(e.start).toFormat("t")
                      : "Cont."}
                </span>
                <span
                  className="calendar-swatch"
                  style={{ background: e.color }}
                />
                <span className="calendar-title">
                  {e.title}
                  <small>
                    {e.sourceName}
                    {e.location ? " · " + e.location : ""}
                  </small>
                </span>
              </div>
            ))}
            {s.tasks.map((x) => (
              <button
                className="calendar-event calendar-task"
                key={x.id}
                onClick={() => onOpen(x.id)}
              >
                <span className="calendar-time">
                  {calendarDate(x.scheduled_for) === s.day ? "Plan" : "Due"}
                </span>
                <Circle size={14} className="calendar-swatch-icon" />
                <span className="calendar-title">{x.title}</span>
              </button>
            ))}
          </div>
        );
      })}
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
  onError,
}: {
  googleConfigured: boolean;
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const sources = useQuery<Sources>({
    queryKey: ["calendar-sources"],
    queryFn: () => api("/api/calendar/sources"),
  });
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
      {!googleConfigured ? (
        <p className="tiny muted">
          Needs Google set up on the server first (see Account).
        </p>
      ) : !g?.ready ? (
        <a
          className="secondary-button google-button"
          href={apiRoot() + "/auth/google"}
        >
          <LogIn size={15} />
          {g?.connected ? "Allow calendar access" : "Connect Google"}
        </a>
      ) : (
        <>
          {g.error && <p className="warning-text">{g.error}</p>}
          {g.calendars.map((c) => (
            <label className="calendar-check" key={c.id}>
              <input
                type="checkbox"
                checked={c.selected}
                disabled={busy}
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
              disabled={busy}
              onChange={(e) =>
                void saveGoogle({ push: e.target.value || null })
              }
            >
              <option value="">Don't add tasks</option>
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
      <h4>Calendar links (ICS)</h4>
      {sources.data?.feeds.map((f) => (
        <div className="calendar-feed" key={f.id}>
          <span className="calendar-swatch" style={{ background: f.color }} />
          <span>{f.name}</span>
          <button
            className="icon-button"
            aria-label={`Remove ${f.name}`}
            disabled={busy}
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
        <button className="primary-button" disabled={busy}>
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
