import { expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  calendarRange,
  eventTouchesDay,
  timedLayout,
  type CalendarEvent,
} from "../src/calendar-layout";
const day = DateTime.fromISO("2026-10-20", { zone: "America/Denver" });
const event = (
  id: string,
  start: string,
  end: string,
  allDay = false,
): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  allDay,
  sourceName: "Test",
  color: "#777",
});
it("uses complete calendar weeks and months, including leap days and DST", () => {
  const feb = calendarRange(DateTime.fromISO("2028-02-12"), "month");
  expect(feb.from.toISODate()).toBe("2028-01-31");
  expect(feb.to.toISODate()).toBe("2028-03-06");
  expect(feb.days).toHaveLength(35);
  expect(feb.days.some((d) => d.toISODate() === "2028-02-29")).toBe(true);
  const week = calendarRange(
    DateTime.fromISO("2026-11-01", { zone: "America/Denver" }),
    "week",
  );
  expect(week.days).toHaveLength(7);
  expect(week.from.toISODate()).toBe("2026-10-26");
  expect(week.to.toISODate()).toBe("2026-11-02");
  expect(week.to.diff(week.from, "hours").hours).toBe(169);
});
it("respects exclusive event ends and local time zones", () => {
  expect(
    eventTouchesDay(event("all", "2026-10-19", "2026-10-20", true), day),
  ).toBe(false);
  expect(
    eventTouchesDay(
      event("utc", "2026-10-21T02:00Z", "2026-10-21T03:00Z"),
      day,
    ),
  ).toBe(true);
  expect(
    eventTouchesDay(
      event("midnight", "2026-10-19T23:00-06:00", "2026-10-20T00:00-06:00"),
      day,
    ),
  ).toBe(false);
});
it("clips overnight events and separates overlapping appointments", () => {
  const laid = timedLayout(
    [
      event("overnight", "2026-10-19T23:00-06:00", "2026-10-20T02:00-06:00"),
      event("a", "2026-10-20T09:00-06:00", "2026-10-20T10:00-06:00"),
      event("b", "2026-10-20T09:30-06:00", "2026-10-20T11:00-06:00"),
      event("c", "2026-10-20T10:00-06:00", "2026-10-20T10:30-06:00"),
      event("later", "2026-10-20T12:00-06:00", "2026-10-20T13:00-06:00"),
    ],
    day,
  );
  expect(laid[0]).toMatchObject({ top: 0, bottom: 120, columns: 1 });
  expect(laid.slice(1, 4).map((e) => [e.column, e.columns])).toEqual([
    [0, 2],
    [1, 2],
    [0, 2],
  ]);
  expect(laid.at(-1)).toMatchObject({ top: 720, bottom: 780, columns: 1 });
});
