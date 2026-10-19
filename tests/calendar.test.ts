import { expect, it } from "vitest";
import {
  desiredTaskEvents,
  expandIcs,
  googleEventBody,
  normalizeFeedUrl,
} from "../server/calendar";
import { newItem } from "../shared/model";

const src = { id: "f", name: "Feed", color: "#000" };
const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VTIMEZONE
TZID:America/Denver
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0600
TZOFFSETTO:-0700
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0700
TZOFFSETTO:-0600
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly
DTSTART;TZID=America/Denver:20261005T090000
DTEND;TZID=America/Denver:20261005T093000
RRULE:FREQ=WEEKLY;COUNT=10
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:weekly
RECURRENCE-ID;TZID=America/Denver:20261019T090000
DTSTART;TZID=America/Denver:20261019T110000
DTEND;TZID=America/Denver:20261019T113000
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:allday
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261021
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:gone
DTSTART:20261021T120000Z
DTEND:20261021T130000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
END:VCALENDAR`;

it("expands recurring ICS events with timezones, exceptions and all-day events", () => {
  const events = expandIcs(
    ics,
    new Date("2026-10-12T00:00:00Z"),
    new Date("2026-10-26T00:00:00Z"),
    src,
  );
  expect(events.map((e) => [e.title, e.start, e.allDay]).sort()).toEqual(
    [
      ["Holiday", "2026-10-20", true],
      ["Standup", "2026-10-12T15:00:00.000Z", false],
      ["Standup (moved)", "2026-10-19T17:00:00.000Z", false],
    ].sort(),
  );
  expect(events.find((e) => e.allDay)?.end).toBe("2026-10-21");
});

it("maps open dated tasks to calendar entries", () => {
  const planned = newItem("Plan", { scheduled_for: "2026-10-20" });
  const due = newItem("Due", { due_at: "2026-10-22" });
  const done = newItem("Done", { scheduled_for: "2026-10-20", status: "done" });
  const note = newItem("Note", { type: "note", scheduled_for: "2026-10-20" });
  const undated = newItem("Someday");
  const map = desiredTaskEvents([planned, due, done, note, undated], "UTC");
  expect([...map.entries()]).toEqual([
    [planned.id, { title: "Plan", date: "2026-10-20" }],
    [due.id, { title: "Due", date: "2026-10-22" }],
  ]);
});

it("accepts https and webcal calendar links only", () => {
  expect(normalizeFeedUrl("webcal://example.com/a.ics")).toBe(
    "https://example.com/a.ics",
  );
  expect(() => normalizeFeedUrl("http://example.com/a.ics")).toThrow();
  expect(() => normalizeFeedUrl("file:///etc/passwd")).toThrow();
});

it("mirrors dated tasks into the chosen Google calendar", async () => {
  const { Store } = await import("../server/store");
  const { CalendarService, CALENDAR_SCOPES } =
    await import("../server/calendar");
  const store = new Store(":memory:");
  store.set("google_refresh", "sealed");
  store.set("google_scopes", CALENDAR_SCOPES.join(" "));
  const calls: string[] = [];
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    calls.push(`${method} ${decodeURIComponent(String(url).split("/v3")[1])}`);
    if (method === "DELETE") return new Response(null, { status: 204 });
    // Google keeps the event id on PATCH.
    if (method === "PATCH")
      return new Response(
        JSON.stringify({ id: String(url).split("/").at(-1) }),
        { status: 200 },
      );
    return new Response(JSON.stringify({ id: "ev" + ++n }), { status: 200 });
  }) as typeof fetch;
  try {
    const cal = new CalendarService(store, "s", async () => "token");
    const task = newItem("Dentist", { scheduled_for: "2026-10-20" });
    let entities = [task];
    cal.setGoogle({ push: "primary" });
    await cal.pushTasks(() => entities);
    expect(calls).toEqual(["POST /calendars/primary/events"]);
    await cal.pushTasks(() => entities);
    expect(calls).toHaveLength(1);
    entities = [{ ...task, title: "Dentist 3pm" }];
    await cal.pushTasks(() => entities);
    expect(calls.at(-1)).toBe("PATCH /calendars/primary/events/ev1");
    cal.setGoogle({ push: "work@group" });
    await cal.pushTasks(() => entities);
    expect(calls.slice(-2)).toEqual([
      "DELETE /calendars/primary/events/ev1",
      "POST /calendars/work@group/events",
    ]);
    entities = [{ ...task, status: "done" }];
    await cal.pushTasks(() => entities);
    expect(calls.at(-1)).toBe("DELETE /calendars/work@group/events/ev2");
    expect(store.setting("calendar_push_error")).toBe("");
  } finally {
    globalThis.fetch = realFetch;
  }
});

it("builds Google event bodies and rejects bad times", () => {
  expect(
    googleEventBody({
      title: " Lunch ",
      allDay: false,
      start: "2026-10-20T12:00:00-06:00",
      end: "2026-10-20T13:00:00-06:00",
      timeZone: "America/Denver",
    }),
  ).toMatchObject({
    summary: "Lunch",
    start: { dateTime: "2026-10-20T12:00:00-06:00", date: null },
    end: { timeZone: "America/Denver" },
  });
  expect(
    googleEventBody({
      title: "",
      allDay: true,
      start: "2026-10-20",
      end: "2026-10-21",
    }),
  ).toMatchObject({
    summary: "(No title)",
    start: { date: "2026-10-20", dateTime: null },
  });
  const bad = { title: "x", allDay: true };
  expect(() =>
    googleEventBody({ ...bad, start: "2026-10-21", end: "2026-10-21" }),
  ).toThrow();
  expect(() =>
    googleEventBody({ ...bad, start: "2026-10-20T10:00", end: "2026-10-21" }),
  ).toThrow();
});

it("edits and deletes events only on writable Google calendars", async () => {
  const { Store } = await import("../server/store");
  const { CalendarService, CALENDAR_SCOPES } =
    await import("../server/calendar");
  const store = new Store(":memory:");
  store.set("google_refresh", "sealed");
  store.set("google_scopes", CALENDAR_SCOPES.join(" "));
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    const path = decodeURIComponent(String(url).split("/v3")[1]);
    if (path.startsWith("/users/me/calendarList"))
      return new Response(
        JSON.stringify({
          items: [
            { id: "primary@x", summary: "Me", accessRole: "owner" },
            { id: "holidays", summary: "Holidays", accessRole: "reader" },
          ],
        }),
      );
    calls.push(`${method} ${path}`);
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("/gone")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ id: "e1" }));
  }) as typeof fetch;
  try {
    const cal = new CalendarService(store, "s", async () => "token");
    const input = {
      title: "Call",
      allDay: false,
      start: "2026-10-20T09:00:00Z",
      end: "2026-10-20T10:00:00Z",
    };
    expect(await cal.createEvent("primary@x", input)).toEqual({ id: "e1" });
    await cal.updateEvent("primary@x", "e1", input);
    await cal.deleteEvent("primary@x", "e1");
    expect(calls).toEqual([
      "POST /calendars/primary@x/events",
      "PATCH /calendars/primary@x/events/e1",
      "DELETE /calendars/primary@x/events/e1",
    ]);
    await expect(cal.deleteEvent("holidays", "h1")).rejects.toThrow(
      "can't be edited",
    );
    await expect(cal.updateEvent("primary@x", "gone", input)).rejects.toThrow(
      "no longer exists",
    );
    expect(calls).toHaveLength(4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
