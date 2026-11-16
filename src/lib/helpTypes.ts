import type { Role } from './roles.ts';

export type HelpCompletion = { kind: 'fields' | 'present'; selector: string } | { kind: 'saved'; key: string };
export type HelpStep = {
  id: string; title: string; text: string; target?: string; heading?: string;
  path: string; reveal?: string; activate?: string; complete?: HelpCompletion; details?: string[];
};
export type HelpChoice = { id: string; title: string; href: string };
export type HelpGuide = {
  id: string; title: string; description: string; aliases: string[]; category: string;
  minimum?: Role; detail?: boolean; steps: HelpStep[]; choices?: HelpChoice[]; empty?: string;
};
export type HelpTask = {
  id: string; title: string; description: string; group: 'personal' | 'management';
  guideId: string; entityId?: string; href: string; dueAt?: string; optional?: boolean;
  readState?: { version: string; source: 'local' | 'accounting'; at?: string };
};
export type HelpContext = {
  viewer: { id: string; approved: boolean; role: Role; authVersion: number } | null;
  page: HelpGuide; guides: Omit<HelpGuide, 'steps' | 'choices'>[]; guide?: HelpGuide;
  completed: string[];
};

export function normalizeHelpQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s\p{P}\p{S}]/gu, '');
}
export function searchHelp<T extends { title: string; description: string; aliases: string[] }>(items: T[], query: string): T[] {
  // Intent endings carry no topic: sharing 「したい」 must not recommend contacting us.
  const topic = (value: string) => normalizeHelpQuery(value).replace(/(?:したい|したいです|したいのですが|する方法|のやり方|の使い方|について|教えてください|教えて|できますか|したいですか)[。？?]*$/u, '');
  const q = topic(query).slice(0, 200);
  if (!q) return [];
  const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const qg = grams(q);
  return items.map((item, index) => {
    const words = [item.title, ...item.aliases].map(topic).filter(Boolean);
    const score = Math.max(...words.map(w => w === q ? 100 : w.includes(q) ? 80 : q.includes(w) && w.length > 1 ? 70 : (() => {
      const wg = grams(w), overlap = [...qg].filter(g => wg.has(g)).length;
      return overlap >= 2 ? 50 * overlap / Math.max(1, Math.min(qg.size, wg.size)) : 0;
    })()));
    return { item, index, score };
  }).filter(x => x.score >= 20).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).map(x => x.item);
}

export function sortHelpTasks(tasks: HelpTask[]) {
  return tasks.sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) || a.title.localeCompare(b.title, 'ja'));
}
