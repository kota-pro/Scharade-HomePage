/** Shared by the API and browser. Keep these numbers stable; see docs/exhibition-errors.md. */
export const exhibitionErrors = {
  'EXH-001': '提出する写真の枚数分、写真を添付してください。',
  'EXH-002': '添付した写真を確認できません。この作品の写真をもう一度選んで添付してください。',
  'EXH-003': '作品や展示の情報を確認できません。入力内容を控えて画面を開き直してください。解決しない場合は運営へこのエラー番号をお知らせください。',
  'EXH-004': 'タイトルボードに収まらない文字があります。警告のある項目の文字数や改行を減らしてください。',
  'EXH-005': '入力した作品数・写真枚数と、登録した作品・写真の数を合わせてください。',
  'EXH-006': '入力内容を確認してください。必須項目と、各欄に表示された入力方法をご確認ください。',
  'EXH-007': '作品数または作品の大きさが上限を超えています。表示されている上限に合わせて修正してください。下書きは保存できます。',
  'EXH-008': '写真は1枚20MB以下のJPEG・PNGを選んでください。',
  'EXH-009': 'ログインを確認できません。入力に使っていたアカウントで再度ログインしてください。',
  'EXH-010': 'この操作を利用できません。写真展への参加状況とアカウントを確認し、必要に応じて運営へお問い合わせください。',
  'EXH-011': '現在はフォームの入力期間外です。参加投票・入力期間のページをご確認ください。',
  'EXH-012': '別の画面で下書きが変更されています。「この端末の入力を保存」か「サーバーの下書きを使う」を選んでください。',
  'EXH-013': '通信できませんでした。インターネット接続を確認して、もう一度お試しください。',
  'EXH-014': '写真展フォームを読み込めませんでした。時間をおいて画面を開き直してください。',
  'EXH-015': '保存できませんでした。入力内容を控え、時間をおいてもう一度お試しください。',
  'EXH-016': 'タイトルボードのプレビューを表示できませんでした。「プレビューを更新」を押してもう一度お試しください。',
  'EXH-017': 'この端末に入力内容を一時保存できません。保存が完了するまで画面を閉じないでください。',
  'EXH-018': 'サイトから保存・読み込みの結果を確認できませんでした。入力内容を控えて画面を再読み込みしてください。',
  'EXH-019': '写真展または提出内容が見つかりません。運営から案内されたページを開き直してください。',
  'EXH-020': '現在は処理を続けられません。保存状態や参加状況を確認してから、もう一度お試しください。',
  'EXH-021': '送信する内容が多すぎます。長い入力を短くして、もう一度お試しください。写真は1枚20MB以下にしてください。',
  'EXH-022': '印刷用の文字を確認する準備ができませんでした。文字が枠に収まるかは提出時に確認します。',
} as const;
export type ExhibitionErrorCode = keyof typeof exhibitionErrors;
export function isExhibitionErrorCode(value: unknown): value is ExhibitionErrorCode {
  return typeof value === 'string' && Object.hasOwn(exhibitionErrors, value);
}
export function exhibitionErrorCode(message: string, status = 400): ExhibitionErrorCode {
  const numbered = message.match(/^エラー番号：(EXH-\d{3})\n/);
  if (numbered && isExhibitionErrorCode(numbered[1])) return numbered[1];
  if (status === 429) return 'EXH-020';
  if (status === 413) return 'EXH-021';
  if (status === 415) return 'EXH-008';
  if (status === 401) return 'EXH-009';
  if (status === 403) return /期間外|入力期間が終了/.test(message) ? 'EXH-011' : 'EXH-010';
  if (status === 409) return 'EXH-012';
  if (status === 404 || status === 410) return 'EXH-019';
  if (status >= 500) return /プレビュー/.test(message) ? 'EXH-016' : /読み込|フォームを読み込/.test(message) ? 'EXH-014' : 'EXH-015';
  if (status === 0 || status === 408) return 'EXH-013';
  if (/写真の枚数分|各作品のデータを添付/.test(message)) return 'EXH-001';
  if (/写真の添付|他の提出者の写真|写真.*もう一度.*添付/.test(message)) return 'EXH-002';
  if (/識別番号|作品番号|フォーム定義|フォームにない質問|提出先が変更|作品や展示の情報/.test(message)) return 'EXH-003';
  if (/文字量|文字数や改行|タイトルボード.*収まり|合計3行|文字以内|タブ|改行を含めず/.test(message)) return 'EXH-004';
  if (/作品数・組写真|登録した作品・写真の数/.test(message)) return 'EXH-005';
  if (status === 413 || /送信内容が大きすぎ/.test(message)) return 'EXH-021';
  if (/上限|最大.*作品|以内に収まる/.test(message)) return 'EXH-007';
  if (/JPEG|PNG|20MB|写真の送信|添付内容|写真を選んで/.test(message)) return 'EXH-008';
  if (status === 401 || /ログイン|アカウント.*変わ|元のアカウント/.test(message)) return 'EXH-009';
  if (/期間外|入力期間が終了/.test(message)) return 'EXH-011';
  if (status === 409 || /別の画面|競合/.test(message)) return 'EXH-012';
  if (status === 403 || /参加投票|通知対象|閲覧でき|準備中|編集リンク/.test(message)) return 'EXH-010';
  if (status === 404 || /見つかりません/.test(message)) return 'EXH-019';
  if (/一時保存.*できません/.test(message)) return 'EXH-017';
  if (/プレビュー/.test(message)) return 'EXH-016';
  if (/処理結果|保存結果/.test(message)) return 'EXH-018';
  if (/読み込めません|フォームを読み込/.test(message)) return 'EXH-014';
  if (status === 0 || /通信|fetch|network|timeout|aborted/i.test(message)) return 'EXH-013';
  if (status >= 500 || /保存できません/.test(message)) return 'EXH-015';
  if (status === 429 || /未送信の入力|処理を続けられません/.test(message)) return 'EXH-020';
  return 'EXH-006';
}
/** Replace internal terminology; keep actionable field names and limits from validation. */
export function exhibitionErrorMessage(code: ExhibitionErrorCode, message = ''): string {
  if (message.startsWith(`エラー番号：${code}\n`)) return message.slice(message.indexOf('\n') + 1);
  if (!message || !/[ぁ-んァ-ヶ一-龠]/.test(message) || ['EXH-002','EXH-003','EXH-008','EXH-013','EXH-014','EXH-015','EXH-016','EXH-017','EXH-018','EXH-019','EXH-020','EXH-021','EXH-022'].includes(code)) return exhibitionErrors[code];
  if (code === 'EXH-006' && /入力形式|送信内容を読み取れません/.test(message)) return '入力内容を読み取れませんでした。入力内容を控えて画面を開き直し、もう一度お試しください。';
  if (code === 'EXH-009' && message === 'ログインが必要です。') return exhibitionErrors[code];
  if (code === 'EXH-010' && /閲覧できません|権限が必要/.test(message)) return exhibitionErrors[code];
  return message;
}
export function formatExhibitionError(message: string, code = exhibitionErrorCode(message)): string {
  if (/^エラー番号：(?:EXH-\d{3}|SITE-(?:00[1-9]|01[0-6]))\n/.test(message)) return message;
  return `エラー番号：${code}\n${exhibitionErrorMessage(code, message)}`;
}
