import type { AccountingAction, AccountingData, AccountingRequest } from "../lib/accountingTypes";

const root = document.querySelector<HTMLElement>("#accounting");
if (root) setup(root);
function setup(root: HTMLElement) {
  const content = document.querySelector<HTMLElement>("#accounting-content")!, status = document.querySelector<HTMLElement>("#accounting-status")!;
  const dialog = document.querySelector<HTMLDialogElement>("#accounting-confirm")!, sendStatus = document.querySelector<HTMLElement>("#accounting-send-status")!;
  const labels = { summary: "収支・通帳", transaction: "取引記録", requests: "申請の確認", advances: "立替・返金", checks: "残高確認", roster: "名簿", settings: "設定" };
  const kinds: Record<string, string> = { income: "収入", expense: "支出", transfer: "銀行・現金の移動", advance: "立替", openingAdvance: "繰越立替", refund: "返金" };
  const actionNames: Record<string, string> = { transaction: "取引の登録", review: "申請の確認", cancel: "記録の取消", check: "実残高の登録", settings: "会計設定の変更", resolveRoster: "人物対応の確認", refresh: "再集計", recover: "中断した保存の再確認" };
  const fieldNames: Record<string, string> = { type: "区分", date: "日付", amount: "金額（円）", description: "項目名", account: "入出金する場所", from: "移動元", to: "移動先", memberId: "人物", advanceId: "返金対象", notes: "備考", note: "確認メモ", reason: "取消理由", actual: "実際の残高（円）", startDate: "開始日", bankOpening: "銀行開始残高", cashOpening: "現金開始残高", fiscalYear: "表示年度（開始年）", decision: "確認結果" };
  let data: AccountingData | null = null, tab: keyof typeof labels = "summary", busy = false, confirmInput: AccountingAction | null = null, pending: AccountingAction | null = null;
  const storageKey = "scharade-accounting:" + root.dataset.userId;
  try { const value = JSON.parse(sessionStorage.getItem(storageKey) || "null"); if (value?.operationId && value.expectedRevision && actionNames[value.action]) pending = value; } catch { /* A new page can recover a journaled operation from the server. */ }
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const money = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("ja-JP") + "円";
  const name = (id: unknown) => data?.members.find(p => p.id === id)?.name || String(id || "");
  const table = (headers: string[], rows: unknown[][]) => `<div class="accounting-table" tabindex="0" role="region" aria-label="${esc(headers.join('・'))}"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const field = (label: string, key: string, type: string, value: unknown = "", extra = "") => `<label><span>${label}</span><input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const select = (label: string, key: string, options: string) => `<label><span>${label}</span><select name="${key}">${options}</select></label>`;
  const accounts = '<option value="bank">銀行</option><option value="cash">現金</option>';
  const people = (selected = "", unmapped = false, current = false) => '<option value="">人物を選択してください</option>' + (data?.members || []).filter(p => (!unmapped || !p.rosterKey) && (!current || p.active && p.rosterKey)).map(p => `<option value="${esc(p.id)}" ${selected === p.id ? "selected" : ""}>${esc(p.name)}${p.university ? ' / ' + esc(p.university) : ''}${p.active ? '' : '（過去・未対応）'}</option>`).join("");
  function refund(r?: AccountingRequest) {
    if (!r?.refundMethod) return '<p>希望の返金方法：未指定</p>';
    const rows = r.refundMethod === "口座振込" ? [["銀行名", r.bankName], ["口座名義", r.bankAccountName], ["店名", r.bankBranchName], ["店番号", r.bankBranchCode], ["口座番号", r.bankAccountNumber]] : r.refundMethod === "PayPay" ? [["PayPay連絡用LINE名", r.refundLineName]] : [];
    return `<div class="accounting-refund"><p>希望の返金方法：${esc(r.refundMethod)}</p>${rows.map(([label, value]) => `<p>${label}：${esc(value)}</p>`).join("")}</div>`;
  }
  function message(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function remember(value: AccountingAction | null) {
    pending = value;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory retry and the GAS journal remain available. */ }
    document.querySelector<HTMLElement>("#accounting-retry")!.hidden = !value;
  }
  function setBusy(value: boolean) { busy = value; root.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = value); dialog.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = value); content.setAttribute("aria-busy", String(value)); }
  async function load() {
    if (busy) return; setBusy(true); message("会計を読み込んでいます…");
    try {
      const response = await fetch("/api/admin/accounting", { cache: "no-store" }), result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "会計を読み込めませんでした。");
      data = result.data; render(); message("");
    } catch (error) { message(error instanceof Error ? error.message : "会計を読み込めませんでした。", true); }
    finally { setBusy(false); }
  }
  function render() {
    if (!data) return; const d = data;
    document.querySelector("#accounting-nav")!.innerHTML = Object.entries(labels).map(([key, label]) => `<button type="button" data-tab="${key}" aria-current="${key === tab ? 'page' : 'false'}">${label}</button>`).join("");
    document.querySelector("#accounting-issues")!.innerHTML = [d.issue ? `<p class="accounting-notice">${esc(d.issue)}</p>` : "", !d.rosterStatus?.current ? `<p class="accounting-notice">${d.rosterStatus?.configured ? 'Adminの名簿との同期を待っています。同期後に最新の内容を読み込んでください。' : 'Adminの名簿管理で使用する名簿を確認・適用してください。'} <a href="/Admin/grouping-roster">名簿管理へ</a>${d.rosterStatus?.error ? ' 接続を再試行しています。' : ''}</p>` : "", d.pendingOperations.length ? '<div class="accounting-notice"><p>保存途中の操作があります。記録を重複させずに結果を再確認できます。</p><button type="button" data-action="recover">中断した保存を再確認</button></div>' : ""].join("");
    if (tab === "summary") {
      content.innerHTML = `<section><h3>${d.settings.fiscalYear}年11月〜${d.settings.fiscalYear + 1}年10月</h3><div class="accounting-totals">${d.summary ? [["銀行残高", d.summary.bank], ["現金残高", d.summary.cash], ["未返金額", d.summary.outstanding]].map(([label, value]) => `<div>${label}<strong>${money(Number(value))}</strong></div>`).join("") : ''}</div><button type="button" data-action="refresh">再集計する</button></section><section><h3>月ごとの収支</h3>${table(["月", "収入", "支出", "収支差額", "銀行残高", "現金残高", "未返金額"], d.months.map(m => [m.month, money(m.income), money(m.expense), money(m.net), money(m.bank), money(m.cash), money(m.outstanding)]))}<p>立替は支払った月の支出に含めます。返金や資金移動は支出に重ねて計上しません。</p></section><section><h3>通帳</h3>${select('表示する口座', 'ledger-account', accounts)}<div id="accounting-ledger"></div></section>`;
      ledger("bank");
      content.querySelector<HTMLSelectElement>('[name="ledger-account"]')!.onchange = e => ledger((e.target as HTMLSelectElement).value as "bank" | "cash");
    }
    if (tab === "transaction") content.innerHTML = `<section><h3>取引を記録する</h3><form class="accounting-stack" data-form="transaction"><div class="accounting-grid">${select('区分', 'type', Object.entries(kinds).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''))}${field('日付', 'date', 'date', d.today, 'required')}${field('金額（円）', 'amount', 'number', '', 'min="1" step="1" required')}${field('項目名', 'description', 'text', '', 'maxlength="200" required')}</div><div class="accounting-grid"><div data-for="income expense refund">${select('入出金する場所', 'account', accounts)}</div><div data-for="transfer">${select('移動元', 'from', accounts)}${select('移動先', 'to', '<option value="cash">現金</option><option value="bank">銀行</option>')}</div><div data-for="advance openingAdvance refund">${select('立替者', 'memberId', people())}</div><div data-for="refund">${select('返金対象の立替', 'advanceId', '')}</div></div><label><span>備考</span><textarea name="notes" maxlength="3000"></textarea></label><button type="submit">取引内容を確認する</button></form></section><section><h3>記録の訂正</h3><p>理由を残して取消後、正しい内容を登録します。返金済みの立替は、先に返金を取り消してください。</p>${d.events.slice().reverse().map(e => `<article class="accounting-card"><p>${esc(e.date)} / ${esc(kinds[e.type])} / ${esc(e.description)} / ${money(e.amount)}</p>${e.canceledAt ? `<p>取消済み：${esc(e.cancelReason)}</p>` : `<details><summary>この記録を取り消す</summary><form data-form="cancel" class="accounting-stack"><input type="hidden" name="id" value="${esc(e.id)}">${field('取消理由', 'reason', 'text', '', 'required maxlength="1000"')}<button type="submit">取消内容を確認する</button></form></details>`}</article>`).join('')}</section>`;
    if (tab === "requests") content.innerHTML = `<section><h3>未承認の申請</h3>${d.requests.filter(r => r.status === '未承認').map(r => `<article class="accounting-card"><h4>${esc(r.description)} / ${money(r.amount)}</h4><p>${esc(r.date)} / ${esc(r.rosterName)}（サイト登録名：${esc(r.accountName)}）<br>${esc(r.university)} / LINE：${esc(r.lineName)}</p>${refund(r)}<p>${esc(r.notes)}</p>${r.hasReceipt ? `<a href="/api/admin/accounting/receipts/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">領収書を確認する</a>` : '<p>領収書の添付はありません。</p>'}<form data-form="review" class="accounting-stack"><input type="hidden" name="requestId" value="${esc(r.id)}">${select('名簿の人物を確認', 'memberId', people(d.members.find(p => p.siteUserIds.includes(r.websiteUserId))?.id, false, true))}${field('確認メモ・却下理由', 'note', 'text', '', 'maxlength="1000"')}<div class="accounting-actions"><button type="submit" name="decision" value="approve">承認内容を確認する</button><button type="submit" name="decision" value="reject">却下内容を確認する</button></div></form></article>`).join('') || '<p>未承認の申請はありません。</p>'}</section><section><h3>確認済み</h3>${d.requests.filter(r => r.status !== '未承認').map(r => `<details class="accounting-card"><summary>${esc(r.date)} / ${esc(r.rosterName)} / ${esc(r.description)} / ${money(r.amount)} / ${esc(r.status)}</summary>${refund(r)}<p>${esc(r.reviewNote)}</p>${r.hasReceipt ? `<a href="/api/admin/accounting/receipts/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">領収書を確認する</a>` : ''}</details>`).join('') || '<p>確認済みの申請はありません。</p>'}</section>`;
    if (tab === "advances") content.innerHTML = `<section><h3>人物ごとの立替</h3>${table(['氏名', '立替額', '返金済み', '未返金'], (d.summary?.people || []).map(p => [name(p.memberId), money(p.amount), money(p.repaid), money(p.outstanding)]))}</section><section><h3>未返金の明細</h3>${(d.summary?.advances || []).filter(a => a.outstanding > 0).map(a => `<article class="accounting-card"><h4>${esc(name(a.memberId))} / ${esc(a.description)}</h4><p>${esc(a.date)} / 未返金 ${money(a.outstanding)}</p>${refund(d.requests.find(r => r.transactionId === a.id))}<button type="button" data-refund="${esc(a.id)}">返金を記録する</button></article>`).join('') || '<p>未返金の立替はありません。</p>'}</section>`;
    if (tab === "checks") content.innerHTML = `<section><h3>実際の残高を確認する</h3><p>その日の入出金をすべて記録した後の実残高を入力してください。</p><form data-form="check" class="accounting-stack"><div class="accounting-grid">${field('確認日', 'date', 'date', d.today, 'required')}${select('確認する場所', 'account', accounts)}${field('実際の残高（円）', 'actual', 'number', '', 'step="1" required')}</div><button type="submit">残高の入力内容を確認する</button></form></section><section><h3>照合結果</h3>${table(['日付', '場所', '計算残高', '実残高', '差額'], d.checks.map(c => [c.date, c.account === 'bank' ? '銀行' : '現金', money(c.expected), money(c.actual), money(c.difference)]))}</section>`;
    if (tab === "roster") renderRoster(d);
    if (tab === "settings") content.innerHTML = `<section><h3>会計設定</h3><form data-form="settings" class="accounting-stack"><div class="accounting-grid">${field('記録を始める日', 'startDate', 'date', d.settings.startDate, 'required')}${field('開始時の銀行残高', 'bankOpening', 'number', d.settings.bankOpening, 'step="1" required')}${field('開始時の現金残高', 'cashOpening', 'number', d.settings.cashOpening, 'step="1" required')}${field('表示年度（11月が属する年）', 'fiscalYear', 'number', d.settings.fiscalYear, 'min="2000" max="2200" required')}</div><label><span>引き継ぎメモ</span><textarea name="note" maxlength="3000">${esc(d.settings.note)}</textarea></label><button type="submit">設定内容を確認する</button></form><p>開始前の未返金分は「取引記録」の繰越立替として登録します。名簿の参照先はAdminの名簿管理と共通です。</p></section><section><h3>操作履歴（直近100件）</h3>${table(['日時', '操作', '操作した会員', '結果'], d.history.map(o => [new Date(o.at).toLocaleString('ja-JP'), actionNames[o.action] || o.action, o.actor, o.status === 'done' ? '記録済み' : '結果未確認']))}</section>`;
    bind();
  }
  function renderRoster(d: AccountingData) {
    const normalize = (value: string) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    const matches = (person: { name: string; university: string; lineName: string }, query: string) => {
      const fields = [person.name, person.university, person.lineName].map(normalize);
      return query.normalize('NFKC').trim().split(/\s+/).filter(Boolean).every(term => fields.some(value => value.includes(normalize(term))));
    };
    const search = (label: string, id: string, controls: string) => `<label for="${id}"><span>${label}</span><input id="${id}" type="search" placeholder="氏名・大学・LINE名" autocomplete="off" aria-controls="${controls}"></label>`;
    const candidates = d.members.filter(p => !p.rosterKey);
    const candidateOptions = (query: string) => '<option value="">人物を選択してください</option>' + candidates.filter(p => matches(p, query)).map(p => `<option value="${esc(p.id)}">${esc(p.name)} / ${esc(p.university || '大学未登録')} / LINE：${esc(p.lineName || '未登録')}</option>`).join('') + '<option value="new">別の人物として会計に登録する</option>';
    content.innerHTML = `<section><h3>Adminと共通の名簿</h3><p>${esc(d.rosterStatus?.title)}</p><p>会計への最終反映：${esc(d.sharedRoster?.syncedAt ? new Date(d.sharedRoster.syncedAt).toLocaleString('ja-JP') : '未同期')}</p><p>参照先の変更・名簿の更新・アカウントとの連携はAdminの名簿管理で確認・適用します。</p><a href="/Admin/grouping-roster">名簿管理を開く</a></section>
      <section><h3>過去の会計人物との対応</h3><p>対応待ちの人を探し、対応先を検索して選択してください。氏名・大学・LINE名を組み合わせて検索できます。</p>
        ${d.rosterPending.length ? search('対応待ちの名簿を検索', 'accounting-pending-search', 'accounting-pending-list') + '<p id="accounting-pending-count" class="accounting-search-count" role="status"></p>' : ''}
        <div id="accounting-pending-list">${d.rosterPending.map((p, index) => `<article class="accounting-card" data-roster-key="${esc(p.record.key)}"><h4>${esc(p.record.name)} / ${esc(p.record.university)}</h4><p>LINE：${esc(p.record.lineName)}<br>${esc(p.reason)}</p>${p.record.uncertain ? '<a href="/Admin/grouping-roster">Adminで確認する</a>' : `<form data-form="resolveRoster" class="accounting-stack"><input type="hidden" name="key" value="${esc(p.record.key)}">${search('対応先を検索', 'accounting-candidate-search-' + index, 'accounting-candidate-' + index)}<p class="accounting-search-count" data-candidate-count role="status"></p><label for="accounting-candidate-${index}"><span>同じ人物、または新しい人物を選ぶ</span><select id="accounting-candidate-${index}" name="memberId" required>${candidateOptions('')}</select></label><p class="accounting-person-selection" data-candidate-preview hidden></p><button type="submit">人物対応を確認する</button></form>`}</article>`).join('') || '<p>確認が必要な人物対応はありません。</p>'}</div>
        <p id="accounting-pending-empty" hidden>一致する対応待ちの人が見つかりません。検索条件を変えてください。</p>
      </section>
      <section><h3>会計の人物一覧</h3>${search('会計の人物一覧を検索', 'accounting-members-search', 'accounting-members-list')}<p id="accounting-members-count" class="accounting-search-count" role="status"></p><div id="accounting-members-list"></div></section>`;
    function bindSearch(input: HTMLInputElement, update: () => void) {
      input.oninput = update;
      // Enter in a search field must not submit a person correspondence.
      input.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    }
    const pendingSearch = content.querySelector<HTMLInputElement>('#accounting-pending-search');
    if (pendingSearch) {
      const filterPending = () => {
        let count = 0;
        content.querySelectorAll<HTMLElement>('[data-roster-key]').forEach(card => {
          const person = d.rosterPending.find(p => p.record.key === card.dataset.rosterKey)!;
          card.hidden = !matches(person.record, pendingSearch.value); if (!card.hidden) count++;
        });
        content.querySelector('#accounting-pending-count')!.textContent = `${d.rosterPending.length}件中${count}件を表示`;
        content.querySelector<HTMLElement>('#accounting-pending-empty')!.hidden = count > 0;
      };
      bindSearch(pendingSearch, filterPending); filterPending();
    }
    content.querySelectorAll<HTMLFormElement>('[data-form="resolveRoster"]').forEach(form => {
      const input = form.querySelector<HTMLInputElement>('input[type="search"]')!, picker = form.elements.namedItem('memberId') as HTMLSelectElement;
      const selection = form.querySelector<HTMLElement>('[data-candidate-preview]')!, count = form.querySelector('[data-candidate-count]')!;
      const filterCandidates = () => {
        picker.innerHTML = candidateOptions(input.value); // A changed search requires an explicit new selection.
        selection.hidden = true; selection.textContent = '';
        const total = candidates.filter(p => matches(p, input.value)).length;
        count.textContent = total ? `候補：${total}人（未対応の会計人物）` : '一致する会計人物がいません。検索条件を変えるか、別の人物として登録してください。';
      };
      picker.onchange = () => {
        const person = candidates.find(p => p.id === picker.value);
        selection.textContent = person ? `選択中：${person.name}\n大学：${person.university || '未登録'}\nLINE：${person.lineName || '未登録'}` : picker.value === 'new' ? '選択中：別の人物として会計に登録する' : '';
        selection.hidden = !selection.textContent;
      };
      bindSearch(input, filterCandidates); filterCandidates();
    });
    const membersSearch = content.querySelector<HTMLInputElement>('#accounting-members-search')!;
    const filterMembers = () => {
      const members = d.members.filter(p => matches(p, membersSearch.value));
      content.querySelector('#accounting-members-count')!.textContent = `${d.members.length}人中${members.length}人を表示`;
      content.querySelector('#accounting-members-list')!.innerHTML = members.length ? table(['氏名', '大学', 'LINE名', '名簿'], members.map(p => [p.name, p.university, p.lineName, p.active ? '現在' : '過去・未対応'])) : '<p>一致する会計人物が見つかりません。検索条件を変えてください。</p>';
    };
    bindSearch(membersSearch, filterMembers); filterMembers();
  }
  function ledger(account: "bank" | "cash") {
    if (!data) return; const rows = (data.summary?.rows || []).filter(r => r[account + 'Delta' as 'bankDelta' | 'cashDelta']).map(r => { const delta = r[account + 'Delta' as 'bankDelta' | 'cashDelta']!; return { date: r.date, order: r.createdAt, row: [r.date, kinds[r.type], r.description, name(r.memberId), money(Math.max(delta, 0)), money(Math.max(-delta, 0)), money(r[account + 'Balance' as 'bankBalance' | 'cashBalance']), '', '', r.notes || ''] }; });
    data.checks.filter(c => c.account === account).forEach(c => rows.push({ date: c.date, order: '~', row: [c.date, '残高確認', '当日終了時点', '', '', '', money(c.expected), money(c.actual), money(c.difference), ''] }));
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.order === '~' ? 1 : b.order === '~' ? -1 : a.order.localeCompare(b.order)));
    const opening = data.settings[account === 'bank' ? 'bankOpening' : 'cashOpening'];
    document.querySelector('#accounting-ledger')!.innerHTML = table(['日付', '区分', '項目名', '人物', '入金', '出金', '計算残高', '実残高', '差額', '備考'], [[data.settings.startDate, '開始残高', '繰越', '', '', '', opening === '' ? '未設定' : money(opening), '', '', ''], ...rows.map(r => r.row)]);
  }
  function transactionFields() {
    const form = content.querySelector<HTMLFormElement>('[data-form="transaction"]'); if (!form || !data) return;
    const type = (form.elements.namedItem('type') as HTMLSelectElement).value, person = (form.elements.namedItem('memberId') as HTMLSelectElement).value;
    const personField = form.elements.namedItem('memberId') as HTMLSelectElement;
    personField.innerHTML = people(person, false, type === 'advance' || type === 'openingAdvance');
    form.querySelectorAll<HTMLElement>('[data-for]').forEach(el => { el.hidden = !el.dataset.for!.split(' ').includes(type); el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(field => { field.disabled = el.hidden; field.required = !el.hidden; }); });
    (form.elements.namedItem('advanceId') as HTMLSelectElement).innerHTML = '<option value="">返金対象を選択してください</option>' + (data.summary?.advances || []).filter(a => a.memberId === person && a.outstanding > 0).map(a => `<option value="${esc(a.id)}">${esc(a.date + ' ' + a.description)}（${money(a.outstanding)}）</option>`).join('');
    if (type === 'openingAdvance') (form.elements.namedItem('date') as HTMLInputElement).value = data.settings.startDate;
  }
  function bind() {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { if (busy) return; tab = b.dataset.tab as keyof typeof labels; render(); message(''); });
    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => b.onclick = () => prepare({ action: b.dataset.action! }));
    content.querySelectorAll<HTMLFormElement>('[data-form]').forEach(form => form.onsubmit = e => { e.preventDefault(); const value = Object.fromEntries(new FormData(form)) as Record<string, string>; const submitter = e.submitter as HTMLButtonElement | null; if (submitter?.name) value[submitter.name] = submitter.value; prepare({ ...value, action: form.dataset.form! }); });
    const tx = content.querySelector<HTMLFormElement>('[data-form="transaction"]'); if (tx) { tx.querySelector<HTMLSelectElement>('[name="type"]')!.onchange = transactionFields; tx.querySelector<HTMLSelectElement>('[name="memberId"]')!.onchange = transactionFields; transactionFields(); }
    content.querySelectorAll<HTMLButtonElement>('[data-refund]').forEach(b => b.onclick = () => { const advance = data!.summary!.advances.find(a => a.id === b.dataset.refund)!; tab = 'transaction'; render(); const form = content.querySelector<HTMLFormElement>('[data-form="transaction"]')!; (form.elements.namedItem('type') as HTMLSelectElement).value = 'refund'; (form.elements.namedItem('memberId') as HTMLSelectElement).value = advance.memberId; transactionFields(); (form.elements.namedItem('advanceId') as HTMLSelectElement).value = advance.id; (form.elements.namedItem('amount') as HTMLInputElement).value = String(advance.outstanding); (form.elements.namedItem('description') as HTMLInputElement).value = advance.description + 'の返金'; form.querySelector<HTMLElement>('select')!.focus(); });
  }
  function prepare(value: Record<string, string>) {
    if (!data || busy) return;
    if (pending) { message('前回の操作結果を再確認してから、新しい操作を行ってください。', true); return; }
    if (value.action === 'review' && value.decision === 'reject' && !value.note?.trim()) { message('却下理由を入力してください。', true); return; }
    if ((value.action === 'review' && value.decision === 'approve' || value.action === 'resolveRoster') && !value.memberId) { message('人物を選択してください。', true); return; }
    if ((value.action === 'review' && value.decision === 'approve' || value.action === 'resolveRoster' || value.action === 'transaction' && ['advance', 'openingAdvance'].includes(value.type)) && !data.rosterStatus?.current) { message('Adminの名簿との同期完了後に操作してください。', true); return; }
    preview({ ...value, operationId: crypto.randomUUID(), expectedRevision: data.revision } as AccountingAction);
  }
  function preview(input: AccountingAction) {
    confirmInput = input; sendStatus.textContent = '';
    document.querySelector('#accounting-confirm-description')!.textContent = actionNames[input.action] + 'を行います。内容を確認してください。';
    const fields = Object.entries(input).filter(([key, value]) => fieldNames[key] && value !== '').map(([key, value]) => {
      let display = String(value);
      if (key === 'memberId') {
        const member = data?.members.find(p => p.id === value);
        display = value === 'new' ? '別の人物として登録' : input.action === 'resolveRoster' && member ? `${member.name}\n大学：${member.university || '未登録'}\nLINE：${member.lineName || '未登録'}` : name(value);
      }
      if (key === 'type') display = kinds[display] || display;
      if (['account', 'from', 'to'].includes(key)) display = display === 'bank' ? '銀行' : '現金';
      if (key === 'decision') display = display === 'approve' ? '承認' : '却下';
      if (key === 'advanceId') { const a = data?.summary?.advances.find(a => a.id === value); if (a) display = `${name(a.memberId)} / ${a.date} / ${a.description}`; }
      return `<div><dt>${fieldNames[key]}</dt><dd>${esc(display)}</dd></div>`;
    });
    const request = data?.requests.find(r => r.id === input.requestId), event = data?.events.find(e => e.id === input.id), person = data?.rosterPending.find(p => p.record.key === input.key);
    if (request) fields.unshift(`<div><dt>申請</dt><dd>${esc(request.rosterName)} / ${esc(request.description)} / ${money(request.amount)}</dd></div>`);
    if (event) fields.unshift(`<div><dt>対象の記録</dt><dd>${esc(event.date)} / ${esc(event.description)} / ${money(event.amount)}</dd></div>`);
    if (person) fields.unshift(`<div><dt>Adminの名簿</dt><dd>${esc(person.record.name)}<br>大学：${esc(person.record.university || '未登録')}<br>LINE：${esc(person.record.lineName || '未登録')}</dd></div>`);
    document.querySelector('#accounting-confirm-fields')!.innerHTML = fields.join(''); dialog.showModal();
  }
  async function submit() {
    if (!confirmInput || busy) return; const input = confirmInput; remember(input); setBusy(true); sendStatus.textContent = '保存しています…';
    try {
      const response = await fetch('/api/admin/accounting/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) remember(null);
        throw new Error(result.message || '保存結果が未確認です。同じ操作を再確認してください。');
      }
      remember(null); data = result.data; dialog.close(); render(); message(result.warning || '記録しました。'); status.focus();
      document.dispatchEvent(new CustomEvent('help:statechange'));
    } catch (error) { sendStatus.textContent = error instanceof Error ? error.message : '保存結果が未確認です。同じ操作を再確認してください。'; }
    finally { setBusy(false); }
  }
  document.querySelector<HTMLButtonElement>('#accounting-reload')!.onclick = load;
  document.querySelector<HTMLButtonElement>('#accounting-retry-button')!.onclick = () => { if (pending && !busy) preview(pending); };
  document.querySelector<HTMLButtonElement>('#accounting-confirm-send')!.onclick = submit;
  for (const id of ['accounting-confirm-back', 'accounting-confirm-close']) document.getElementById(id)!.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  remember(pending); void load();
}
