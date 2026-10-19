import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWeeks, calendarCategory } from "../src/lib/activityCalendar.ts";

test("calendar begins on Monday, spans weeks and excludes an end at midnight", () => {
  const entry = { id: "test", kind: "event", startsAt: "2026-10-02T09:00:00+09:00", endsAt: "2026-10-06T00:00:00+09:00" };
  const weeks = calendarWeeks("2026-10", [entry]);
  assert.deepEqual(weeks[0].days, [null,null,null,1,2,3,4]);
  assert.deepEqual(weeks.flatMap(w=>w.segments.map(s=>[s.firstDay,s.lastDay,s.span])), [[2,4,3],[5,5,1]]);
  assert.equal(weeks[0].segments[0].continuesAfter,true);
  assert.equal(weeks[1].segments[0].continuesBefore,true);
  assert.equal(calendarCategory(entry),"other");
  assert.equal(calendarCategory({kind:"exhibition-vote"}),"exhibition");
});
test("calendar clips at month boundaries and allocates separate overlapping lanes", () => {
  const entries = [
    {id:"a",kind:"event",startsAt:"2026-09-30T00:00:00+09:00",endsAt:"2026-10-04T00:00:00+09:00"},
    {id:"b",kind:"event",startsAt:"2026-10-02T00:00:00+09:00",endsAt:"2026-10-03T00:00:00+09:00"},
    {id:"c",kind:"event",startsAt:"2026-10-30T00:00:00+09:00",endsAt:"2026-11-03T00:00:00+09:00"}
  ];
  const weeks=calendarWeeks("2026-10",entries), first=weeks[0].segments;
  assert.equal(first[0].firstDay,1); assert.equal(first[0].continuesBefore,true);
  assert.notEqual(first[0].lane,first[1].lane);
  const last=weeks.at(-1)!.segments[0]; assert.equal(last.lastDay,31); assert.equal(last.continuesAfter,true);
});
