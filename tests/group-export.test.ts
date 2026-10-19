import { test } from "node:test";
import assert from "node:assert/strict";
import { groupExportData, groupExportText, groupExportHeading } from "../src/lib/groupExport.ts";
import type { Participant } from "../src/lib/activityTypes.ts";

test("TXT uses full-width group numbers, LINE names, leader marks, blank lines and a single legend", () => {
  const people: Participant[] = [
    { id: "a", name: "岡元昊太", lineName: " kota ", grade: "1", gender: "male" },
    { id: "b", name: "関谷日菜美", grade: "3", gender: "female" },
    { id: "c", name: "氏名", lineName: "誠", grade: "4", gender: "male" },
    { id: "d", name: "別の氏名", lineName: "n a g", grade: "2", gender: "male" },
    { id: "e", name: "いつき", lineName: " ", grade: "2", gender: "female" },
  ];
  const before = structuredClone(people);
  const data = groupExportData(people, [{ leaderId: "a", memberIds: ["b", "c", "a"] }, { leaderId: "e", memberIds: ["d", "e"] }], ["a"], "撮影会");
  assert.equal(groupExportText(data.sections), "１班：\n◎kota、誠、関谷日菜美\n\n２班：\n◎いつき、n a g\n\n◎：班長");
  assert.equal(groupExportHeading(12), "１２班");
  assert.deepEqual(people, before);
  assert.deepEqual(data.flaggedIds, ["a"]);
});
