/* Pure accounting rules. Also executed in Node tests through vm. No Google services here. */
var Accounting = (function () {
  function integer(value, label, positive) {
    if (!Number.isSafeInteger(value) || (positive && value <= 0)) throw new Error(label + 'は' + (positive ? '1以上の' : '') + '整数で指定してください。');
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('日付を確認してください。');
    return value;
  }
  function add(a,b) { return integer(a+b, '集計額', false); }
  function account(a) { if (a !== 'bank' && a !== 'cash') throw new Error('銀行または現金を選んでください。'); return a; }
  function normalize(s) { return String(s || '').normalize('NFKC').replace(/\s+/g,'').toUpperCase(); }
  function academicKey(p) { return p.university && p.studentId ? normalize(p.university) + ':' + normalize(p.studentId) : ''; }
  function fiscalYear(day) { date(day); return Number(day.slice(0,4)) - (Number(day.slice(5,7)) < 11 ? 1 : 0); }
  function validateSettings(s) {
    if (!s || !s.startDate || s.bankOpening === '' || s.cashOpening === '' || s.bankOpening == null || s.cashOpening == null) throw new Error('開始日と銀行・現金の開始残高を設定してください。');
    date(s.startDate); integer(s.bankOpening,'銀行開始残高',false); integer(s.cashOpening,'現金開始残高',false);
  }
  function build(settings, events, asOf) {
    validateSettings(settings);
    if (asOf) date(asOf);
    var bank = settings.bankOpening, cash = settings.cashOpening;
    var rows = [], advances = {}, ids = {}, income = 0, expense = 0;
    var active = events.filter(function(e) { return !e.canceledAt && (!asOf || e.date <= asOf); }).slice().sort(function(a,b) {
      return a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
    });
    active.forEach(function(e) {
      if (!e.id || ids[e.id]) throw new Error('取引IDが重複しています。');
      ids[e.id] = true;
      date(e.date);
      if (e.date < settings.startDate) throw new Error('開始日より前の取引です。繰越立替として登録してください。');
      var amount = integer(e.amount,'金額',true);
      if (!e.description || !String(e.description).trim()) throw new Error('項目名を入力してください。');
      var b = 0, c = 0, inc = 0, exp = 0;
      if (e.type === 'income' || e.type === 'expense') {
        account(e.account);
        var delta = (e.type === 'income' ? 1 : -1) * amount;
        if (e.account === 'bank') b = delta; else c = delta;
        if (e.type === 'income') inc = amount; else exp = amount;
      } else if (e.type === 'transfer') {
        account(e.from); account(e.to);
        if (e.from === e.to) throw new Error('移動元と移動先が同じです。');
        b = e.from === 'bank' ? -amount : amount; c = -b;
      } else if (e.type === 'advance' || e.type === 'openingAdvance') {
        if (!e.memberId) throw new Error('立替者を選んでください。');
        if (e.type === 'openingAdvance' && e.date !== settings.startDate) throw new Error('繰越立替の日付は会計開始日としてください。');
        advances[e.id] = { id:e.id, memberId:e.memberId, date:e.date, description:e.description, amount:amount, repaid:0, outstanding:amount };
        if (e.type === 'advance') exp = amount;
      } else if (e.type === 'refund') {
        account(e.account);
        var original = advances[e.advanceId];
        if (!original || original.memberId !== e.memberId) throw new Error('返金対象の立替・人物・日付を確認してください。');
        if (amount > original.outstanding) throw new Error('未返金額を超える返金はできません。');
        original.repaid = add(original.repaid, amount);
        original.outstanding = add(original.outstanding, -amount);
        if (e.account === 'bank') b = -amount; else c = -amount;
      } else throw new Error('取引区分を確認してください。');
      bank = add(bank,b); cash = add(cash,c); income = add(income,inc); expense = add(expense,exp);
      rows.push(Object.assign({},e,{ bankDelta:b,cashDelta:c,bankBalance:bank,cashBalance:cash,income:inc,expense:exp }));
    });
    var people = {};
    Object.keys(advances).forEach(function(id) {
      var a=advances[id], p=people[a.memberId] || { memberId:a.memberId,amount:0,repaid:0,outstanding:0 };
      ['amount','repaid','outstanding'].forEach(function(k) { p[k]=add(p[k],a[k]); }); people[a.memberId]=p;
    });
    return { rows:rows, advances:Object.keys(advances).map(function(k){return advances[k];}), people:Object.keys(people).map(function(k){return people[k];}), bank:bank,cash:cash,income:income,expense:expense,
      outstanding:Object.keys(people).reduce(function(sum,k){return add(sum,people[k].outstanding);},0) };
  }
  function months(settings,events,year,today) {
    integer(year,'年度',false);
    var result=[];
    for(var i=0;i<12;i++) {
      var first=new Date(Date.UTC(year,10+i,1)).toISOString().slice(0,10);
      var end=new Date(Date.UTC(year,11+i,0)).toISOString().slice(0,10);
      if(end<settings.startDate || (today && first>today)) { result.push({month:first.slice(0,7),income:null,expense:null,net:null,bank:null,cash:null,outstanding:null}); continue; }
      var b=build(settings,events,end), inc=0,exp=0;
      b.rows.filter(function(r){return r.date>=first;}).forEach(function(r){inc=add(inc,r.income);exp=add(exp,r.expense);});
      result.push({month:first.slice(0,7),income:inc,expense:exp,net:inc-exp,bank:b.bank,cash:b.cash,outstanding:b.outstanding});
    }
    return result;
  }
  function reconcile(settings,events,checks) {
    var latest={};
    checks.forEach(function(c){ date(c.date); account(c.account); integer(c.actual,'実残高',false); if(c.date<settings.startDate) throw new Error('開始日以降の残高を入力してください。'); latest[c.account+':'+c.date]=c; });
    return Object.keys(latest).map(function(k){var c=latest[k],expected=build(settings,events,c.date)[c.account];return Object.assign({},c,{expected:expected,difference:c.actual-expected});});
  }
  function periods(rows) {
    var sorted=rows.slice().sort(function(a,b){return a.start.localeCompare(b.start);});
    sorted.forEach(function(r,i){date(r.start);date(r.end);if(r.start>r.end || (i && sorted[i-1].end>=r.start)) throw new Error('名簿の対象期間が重複、または逆転しています。');if(!r.spreadsheetId || r.sheetId==null) throw new Error('名簿URLとシートIDを指定してください。');});return sorted;
  }
  function activePeriod(rows,today) { var found=periods(rows).find(function(r){return r.start<=today && r.end>=today;});if(!found) throw new Error('現在の期間に対応する名簿が未設定です。');return found; }
  return { integer:integer,date:date,normalize:normalize,academicKey:academicKey,fiscalYear:fiscalYear,validateSettings:validateSettings,build:build,months:months,reconcile:reconcile,periods:periods,activePeriod:activePeriod };
})();
