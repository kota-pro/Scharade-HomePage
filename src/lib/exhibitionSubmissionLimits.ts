import { paperSizes } from './exhibitionEditing.ts';
import { layoutBounds } from './exhibitionGeometry.ts';
import type { EffectiveSubmissionLimits, FormSchema, LimitIssue, SectionLimits, SubmissionContent } from './exhibitionTypes.ts';

/** Questions stay pinned to their version; limits follow the last setting for each section ID. */
export function effectiveSubmissionLimits(schemas: FormSchema[]): EffectiveSubmissionLimits {
  const sections: EffectiveSubmissionLimits['sections'] = {};
  for (const schema of schemas) for (const s of schema.sections) sections[s.id] = { ...s.limits, title: s.title };
  return { ...(schemas.at(-1)?.limits?.maxWorks === undefined ? {} : { maxWorks: schemas.at(-1)!.limits!.maxWorks }), sections };
}
/** Configured submission caps count photos/series; books have a separate quantity field. */
export const sectionWorkCount = (s: SubmissionContent['sections'][number]) => s.singles + s.series;
export function describeSectionLimits(rule: SectionLimits): string[] {
  const frames = paperSizes.filter(p => rule.frameSizeIds?.includes(p.id));
  return [
    ...(rule.maxWorks === undefined ? [] : [`最大${rule.maxWorks}作品`]),
    ...(frames.length ? [`外枠：${frames.map(p => `${'label' in p ? p.label : p.id}（${p.width}×${p.height}mm）`).join(' または ')}以内`] : []),
    ...(rule.maxLongEdgeMm === undefined ? [] : [`長辺${rule.maxLongEdgeMm}mm以内`]),
    ...(rule.maxShortEdgeMm === undefined ? [] : [`短辺${rule.maxShortEdgeMm}mm以内`]),
  ];
}
export function submissionLimitIssues(content: SubmissionContent, limits: EffectiveSubmissionLimits): LimitIssue[] {
  const issues: LimitIssue[] = [], total = content.sections.reduce((n, s) => n + sectionWorkCount(s), 0);
  if (limits.maxWorks !== undefined && total > limits.maxWorks) issues.push({ code: 'total-count', message: `全展示合計は最大${limits.maxWorks}作品です（現在${total}作品）。` });
  for (const s of content.sections) {
    const rule = limits.sections[s.sectionId], count = sectionWorkCount(s);
    if (rule?.maxWorks !== undefined && count > rule.maxWorks) issues.push({ code: 'section-count', sectionId: s.sectionId, message: `「${rule.title}」は最大${rule.maxWorks}作品です（現在${count}作品）。` });
  }
  for (const w of content.works) {
    const rule = limits.sections[w.sectionId];
    if (!rule || w.kind === 'book' || !w.photos.length) continue;
    const b = layoutBounds(w.photos), long = Math.max(b.width, b.height), short = Math.min(b.width, b.height), eps = 1e-6;
    const frames = paperSizes.filter(p => rule.frameSizeIds?.includes(p.id));
    const fitsFrame = !frames.length || frames.some(p => long <= Math.max(p.width,p.height) + eps && short <= Math.min(p.width,p.height) + eps);
    if (!fitsFrame || rule.maxLongEdgeMm !== undefined && long > rule.maxLongEdgeMm + eps || rule.maxShortEdgeMm !== undefined && short > rule.maxShortEdgeMm + eps) {
      issues.push({ code: 'size', sectionId: w.sectionId, workId: w.id, message: `「${w.title || '無題の作品'}」の外寸（${b.width.toFixed(1)}×${b.height.toFixed(1)}mm）が「${rule.title}」の上限を超えています。${describeSectionLimits({ ...rule, maxWorks: undefined }).join('・')}。` });
    }
  }
  return issues;
}
