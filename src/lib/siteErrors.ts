import { exhibitionErrorMessage, exhibitionErrors, isExhibitionErrorCode } from './exhibitionErrors.ts';

export const credentialMismatchMessage = 'メールアドレスまたはパスワードが間違っています。';

/** Stable, public support numbers. Feature-specific EXH numbers are retained. */
export const siteErrors = {
  'SITE-001': '入力内容を確認してください。必須項目と、各欄に表示された入力方法をご確認ください。',
  'SITE-002': 'ログインを確認できません。入力内容を控えて、再度ログインしてください。',
  'SITE-003': 'この操作を利用できません。ログイン中のアカウントを確認し、必要に応じて運営へお問い合わせください。',
  'SITE-004': '別の画面で内容が更新されています。入力内容を控えて最新の内容を読み込み直してください。',
  'SITE-005': 'ファイルを送信できませんでした。画面に表示された種類・容量の条件を確認して、もう一度選んでください。',
  'SITE-006': 'お探しのページや情報が見つかりません。案内されたリンクを開き直すか、ホームからお探しください。',
  'SITE-007': '現在は受付期間外です。受付期間を確認し、必要に応じて運営へお問い合わせください。',
  'SITE-008': '操作が集中しています。しばらく待ってから、もう一度お試しください。',
  'SITE-009': '処理結果を確認できませんでした。重複した送信を避けるため、保存・送信先の状態を確認してください。',
  'SITE-010': '画面に必要な情報を確認できません。入力内容を控えて画面を開き直してください。解決しない場合は運営へこのエラー番号をお知らせください。',
  'SITE-011': '現在、処理を完了できません。入力内容を控え、時間をおいてもう一度お試しください。',
  'SITE-012': '通信できませんでした。インターネット接続を確認して、もう一度お試しください。',
  'SITE-013': 'コピーや共有を完了できませんでした。表示中のリンクを選択してコピーするか、画像を保存してお使いください。',
  'SITE-014': '外部サービスとの接続を確認できません。時間をおいて再度お試しください。解決しない場合は運営へお問い合わせください。',
  'SITE-015': '確認コードを確認できません。最後に届いたメールのコードを入力してください。有効期限が切れた場合は再送してください。',
  'SITE-016': 'メールアドレス・パスワードの入力を確認してください。パスワードを忘れた場合は再設定してください。',
} as const;
export type SiteErrorCode = keyof typeof siteErrors;
// Public, fixed explanations that must retain an operation-specific recovery step.
// Never register input values or upstream exception text here.
export const siteErrorDetails = {
  'cms-generation-field': { code: 'SITE-014', message: '「期」を保存するには、microCMSのPortfolioに generation（数値）フィールドを追加してください。期を変更せずに保存すると、ほかの項目は更新できます。' },
  'account-deletion-unconfirmed': { code: 'SITE-014', message: 'Portfolioの削除を確認できませんでした。アカウントは残しています。microCMSの削除・取得権限とコンテンツの参照関係を確認して再試行してください。' },
  'account-deletion-unknown': { code: 'SITE-009', message: 'Portfolioの削除結果を確認できませんでした。アカウントは残しています。時間をおいて再試行してください。' },
  'review-notification': { code: 'SITE-009', message: '承認は完了しましたが、メールを送信できませんでした。「確定する」で通知を再試行できます。' },
} as const;
export function registeredErrorDetail(code: unknown, message: string) {
  return (Object.keys(siteErrorDetails) as (keyof typeof siteErrorDetails)[]).find(key => siteErrorDetails[key].code === code && siteErrorDetails[key].message === message);
}
export function validErrorDetail(code: unknown, detail: unknown): detail is keyof typeof siteErrorDetails {
  return typeof detail === 'string' && Object.hasOwn(siteErrorDetails, detail) && siteErrorDetails[detail as keyof typeof siteErrorDetails].code === code;
}
export function isSiteErrorCode(value: unknown): value is SiteErrorCode {
  return typeof value === 'string' && Object.hasOwn(siteErrors, value);
}
export function numberedError(message: string) {
  const code = message.match(/^エラー番号：([A-Z]+-\d{3})\n/)?.[1];
  return isSiteErrorCode(code) || isExhibitionErrorCode(code) ? code : undefined;
}
export function siteErrorCode(message: string, status = 400): SiteErrorCode {
  // Transport/authorization outcomes take precedence over incidental words in their instructions.
  if (status === 429) return 'SITE-008';
  if (status === 413 || status === 415) return 'SITE-005';
  if (status === 409) return 'SITE-004';
  if (status === 404 || status === 410) return 'SITE-006';
  if (status === 403) return 'SITE-003';
  if (status === 401) return /パスワード.*(?:間違|違い|違います|一致)|password.*(?:incorrect|invalid)/i.test(message) ? 'SITE-016' : 'SITE-002';
  if (status >= 500) {
    if (/結果.*確認でき|結果.*不明|受理.*確認|送信済み|二重|重複.*送信/.test(message)) return 'SITE-009';
    return /Google|Drive|Lightroom|microCMS|外部|連携|Instagram/i.test(message) ? 'SITE-014' : 'SITE-011';
  }
  if (status === 0 || status === 408) return 'SITE-012';
  if (/確認コード|認証コード|二段階|MFA|verification code/i.test(message)) return 'SITE-015';
  if (/パスワード|password|メールアドレス.*一致/i.test(message)) return 'SITE-016';
  if (/結果.*確認でき|結果.*不明|受理.*確認|送信済み|二重|重複.*送信/.test(message)) return 'SITE-009';
  if (status === 401 || /ログイン|アカウント.*変わ/.test(message)) return 'SITE-002';
  if (status === 429 || /操作が集中|回数.*超え|しばらく待/.test(message)) return 'SITE-008';
  if (status === 403 || /権限|承認.*(?:必要|待ち|お待ち)|このサイトの画面|アクセスでき|CSRF|origin/i.test(message)) return 'SITE-003';
  if (status === 409 || /別の画面|更新されています|revision|競合/i.test(message)) return 'SITE-004';
  if (status === 404 || /見つかりません|見つから|存在しません/.test(message)) return 'SITE-006';
  if (/期間外|受付.*終了|入力期間/.test(message)) return 'SITE-007';
  if (/識別番号|入力形式|識別子|送信形式|送信内容を読み取|圧縮|JSON|Unexpected token|undefined|Cannot read|is not a function|not defined|TypeError|SyntaxError|ReferenceError|ENOENT/i.test(message)) return 'SITE-010';
  if (/コピー|clipboard|共有でき/i.test(message)) return 'SITE-013';
  if (status === 413 || status === 415 || /ファイル|JPEG|PNG|WebP|PDF|MB|容量|添付|アップロード/.test(message)) return 'SITE-005';
  if (status === 408 || status === 0 || /通信|fetch|network|timeout|aborted|接続/i.test(message)) return 'SITE-012';
  if (/Google|Drive|Lightroom|microCMS|API|外部|連携/.test(message)) return 'SITE-014';
  if (status >= 500 || /できませんでした|失敗|完了できません/.test(message)) return 'SITE-011';
  return 'SITE-001';
}
export function siteErrorMessage(code: SiteErrorCode, message = '') {
  if (registeredErrorDetail(code, message)) return message;
  if (code === 'SITE-016' && message === credentialMismatchMessage) return message;
  // These failures use the same public description in the UI, API and incident mail.
  if (['SITE-009', 'SITE-010', 'SITE-011', 'SITE-014'].includes(code)) return siteErrors[code];
  if (!message || !/[ぁ-んァ-ヶ一-龠]/.test(message) || /識別番号|識別子|入力形式|圧縮|JSON|Unexpected token|undefined|Cannot read|TypeError|SyntaxError|ReferenceError|ENOENT|HTTP\s*\d|status\s*[:=]/i.test(message)) return siteErrors[code];
  if (['ログインが必要です。','管理者権限が必要です。','運営以上の権限が必要です。','送信内容が大きすぎます。','送信内容を読み取れません。','送信形式を確認してください。'].includes(message)) return siteErrors[code];
  if (!/ください|ご確認|お試し|お問い合わせ|お待ち|依頼|選択|入力して|再送|再試行|再生成|再読み込み|開き直|確認して|お使い|お知らせ|以内|までです|までに/.test(message)) return `${message} ${siteErrors[code]}`;
  return message;
}
export function describeSiteError(message: string, status = 400, suppliedCode?: unknown) {
  const existing = numberedError(message);
  const plain = existing ? message.slice(message.indexOf('\n') + 1) : message;
  const variant = Object.values(siteErrorDetails).find(detail => detail.message === plain);
  const code = isSiteErrorCode(suppliedCode) || isExhibitionErrorCode(suppliedCode) ? suppliedCode : existing ?? variant?.code ?? siteErrorCode(message, status);
  const detail = registeredErrorDetail(code, plain);
  return { code, message: status >= 500 ? publicErrorDescription(code, detail) : isExhibitionErrorCode(code) ? exhibitionErrorMessage(code, plain) : siteErrorMessage(code, plain) };
}
export function publicErrorDescription(code: SiteErrorCode | keyof typeof exhibitionErrors, detail?: unknown) {
  if (validErrorDetail(code, detail)) return siteErrorDetails[detail].message;
  return isSiteErrorCode(code) ? siteErrors[code] : exhibitionErrors[code];
}
export function formatSiteError(message: string, code?: unknown): string {
  if (!message.trim()) return '';
  const detail = describeSiteError(message, 400, code);
  return `エラー番号：${detail.code}\n${detail.message}`;
}
/** Add metadata without changing successful responses or existing feature error codes. */
export function siteErrorBody(body: unknown, status: number): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    if (status < 400) return body;
    body = { ok: false };
  }
  const raw = body as Record<string, unknown>;
  if (status < 400 && raw.ok !== false) return body;
  const supplied = isSiteErrorCode(raw.errorCode) || isExhibitionErrorCode(raw.errorCode) ? raw.errorCode : raw.code;
  const detail = describeSiteError(typeof raw.message === 'string' ? raw.message : '', status, supplied);
  const errorDetail = registeredErrorDetail(detail.code, detail.message);
  // Older clients only read message. Carry the authoritative number with it so they cannot reclassify it.
  const { errorDetail: _untrustedDetail, ...rest } = raw;
  return { ...rest, ok: false, errorCode: detail.code, ...(errorDetail ? { errorDetail } : {}), ...(raw.code === undefined ? { code: detail.code } : {}), message: formatSiteError(detail.message, detail.code) };
}
