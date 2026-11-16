import { latestContent, type Submission, type SubmissionContent } from './exhibitionTypes.ts';

/** Shared by the form preview, staff review, room preview and print output. */
export function submissionQrTarget(submission: Submission, origin: string, content = latestContent(submission)) {
  const accountUrl = submission.portfolioId
    ? `${origin.replace(/\/$/, '')}/Portfolio/${encodeURIComponent(submission.portfolioId)}` : '';
  // A deliberate staff choice can override the author's URL. Legacy automatic
  // account matches have no qrSource and must not hide an explicitly entered URL.
  if (submission.qrSource === 'account' && accountUrl)
    return { url: accountUrl, confirmed: !!submission.qrConfirmed, portfolioId: submission.portfolioId, source: 'account' as const };
  const external = content?.portfolioUrl?.trim() ?? '';
  if (external) {
    try {
      const url = new URL(external);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port)
        return { url: external, confirmed: true, portfolioId: undefined, source: 'external' as const };
    } catch {}
    return { url: '', confirmed: false, portfolioId: undefined, source: 'external' as const };
  }
  return { url: accountUrl, confirmed: !!accountUrl && !!submission.qrConfirmed, portfolioId: submission.portfolioId, source: 'account' as const };
}

/** Re-evaluate the default only when the author changes the name or URL. */
export function resetSubmissionQr(submission: Submission, content: SubmissionContent, accountPortfolioId?: string) {
  delete submission.qrSource;
  submission.portfolioId = content.portfolioUrl ? undefined : accountPortfolioId;
  submission.qrConfirmed = !!(content.portfolioUrl || submission.portfolioId);
}
