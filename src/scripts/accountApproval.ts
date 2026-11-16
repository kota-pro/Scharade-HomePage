import { operationNotice } from './siteNotice';
const dialog = document.querySelector<HTMLDialogElement>('[data-approval-dialog]');
if (dialog) {
  const open = document.querySelector<HTMLButtonElement>('[data-approval-open]')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-approval-confirm]')!;
  const back = dialog.querySelector<HTMLButtonElement>('[data-approval-back]')!;
  const result = dialog.querySelector<HTMLElement>('[data-approval-result]')!;
  const status = document.querySelector<HTMLElement>('[data-approval-status]')!;
  let busy = false;
  open.onclick = () => dialog.showModal();
  back.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  confirm.onclick = async () => {
    if (busy) return;
    busy = true; confirm.disabled = back.disabled = true;
    result.textContent = '承認の結果と初期設定を確認しています…';
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(dialog.dataset.accountId!)}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: dialog.dataset.revision }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || '承認できませんでした。');
      const messages: Record<string, string> = {
        updated: '登録を承認しました。初期設定と開設メールの送信が完了しました。',
        'email-failed': '登録は承認済みです。開設メールを送信できませんでした。再試行できます。',
        'setup-failed': '登録を承認しました。残りの対応は幹部以上のやることリストに表示します。',
        'setup-unlinked': '登録を承認しました。開設メールを送信しました。名簿の対応は幹部以上のやることリストに表示します。',
      };
      status.textContent = messages[data.result] || '承認の結果を確認してください。';
      const label = document.querySelector('[data-account-approval-label]');
      if (label) label.textContent = '承認済み';
      document.querySelector('[data-account-approval-state] small')?.remove();
      const notified = document.querySelector('[data-account-approval-notified]');
      if (notified && data.notifiedAt) notified.textContent = new Date(data.notifiedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      dialog.close();
      open.textContent = '承認後の処理を再確認する';
      if (data.result === 'updated' || data.result !== 'email-failed' && data.recipientsComplete) open.hidden = true;
      operationNotice(status.textContent, false, 'account-approval');
      document.dispatchEvent(new CustomEvent('help:statechange'));
    } catch (error) { result.textContent = error instanceof Error ? error.message : '通信状態を確認して再試行してください。'; }
    finally { busy = false; confirm.disabled = back.disabled = false; }
  };
}
