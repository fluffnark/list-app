import ICAL from "ical.js";
import { createHash, randomUUID } from "node:crypto";
import {
  calendarDate,
  isActive,
  type Entity,
  type Item,
} from "../shared/model";
import { seal, unseal } from "./sheets";
import type { Store } from "./store";

export type CalendarEvent = {
  id: string;
  source: string;
  sourceName: string;
  color: string;
  title: string;
  // ISO date (all-day, end exclusive) or ISO datetime.
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  // Present on events the owner can edit in Google.
  calendarId?: string;
  eventId?: string;
  writable?: boolean;
};
// Fields the owner can change on a Google event. Times as in CalendarEvent.
export type EventInput = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  timeZone?: string;
};
export type Feed = { id: string; name: string; url: string; color: string };
type GoogleSettings = { selected: string[] | null; push: string | null };

const GOOGLE = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const palette = [
  "#7c9cf5",
  "#e8a35c",
  "#6cc18f",
  "#d9739d",
  "#b38bf0",
  "#58b8c9",
];
const FEED_TTL = 10 * 60000;
const GOOGLE_TTL = 5 * 60000;
const MAX_ICS_BYTES = 5_000_000;

// Expand an ICS document into concrete occurrences overlapping [from, to).
export function expandIcs(
  text: string,
  from: Date,
  to: Date,
  source: Pick<Feed, "id" | "name" | "color">,
): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone"))
    ICAL.TimezoneService.register(tz);
  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of vevents) {
    const e = new ICAL.Event(v);
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);
  const out: CalendarEvent[] = [];
  const push = (e: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (e.component.getFirstPropertyValue("status") === "CANCELLED") return;
    const s = start.toJSDate();
    const f = end.toJSDate();
    if (f <= from || s >= to) return;
    const allDay = start.isDate;
    out.push({
      id: `${source.id}:${e.uid}:${start.toString()}`,
      source: source.id,
      sourceName: source.name,
      color: source.color,
      title: e.summary || "(No title)",
      start: allDay ? start.toString() : s.toISOString(),
      end: allDay ? end.toString() : f.toISOString(),
      allDay,
      location: e.location || undefined,
    });
  };
  for (const e of masters.values()) {
    if (!e.startDate) continue;
    if (!e.isRecurring()) {
      push(e, e.startDate, e.endDate || e.startDate);
      continue;
    }
    const it = e.iterator();
    for (let n = 0, next = it.next(); next && n < 5000; n++, next = it.next()) {
      if (next.toJSDate() >= to) break;
      const o = e.getOccurrenceDetails(next);
      push(o.item, o.startDate, o.endDate);
    }
  }
  return out;
}

// Dated, open tasks become all-day events: title + plan date (or due date).
export function desiredTaskEvents(entities: Entity[], zone?: string) {
  const out = new Map<string, { title: string; date: string }>();
  for (const e of entities) {
    if (e.kind !== "item") continue;
    const x = e as Item;
    if (x.type !== "task" || !isActive(x)) continue;
    const date = calendarDate(x.scheduled_for || x.due_at, zone);
    if (date) out.set(x.id, { title: x.title, date });
  }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function googleEventBody(input: EventInput) {
  const title = String(input.title || "")
    .trim()
    .slice(0, 500);
  const allDay = !!input.allDay;
  const valid = (v: unknown) =>
    typeof v === "string" &&
    (allDay ? DATE.test(v) : !DATE.test(v) && !isNaN(Date.parse(v)));
  if (!valid(input.start) || !valid(input.end))
    throw new Error("Invalid start or end");
  if (
    allDay
      ? input.end <= input.start
      : Date.parse(input.end) < Date.parse(input.start)
  )
    throw new Error("The event must end after it starts");
  const zone = input.timeZone ? String(input.timeZone).slice(0, 64) : undefined;
  const time = (v: string) =>
    allDay
      ? { date: v, dateTime: null }
      : { dateTime: v, date: null, timeZone: zone };
  return {
    summary: title || "(No title)",
    start: time(input.start),
    end: time(input.end),
    location: String(input.location || "").slice(0, 1000),
    description: String(input.description || "").slice(0, 8000),
  };
}

export function normalizeFeedUrl(raw: string) {
  const url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  if (url.protocol !== "https:")
    throw new Error("Calendar links must start with https:// or webcal://");
  return url.toString();
}

export class CalendarService {
  private cache = new Map<string, { at: number; value: unknown }>();
  pushing = false;
  constructor(
    private store: Store,
    private secret: string,
    private token: () => Promise<string>,
  ) {}

  feeds(): Feed[] {
    const v = this.store.setting("calendar_feeds");
    return v ? JSON.parse(unseal(v, this.secret)) : [];
  }
  private saveFeeds(feeds: Feed[]) {
    this.store.set("calendar_feeds", seal(JSON.stringify(feeds), this.secret));
  }
  async addFeed(name: string, rawUrl: string) {
    const url = normalizeFeedUrl(rawUrl);
    const text = await this.fetchIcs(url);
    if (!/BEGIN:VCALENDAR/i.test(text))
      throw new Error("That link didn't return a calendar (ICS) file");
    const feeds = this.feeds();
    const feed = {
      id: "ics-" + randomUUID(),
      name: name.trim().slice(0, 60) || new URL(url).hostname,
      url,
      color: palette[feeds.length % palette.length],
    };
    this.saveFeeds([...feeds, feed]);
    this.cache.set("ics:" + url, { at: Date.now(), value: text });
    return { id: feed.id, name: feed.name, color: feed.color };
  }
  removeFeed(id: string) {
    this.saveFeeds(this.feeds().filter((f) => f.id !== id));
  }

  google(): GoogleSettings {
    const v = this.store.setting("calendar_google");
    return v ? JSON.parse(v) : { selected: null, push: null };
  }
  setGoogle(patch: Partial<GoogleSettings>) {
    const next = { ...this.google(), ...patch };
    this.store.set("calendar_google", JSON.stringify(next));
    this.cache.clear();
    return next;
  }
  googleReady() {
    const scopes = this.store.setting("google_scopes") || "";
    return (
      !!this.store.setting("google_refresh") &&
      CALENDAR_SCOPES.every((s) => scopes.includes(s))
    );
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
  private async fetchIcs(url: string) {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "text/calendar, */*" },
    });
    if (!r.ok) throw new Error(`Calendar link returned HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_ICS_BYTES)
      throw new Error("Calendar file is too large");
    return text;
  }
  private async gapi(path: string, init: RequestInit = {}) {
    const r = await fetch(GOOGLE + path, {
      ...init,
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + (await this.token()),
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (r.status === 204 || r.status === 404 || r.status === 410)
      return r.status === 204 ? {} : null;
    const data = (await r.json()) as any;
    if (!r.ok)
      throw new Error(
        data?.error?.message || `Google Calendar HTTP ${r.status}`,
      );
    return data;
  }

  async googleCalendars() {
    if (!this.googleReady()) return [];
    const data = await this.cached("gcal:list", GOOGLE_TTL, () =>
      this.gapi("/users/me/calendarList?maxResults=250"),
    );
    const { selected } = this.google();
    return ((data?.items || []) as any[]).map((c) => ({
      id: c.id as string,
      name: (c.summaryOverride || c.summary) as string,
      color: (c.backgroundColor || palette[0]) as string,
      primary: !!c.primary,
      writable: c.accessRole === "owner" || c.accessRole === "writer",
      selected: selected
        ? selected.includes(c.id)
        : !!c.selected || !!c.primary,
    }));
  }

  async events(from: Date, to: Date) {
    const events: CalendarEvent[] = [];
    const errors: { source: string; message: string }[] = [];
    const window = `${from.toISOString()}..${to.toISOString()}`;
    const jobs: Promise<void>[] = this.feeds().map(async (f) => {
      try {
        const text = await this.cached("ics:" + f.url, FEED_TTL, () =>
          this.fetchIcs(f.url),
        );
        events.push(...expandIcs(text, from, to, f));
      } catch (e) {
        errors.push({
          source: f.name,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
    if (this.googleReady())
      jobs.push(
        (async () => {
          let calendars: Awaited<
            ReturnType<CalendarService["googleCalendars"]>
          >;
          try {
            calendars = (await this.googleCalendars()).filter(
              (c) => c.selected,
            );
          } catch (e) {
            errors.push({
              source: "Google",
              message: e instanceof Error ? e.message : String(e),
            });
            return;
          }
          await Promise.all(
            calendars.map(async (c) => {
              try {
                const q = new URLSearchParams({
                  timeMin: from.toISOString(),
                  timeMax: to.toISOString(),
                  singleEvents: "true",
                  orderBy: "startTime",
                  maxResults: "2500",
                });
                const data = await this.cached(
                  `gcal:${c.id}:${window}`,
                  GOOGLE_TTL,
                  () =>
                    this.gapi(
                      `/calendars/${encodeURIComponent(c.id)}/events?${q}`,
                    ),
                );
                for (const e of (data?.items || []) as any[]) {
                  // Our own pushed tasks are already shown as tasks.
                  if (
                    e.status === "cancelled" ||
                    e.extendedProperties?.private?.listflow_item
                  )
                    continue;
                  const allDay = !!e.start?.date;
                  events.push({
                    id: `g:${c.id}:${e.id}`,
                    source: "google:" + c.id,
                    sourceName: c.name,
                    color: c.color,
                    title: e.summary || "(No title)",
                    start: allDay ? e.start.date : e.start.dateTime,
                    end: allDay ? e.end.date : e.end.dateTime,
                    allDay,
                    location: e.location || undefined,
                    description: e.description || undefined,
                    calendarId: c.id,
                    eventId: e.id,
                    writable: c.writable && !e.locked,
                  });
                }
              } catch (e) {
                errors.push({
                  source: c.name,
                  message: e instanceof Error ? e.message : String(e),
                });
              }
            }),
          );
        })(),
      );
    await Promise.all(jobs);
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, errors };
  }

  private async writableCalendar(calendarId: string) {
    if (!this.googleReady()) throw new Error("Google Calendar isn't connected");
    const c = (await this.googleCalendars()).find((x) => x.id === calendarId);
    if (!c?.writable) throw new Error("That calendar can't be edited");
  }
  private eventPath(calendarId: string, eventId?: string) {
    return (
      `/calendars/${encodeURIComponent(calendarId)}/events` +
      (eventId ? "/" + encodeURIComponent(eventId) : "")
    );
  }
  // Drop cached event lists (not the calendar list) after a change.
  private dropEvents() {
    for (const key of this.cache.keys())
      if (key.startsWith("gcal:") && key !== "gcal:list")
        this.cache.delete(key);
  }
  async createEvent(calendarId: string, input: EventInput) {
    await this.writableCalendar(calendarId);
    const event = await this.gapi(this.eventPath(calendarId), {
      method: "POST",
      body: JSON.stringify(googleEventBody(input)),
    });
    this.dropEvents();
    return { id: event?.id as string };
  }
  async updateEvent(calendarId: string, eventId: string, input: EventInput) {
    await this.writableCalendar(calendarId);
    const event = await this.gapi(this.eventPath(calendarId, eventId), {
      method: "PATCH",
      body: JSON.stringify(googleEventBody(input)),
    });
    this.dropEvents();
    if (!event) throw new Error("That event no longer exists");
    return { id: event.id as string };
  }
  async deleteEvent(calendarId: string, eventId: string) {
    await this.writableCalendar(calendarId);
    await this.gapi(this.eventPath(calendarId, eventId), { method: "DELETE" });
    this.dropEvents();
  }

  // Mirror dated tasks into the chosen Google calendar. Bounded per run.
  async pushTasks(load: () => Entity[], budget = 40) {
    if (this.pushing || !this.googleReady()) return;
    const target = this.google().push;
    const entities = target ? load() : [];
    this.pushing = true;
    try {
      const links = this.store.db
        .prepare("SELECT item_id,calendar_id,event_id,hash FROM calendar_links")
        .all() as {
        item_id: string;
        calendar_id: string;
        event_id: string;
        hash: string;
      }[];
      const desired = target ? desiredTaskEvents(entities) : new Map();
      const byItem = new Map(links.map((l) => [l.item_id, l]));
      const drop = this.store.db.prepare(
        "DELETE FROM calendar_links WHERE item_id=?",
      );
      for (const l of links) {
        if (budget <= 0) return;
        if (desired.has(l.item_id) && l.calendar_id === target) continue;
        budget--;
        await this.gapi(
          `/calendars/${encodeURIComponent(l.calendar_id)}/events/${encodeURIComponent(l.event_id)}`,
          { method: "DELETE" },
        );
        drop.run(l.item_id);
        byItem.delete(l.item_id);
      }
      const upsert = this.store.db.prepare(
        "INSERT INTO calendar_links VALUES (?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET calendar_id=excluded.calendar_id,event_id=excluded.event_id,hash=excluded.hash",
      );
      for (const [id, t] of desired) {
        if (budget <= 0) return;
        const hash = createHash("sha256")
          .update(`${t.title}\n${t.date}`)
          .digest("hex");
        const link = byItem.get(id);
        if (link?.hash === hash) continue;
        budget--;
        const end = new Date(t.date + "T00:00:00Z");
        end.setUTCDate(end.getUTCDate() + 1);
        const body = JSON.stringify({
          summary: t.title,
          start: { date: t.date },
          end: { date: end.toISOString().slice(0, 10) },
          transparency: "transparent",
          description: "From ListFlow",
          extendedProperties: { private: { listflow_item: id } },
        });
        const path = `/calendars/${encodeURIComponent(target!)}/events`;
        let event = link
          ? await this.gapi(`${path}/${encodeURIComponent(link.event_id)}`, {
              method: "PATCH",
              body,
            })
          : null;
        // Missing (deleted in Google) or new: create it.
        if (!event) event = await this.gapi(path, { method: "POST", body });
        upsert.run(id, target, event.id, hash);
      }
      this.store.set("calendar_push_error", "");
    } catch (e) {
      this.store.set(
        "calendar_push_error",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      this.pushing = false;
    }
  }
}
