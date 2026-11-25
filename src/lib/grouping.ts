import type { Group, GroupRules, Participant } from "./activityTypes.ts";
import { groupGrade } from "./groupingGrade.ts";
const yieldTask = (_ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export function pairKey(a: string, b: string) {
  return JSON.stringify([a, b].sort());
}
export function groupPairs(groups: Group[]): Set<string> {
  const pairs = new Set<string>();
  for (const g of groups)
    for (let i = 0; i < g.memberIds.length; i++)
      for (let j = i + 1; j < g.memberIds.length; j++)
        pairs.add(pairKey(g.memberIds[i], g.memberIds[j]));
  return pairs;
}
type ProblemOptions = { singletons?: boolean };
export function ruleProblems(
  people: Participant[],
  rules: GroupRules,
  { singletons = true }: ProblemOptions = {},
): string[] {
  const problems: string[] = [];
  const ids = new Set(people.map((p) => p.id));
  if (
    ![rules.count, rules.min, rules.max].every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 200,
    ) ||
    rules.min > rules.max
  )
    return ["班数・人数の上下限は1〜200の整数で、下限≦上限にしてください。"];
  if (
    people.length < rules.count * rules.min ||
    people.length > rules.count * rules.max
  )
    problems.push(
      `参加者${people.length}人を${rules.count}班（各${rules.min}〜${rules.max}人）に分けられません。班数または人数範囲を変更してください。`,
    );
  if (
    rules.leaders.length !== rules.count ||
    new Set(rules.leaders).size !== rules.count ||
    rules.leaders.some((id) => !ids.has(id))
  )
    problems.push(
      "各班に異なる参加者を1人ずつリーダーとして指定してください。",
    );
  for (const sets of [rules.together, rules.apart])
    for (const pair of sets)
      if (
        pair.length !== 2 ||
        pair[0] === pair[1] ||
        pair.some((id) => !ids.has(id))
      )
        problems.push("同班・別班指定は、異なる参加者2人を選択してください。");
  if (singletons && people.filter((p) => p.gender === "female").length === 1)
    problems.push(
      "女性の参加者が全体で1人のため、単独配置禁止を満たせません。",
    );
  if (singletons && people.filter((p) => p.grade === "1").length === 1)
    problems.push(
      "1年生の参加者が全体で1人のため、単独配置禁止を満たせません。",
    );
  return [...new Set(problems)];
}
export function validateGroups(
  people: Participant[],
  rules: GroupRules,
  groups: Group[],
  options: ProblemOptions = {},
): string[] {
  const singletons = options.singletons ?? true;
  const problems = ruleProblems(people, rules, options);
  const placed = groups.flatMap((g) => g.memberIds);
  const ids = new Set(people.map((p) => p.id));
  if (groups.length !== rules.count)
    problems.push("班数が指定と一致していません。");
  if (
    placed.length !== people.length ||
    new Set(placed).size !== placed.length ||
    placed.some((id) => !ids.has(id))
  )
    problems.push("参加者の重複・未配置・対象外のメンバーがあります。");
  const index = new Map<string, number>();
  groups.forEach((g, i) => {
    g.memberIds.forEach((id) => index.set(id, i));
    if (g.memberIds.length < rules.min || g.memberIds.length > rules.max)
      problems.push(`${i + 1}班の人数が範囲外です。`);
    if (g.leaderId !== rules.leaders[i] || !g.memberIds.includes(g.leaderId))
      problems.push(`${i + 1}班の指定リーダーを配置してください。`);
    if (!singletons) return;
    const members = people.filter((p) => g.memberIds.includes(p.id));
    if (members.filter((p) => p.gender === "female").length === 1)
      problems.push(`${i + 1}班で女性が1人です。`);
    if (members.filter((p) => p.grade === "1").length === 1)
      problems.push(`${i + 1}班で1年生が1人です。`);
  });
  return [...new Set(problems)];
}
/** Problems that still block confirming. A lone woman or first-year in a group
 * stays in 要修正 but may be confirmed explicitly; every other check blocks. */
export function publishBlockers(
  people: Participant[],
  rules: GroupRules,
  groups: Group[],
): string[] {
  return validateGroups(people, rules, groups, { singletons: false });
}
export function groupScore(
  people: Participant[],
  groups: Group[],
  history = new Set<string>(),
) {
  const sizes = groups.map((g) => g.memberIds.length);
  const size = sizes.reduce(
    (sum, n) => sum + (n * groups.length - people.length) ** 2,
    0,
  );
  const repeated = [...groupPairs(groups)].filter((p) => history.has(p)).length;
  let diversity = 0;
  const categoryFor = (p: Participant, key: "gender" | "grade") =>
    key === "grade" ? groupGrade(p.grade) : p.gender;
  for (const key of ["gender", "grade"] as const)
    for (const category of new Set(people.map((p) => categoryFor(p, key)))) {
      const total = people.filter(
        (p) => categoryFor(p, key) === category,
      ).length;
      for (const g of groups) {
        const count = people.filter(
          (p) => categoryFor(p, key) === category && g.memberIds.includes(p.id),
        ).length;
        diversity +=
          (count - (total * g.memberIds.length) / Math.max(people.length, 1)) **
          2;
      }
    }
  return [size, repeated, diversity];
}
function compare(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++)
    if (Math.abs(a[i] - b[i]) > 1e-8) return a[i] - b[i];
  return 0;
}

/** Bounded, cooperative search: never labels a timeout as a proof of impossibility. */
async function constrainedGroups(
  people: Participant[],
  rules: GroupRules,
  history = new Set<string>(),
  options: { budgetMs?: number; seed?: number } = {},
  priorities: GroupRules = rules,
) {
  const problems = ruleProblems(people, rules);
  const parent = new Map(people.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    let r = id;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  if (!problems.length)
    for (const [a, b] of rules.together) parent.set(root(a), root(b));
  const components = new Map<string, Participant[]>();
  for (const p of people) {
    const r = root(p.id);
    components.set(r, [...(components.get(r) || []), p]);
  }
  const blocks = [...components.values()];
  for (const block of blocks) {
    if (block.length > rules.max)
      problems.push("同班指定でつながる人数が、1班の上限を超えています。");
    if (rules.leaders.filter((id) => block.some((p) => p.id === id)).length > 1)
      problems.push("別の班のリーダー同士が同班指定でつながっています。");
  }
  for (const [a, b] of rules.apart)
    if (root(a) === root(b))
      problems.push(
        "同じメンバーの組合せが同班・別班の両方に指定されています。",
      );
  if (problems.length)
    return {
      status: "impossible" as const,
      problems: [...new Set(problems)],
      groups: null,
      score: null,
    };
  let seed = (options.seed ?? Date.now()) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const until = performance.now() + (options.budgetMs ?? 2000);
  let nodes = 0,
    timedOut = false;
  let best: Group[] | null = null,
    bestScore: number[] | null = null;
  const forbidden = new Set(rules.apart.map(([a, b]) => pairKey(a, b)));
  const groups: Group[] = rules.leaders.map((leaderId) => ({
    leaderId,
    memberIds: [],
  }));
  const forced = (block: Participant[]) =>
    rules.leaders.findIndex((id) => block.some((p) => p.id === id));
  blocks.sort(
    (a, b) =>
      (forced(a) < 0 ? 1 : 0) - (forced(b) < 0 ? 1 : 0) ||
      b.length - a.length ||
      random() - 0.5,
  );
  const counts = groups.map(() => ({ female: 0, first: 0 }));
  const remaining = blocks.map((_, i) => blocks.slice(i).flat());
  const feasible = (next: number) => {
    const rest = remaining[next] || [];
    if (
      groups.reduce(
        (s, g) => s + Math.max(0, rules.min - g.memberIds.length),
        0,
      ) > rest.length
    )
      return false;
    for (const [field, total] of [
      ["female", rest.filter((p) => p.gender === "female").length],
      ["first", rest.filter((p) => p.grade === "1").length],
    ] as const) {
      if (counts.filter((c) => c[field] === 1).length > total) return false;
      if (
        counts.some(
          (c, i) => c[field] === 1 && groups[i].memberIds.length >= rules.max,
        )
      )
        return false;
    }
    return true;
  };
  const visit = async (at: number): Promise<boolean> => {
    if ((++nodes & 255) === 0) {
      await yieldTask(0);
      if (performance.now() >= until) {
        timedOut = true;
        return true;
      }
    }
    if (at === blocks.length) {
      if (validateGroups(people, rules, groups).length) return false;
      best = structuredClone(groups);
      bestScore = groupPriorityScore(people, priorities, groups, history);
      return true;
    }
    const block = blocks[at],
      fixed = forced(block);
    const assigned = new Map(
      groups.flatMap((g, i) => g.memberIds.map((id) => [id, i] as const)),
    );
    const blockIds = new Set(block.map((p) => p.id));
    const pairCost = (pairs: string[][], i: number, together: boolean) =>
      pairs.filter(([a, b]) => {
        const other = blockIds.has(a) ? b : blockIds.has(b) ? a : undefined;
        return (
          other !== undefined &&
          assigned.has(other) &&
          (together ? assigned.get(other) !== i : assigned.get(other) === i)
        );
      }).length;
    const choices = groups
      .map((g, i) => ({
        i,
        n: g.memberIds.length,
        apart: pairCost(priorities.apart, i, false),
        together: pairCost(priorities.together, i, true),
        repeats: block.reduce(
          (s, p) =>
            s +
            g.memberIds.filter((id) => history.has(pairKey(id, p.id))).length,
          0,
        ),
        noise: random(),
      }))
      .filter((x) => fixed < 0 || x.i === fixed)
      .sort(
        (a, b) =>
          a.apart - b.apart ||
          a.together - b.together ||
          a.repeats - b.repeats ||
          a.n - b.n ||
          a.noise - b.noise,
      );
    for (const { i } of choices) {
      const g = groups[i];
      if (
        g.memberIds.length + block.length > rules.max ||
        block.some((p) =>
          g.memberIds.some((id) => forbidden.has(pairKey(p.id, id))),
        )
      )
        continue;
      const f = block.filter((p) => p.gender === "female").length,
        y = block.filter((p) => p.grade === "1").length;
      g.memberIds.push(...block.map((p) => p.id));
      counts[i].female += f;
      counts[i].first += y;
      const stop = feasible(at + 1) && (await visit(at + 1));
      g.memberIds.splice(g.memberIds.length - block.length);
      counts[i].female -= f;
      counts[i].first -= y;
      if (stop) return true;
    }
    return false;
  };
  if (performance.now() >= until) timedOut = true;
  else await visit(0);
  if (!best)
    return {
      status: timedOut ? ("timeout" as const) : ("impossible" as const),
      problems: [
        timedOut
          ? "時間内に有効な班案が見つかりませんでした。再生成するか条件を確認してください。成立しないことを意味するものではありません。"
          : "指定された条件をすべて満たす班分けはありません。条件を見直してください。",
      ],
      groups: null,
      score: null,
    };
  // Move/swap whole together-components; leaders remain anchored.
  const movable = blocks
    .filter((b) => forced(b) < 0)
    .map((b) => b.map((p) => p.id));
  for (
    let attempt = 0;
    attempt < 6000 && performance.now() < until && movable.length;
    attempt++
  ) {
    if ((attempt & 31) === 0) await yieldTask(0);
    const candidate: Group[] = structuredClone(best);
    const a = movable[Math.floor(random() * movable.length)];
    const from = candidate.findIndex((g) => g.memberIds.includes(a[0]));
    const to = Math.floor(random() * candidate.length);
    if (from === to) continue;
    const b =
      random() < 0.75
        ? movable.find(
            (b) =>
              candidate[to].memberIds.includes(b[0]) && b.length === a.length,
          ) || []
        : [];
    candidate[from].memberIds = candidate[from].memberIds
      .filter((id) => !a.includes(id))
      .concat(b);
    candidate[to].memberIds = candidate[to].memberIds
      .filter((id) => !b.includes(id))
      .concat(a);
    if (
      validateGroups(people, rules, candidate).length ||
      groupPreferenceWarnings(candidate, rules).length
    )
      continue;
    const score = groupPriorityScore(people, priorities, candidate, history);
    if (compare(score, bestScore!) < 0) {
      best = candidate;
      bestScore = score;
    }
  }
  return {
    status: "found" as const,
    problems: [],
    groups: best,
    score: groupScore(people, best, history),
  };
}

export type GroupPreferenceWarning = {
  kind: "apart" | "together" | "repeat";
  ids: [string, string];
};
/** Preferences can conflict; structural/singleton constraints remain mandatory. */
export function groupPreferenceWarnings(
  groups: Group[],
  rules: GroupRules,
  history = new Set<string>(),
): GroupPreferenceWarning[] {
  const index = new Map(
    groups.flatMap((g, i) => g.memberIds.map((id) => [id, i] as const)),
  );
  const warnings: GroupPreferenceWarning[] = [];
  for (const kind of ["apart", "together"] as const) {
    for (const key of new Set(rules[kind].map(([a, b]) => pairKey(a, b)))) {
      const ids = JSON.parse(key) as [string, string];
      if (
        ids.every((id) => index.has(id)) &&
        (kind === "apart"
          ? index.get(ids[0]) === index.get(ids[1])
          : index.get(ids[0]) !== index.get(ids[1]))
      )
        warnings.push({ kind, ids });
    }
  }
  for (const key of groupPairs(groups))
    if (history.has(key))
      warnings.push({ kind: "repeat", ids: JSON.parse(key) });
  return warnings;
}
export function groupPriorityScore(
  people: Participant[],
  rules: GroupRules,
  groups: Group[],
  history = new Set<string>(),
) {
  const warnings = groupPreferenceWarnings(groups, rules, history);
  const [size, repeated, diversity] = groupScore(people, groups, history);
  return [
    warnings.filter((w) => w.kind === "apart").length,
    warnings.filter((w) => w.kind === "together").length,
    repeated,
    size,
    diversity,
  ];
}

/** Prefer all requests, then preserve apart requests, then minimize unavoidable
 * violations lexicographically. Each phase has a bounded, shared time budget. */
export async function generateGroups(
  people: Participant[],
  rules: GroupRules,
  history = new Set<string>(),
  options: { budgetMs?: number; seed?: number } = {},
) {
  const problems = ruleProblems(people, rules);
  if (problems.length)
    return {
      status: "impossible" as const,
      problems,
      groups: null,
      score: null,
    };
  const until = performance.now() + (options.budgetMs ?? 2000);
  const phases = [
    rules,
    { ...rules, together: [] },
    { ...rules, together: [], apart: [] },
  ];
  let last: Awaited<ReturnType<typeof constrainedGroups>> | undefined;
  for (let i = 0; i < phases.length; i++) {
    if (i > 0 && JSON.stringify(phases[i]) === JSON.stringify(phases[i - 1]))
      continue;
    const remaining = until - performance.now();
    if (remaining <= 0)
      return {
        status: "timeout" as const,
        problems: [
          "時間内に有効な班案が見つかりませんでした。再生成するか条件を確認してください。成立しないことを意味するものではありません。",
        ],
        groups: null,
        score: null,
      };
    const laterDifferent = phases
      .slice(i + 1)
      .some((p) => JSON.stringify(p) !== JSON.stringify(phases[i]));
    last = await constrainedGroups(
      people,
      phases[i],
      history,
      { ...options, budgetMs: remaining * (laterDifferent ? 0.45 : 1) },
      rules,
    );
    if (last.groups) return last;
  }
  return last!;
}
