import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateGroups,
  groupPairs,
  groupScore,
  groupPreferenceWarnings,
  groupPriorityScore,
  publishBlockers,
  validateGroups,
} from "../src/lib/grouping.ts";
import {
  defaultRules,
  type Participant,
  type GroupRules,
} from "../src/lib/activityTypes.ts";
const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `会員${i}`,
    gender: i % 4 < 2 ? "female" : "male",
    grade: i % 4 < 2 ? "1" : "2",
  }));
const rules = (n: number): GroupRules => ({
  ...defaultRules(),
  count: n,
  leaders: Array.from({ length: n }, (_, i) => `p${i * 4}`),
});

test("graduate and upper undergraduate years share the four-and-above balancing category", async () => {
  const p: Participant[] = [
    "master",
    "doctorate",
    "4",
    "5",
    "6",
    "alumni",
    "2",
    "3",
  ].map((grade, i) => ({
    id: `p${i}`,
    name: `会員${i}`,
    gender: "male",
    grade: grade as Participant["grade"],
  }));
  const groups = [
    { leaderId: "p0", memberIds: ["p0", "p1", "p2", "p6"] },
    { leaderId: "p3", memberIds: ["p3", "p4", "p5", "p7"] },
  ];
  const upperYearsAsFour = p.map((person) => ({
    ...person,
    grade:
      person.grade === "2" || person.grade === "3"
        ? person.grade
        : ("4" as const),
  }));
  assert.deepEqual(groupScore(p, groups), groupScore(upperYearsAsFour, groups));
  const r = { ...rules(2), leaders: ["p0", "p3"] };
  const result = await generateGroups(p, r, new Set(), {
    budgetMs: 100,
    seed: 42,
  });
  assert.equal(result.status, "found");
  assert.deepEqual(validateGroups(p, r, result.groups!), []);
});

test("all attendees appear once; size, leaders, together/apart and singleton rules hold", async () => {
  const p = people(24),
    r = {
      ...rules(4),
      together: [
        ["p1", "p2"],
        ["p2", "p3"],
      ],
      apart: [["p5", "p9"]],
    };
  const result = await generateGroups(p, r, new Set(), {
    seed: 42,
    budgetMs: 300,
  });
  assert.equal(result.status, "found");
  assert.deepEqual(validateGroups(p, r, result.groups!), []);
  assert.deepEqual(groupPreferenceWarnings(result.groups!, r), []);
  assert.equal(new Set(result.groups!.flatMap((g) => g.memberIds)).size, 24);
});
test("0/1/2 women or first-years, including overlapping attributes", async () => {
  const p = people(8).map((p) => ({
    ...p,
    gender: "male" as const,
    grade: "2" as const,
  })) as Participant[];
  const r = rules(1);
  assert.equal(
    (await generateGroups(p, r, new Set(), { budgetMs: 80 })).status,
    "found",
  );
  p[0].gender = "female";
  assert.match((await generateGroups(p, r)).problems.join(), /女性.*1人/);
  p[1].gender = "female";
  p[0].grade = "1";
  assert.match((await generateGroups(p, r)).problems.join(), /1年生.*1人/);
  p[1].grade = "1";
  assert.equal(
    (await generateGroups(p, r, new Set(), { budgetMs: 80 })).status,
    "found",
  );
});
test("conflicting preferences fall back to a valid plan while capacity remains mandatory", async () => {
  const p = people(12),
    r = rules(2);
  const conflicts = [
    {
      ...r,
      together: [
        ["p0", "p1"],
        ["p1", "p4"],
      ],
    },
    {
      ...r,
      together: [
        ["p1", "p2"],
        ["p2", "p3"],
      ],
      apart: [["p1", "p3"]],
    },
    {
      ...r,
      together: Array.from({ length: 8 }, (_, i) => [`p${i}`, `p${i + 1}`]),
    },
  ];
  for (const conflict of conflicts) {
    const result = await generateGroups(p, conflict, new Set(), {
      seed: 42,
      budgetMs: 200,
    });
    assert.equal(result.status, "found");
    assert.deepEqual(validateGroups(p, conflict, result.groups!), []);
    assert.ok(
      groupPreferenceWarnings(result.groups!, conflict).some(
        (w) => w.kind === "together",
      ),
    );
    assert.equal(
      groupPreferenceWarnings(result.groups!, conflict).filter(
        (w) => w.kind === "apart",
      ).length,
      0,
    );
  }
  assert.equal(
    (await generateGroups(p, { ...r, max: 5 })).status,
    "impossible",
  );
  const small = people(4).map((p) => ({
    ...p,
    gender: "male" as const,
    grade: "2" as const,
  }));
  const hard = {
    count: 2,
    min: 2,
    max: 2,
    leaders: ["p0", "p1"],
    together: [],
    apart: [
      ["p0", "p2"],
      ["p0", "p3"],
    ],
  };
  const result = await generateGroups(small, hard, new Set(), {
    seed: 42,
    budgetMs: 200,
  });
  assert.equal(result.status, "found");
  assert.deepEqual(validateGroups(small, hard, result.groups!), []);
  assert.equal(
    groupPreferenceWarnings(result.groups!, hard).filter(
      (w) => w.kind === "apart",
    ).length,
    1,
  );
});
test("timeout is distinct from infeasibility and never supplies an invalid plan", async () => {
  const result = await generateGroups(people(80), rules(10), new Set(), {
    budgetMs: 0,
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.groups, null);
});
test("80 participants fit within the bounded search and maintain every hard constraint", async () => {
  const start = performance.now();
  const p = people(80),
    r = rules(10);
  const result = await generateGroups(p, r, new Set(), {
    seed: 123,
    budgetMs: 500,
  });
  assert.equal(result.status, "found");
  assert.deepEqual(validateGroups(p, r, result.groups!), []);
  assert.ok(performance.now() - start < 2000);
});
test("previous-event repeated pairs decrease while sizes stay balanced", async () => {
  const p = people(16).map((p) => ({
    ...p,
    gender: "male" as const,
    grade: "2" as const,
  }));
  const r = { ...rules(4), min: 4, max: 4 };
  const original = r.leaders.map((leaderId, i) => ({
    leaderId,
    memberIds: Array.from({ length: 4 }, (_, j) => `p${i * 4 + j}`),
  }));
  const history = groupPairs(original);
  const generated = await generateGroups(p, r, history, {
    seed: 7,
    budgetMs: 300,
  });
  assert.deepEqual(validateGroups(p, r, generated.groups!), []);
  assert.ok(
    groupScore(p, generated.groups!, history)[1] <
      groupScore(p, original, history)[1],
  );
});
test("manual edits cannot publish duplicate, missing, outsider, wrong leader or singleton assignments", () => {
  const p = people(8),
    r = rules(2);
  const groups = [
    { leaderId: "p0", memberIds: ["p0", "p1", "p2", "p3"] },
    { leaderId: "p4", memberIds: ["p4", "p5", "p6", "p7"] },
  ];
  assert.deepEqual(validateGroups(p, r, groups), []);
  for (const change of [
    (g: typeof groups) => {
      g[0].memberIds[3] = "p0";
    },
    (g: typeof groups) => {
      g[0].memberIds[3] = "outside";
    },
    (g: typeof groups) => {
      g[0].leaderId = "p2";
    },
    (g: typeof groups) => {
      [g[0].memberIds[1], g[1].memberIds[2]] = [
        g[1].memberIds[2],
        g[0].memberIds[1],
      ];
    },
  ]) {
    const invalid = structuredClone(groups);
    change(invalid);
    assert.ok(validateGroups(p, r, invalid).length);
  }
});

test("a lone woman or first-year can be confirmed, but every other mandatory problem still blocks", () => {
  const p = people(8),
    r = rules(2);
  const lone = [
    { leaderId: "p0", memberIds: ["p0", "p1", "p5", "p3"] },
    { leaderId: "p4", memberIds: ["p4", "p2", "p6", "p7"] },
  ];
  assert.deepEqual(validateGroups(p, r, lone), [
    "2班で女性が1人です。",
    "2班で1年生が1人です。",
  ]);
  assert.deepEqual(publishBlockers(p, r, lone), []);
  const alone = p.map((person) =>
    person.id === "p0" ? person : { ...person, gender: "male" as const, grade: "2" as const },
  );
  assert.equal(validateGroups(alone, r, lone).length, 4);
  assert.deepEqual(publishBlockers(alone, r, lone), []);
  for (const change of [
    (g: typeof lone) => {
      g[1].memberIds.push(g[0].memberIds.pop()!);
    },
    (g: typeof lone) => {
      g[0].leaderId = "p1";
    },
    (g: typeof lone) => {
      g[0].memberIds[3] = "p2";
    },
  ]) {
    const invalid = structuredClone(lone);
    change(invalid);
    const blockers = publishBlockers(p, r, invalid);
    assert.ok(blockers.length);
    assert.ok(blockers.every((problem) => !/が1人/.test(problem)));
    assert.ok(validateGroups(p, r, invalid).length > blockers.length);
  }
});

test("apart overrides together, which overrides previous pairs without weighted tradeoffs", async () => {
  const p = people(8).map((p) => ({
    ...p,
    gender: "male" as const,
    grade: "2" as const,
  }));
  const r = {
    ...rules(2),
    min: 4,
    max: 4,
    together: [
      ["p0", "p1"],
      ["p0", "p2"],
    ],
    apart: [["p0", "p1"]],
  };
  const history = groupPairs([
    { leaderId: "p0", memberIds: p.map((p) => p.id) },
  ]);
  const result = await generateGroups(p, r, history, {
    seed: 42,
    budgetMs: 400,
  });
  assert.equal(result.status, "found");
  assert.deepEqual(validateGroups(p, r, result.groups!), []);
  const score = groupPriorityScore(p, r, result.groups!, history);
  assert.deepEqual(score.slice(0, 3), [0, 1, 12]);
  assert.ok(
    result
      .groups!.find((g) => g.memberIds.includes("p0"))!
      .memberIds.includes("p2"),
  );
});
test("warning pairs identify both affected people, deduplicate rules and ignore unplaced members", () => {
  const groups = [
    { leaderId: "p0", memberIds: ["p0", "p1"] },
    { leaderId: "p2", memberIds: ["p2", "p3"] },
  ];
  const r = {
    ...rules(2),
    apart: [
      ["p0", "p1"],
      ["p1", "p0"],
    ],
    together: [
      ["p0", "p2"],
      ["p0", "missing"],
    ],
  };
  assert.deepEqual(
    groupPreferenceWarnings(groups, r, groupPairs([groups[0]])),
    [
      { kind: "apart", ids: ["p0", "p1"] },
      { kind: "together", ids: ["p0", "p2"] },
      { kind: "repeat", ids: ["p0", "p1"] },
    ],
  );
});
