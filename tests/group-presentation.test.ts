import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortGroupPeople,
  displayName,
  nameParts,
  personStyle,
  personLabel,
  publishedGroupPeople,
} from "../src/lib/groupPresentation.ts";
import { groupGradeLabel } from "../src/lib/groupingGrade.ts";
import type { Participant, PublishedGroups } from "../src/lib/activityTypes.ts";
test("leader first, then descending academic year; styling uses the requested colors and a whole first grapheme", () => {
  const people: Participant[] = ["4", "2", "1", "3"].map((grade, i) => ({
    id: String(i),
    name: `会員${i}`,
    grade: grade as Participant["grade"],
    gender: i % 2 ? "female" : "male",
  }));
  assert.deepEqual(
    sortGroupPeople(people, "0").map((p) => p.grade),
    ["4", "3", "2", "1"],
  );
  assert.equal(
    personStyle(people[0]),
    "--gender-color:#99ccff;--grade-color:#4d4398",
  );
  assert.equal(
    personStyle(people[1]),
    "--gender-color:#ff99ff;--grade-color:#a0d8ef",
  );
  assert.equal(
    personStyle(people[3]),
    "--gender-color:#ff99ff;--grade-color:#38b48b",
  );
  assert.deepEqual(
    sortGroupPeople(people, "2").map((p) => p.grade),
    ["1", "4", "3", "2"],
  );
  assert.equal(
    personStyle(people[2]),
    "--gender-color:#99ccff;--grade-color:#f2f2b0",
  );
  for (const grade of [
    "4",
    "5",
    "6",
    "master",
    "doctorate",
    "alumni",
  ] as const) {
    assert.match(
      personStyle({ ...people[0], grade }),
      /--grade-color:#4d4398$/,
    );
    assert.equal(groupGradeLabel(grade), "4年以上");
    assert.match(personLabel({ ...people[0], grade }, false), /、4年以上$/);
  }
  assert.equal(groupGradeLabel("1"), "1年生");
  assert.equal(groupGradeLabel("other"), "その他");
  assert.deepEqual(nameParts("か\u3099藤"), ["か\u3099", "藤"]);
  assert.deepEqual(nameParts(""), ["", ""]);
});
test("confirmed presentation uses snapshots and old plans fall back to clean roster names", () => {
  const person: Participant = {
    id: "a",
    name: "会員",
    gender: "female",
    grade: "1",
  };
  const plan = {
    groups: [{ leaderId: "a", memberIds: ["a"] }],
    names: { a: "会員（大学）" },
  } as unknown as PublishedGroups;
  assert.deepEqual(publishedGroupPeople(plan, [person]), [person]);
  plan.people = [person];
  assert.deepEqual(publishedGroupPeople(plan, []), [person]);
});

test("LINE names use parentheses and older confirmed plans can use current roster LINE names", () => {
  assert.equal(
    displayName({ name: "岡元昊太", lineName: " kota " }),
    "岡元昊太（kota）",
  );
  assert.equal(displayName({ name: "岡元昊太", lineName: " " }), "岡元昊太");
  const person: Participant = {
    id: "a",
    name: "会員",
    gender: "female",
    grade: "1",
  };
  const plan = {
    groups: [{ leaderId: "a", memberIds: ["a"] }],
    names: { a: person.name },
    people: [person],
  } as unknown as PublishedGroups;
  assert.deepEqual(
    publishedGroupPeople(plan, [
      { ...person, name: "変更後", lineName: "line" },
    ]),
    [{ ...person, lineName: "line" }],
  );
});
