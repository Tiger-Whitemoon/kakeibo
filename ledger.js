/* 出納帳（設計書「8. 出納帳」） */
(function (KB) {
  'use strict';
  const U = KB.util;
  const B = KB.balance;
  const L = (KB.ledger = {});

  L.bookName = (kind) =>
    ({ cash: '現金出納帳', bank: '預金出納帳', emoney: '電子マネー出納帳', credit: 'カード利用帳' }[kind] || '出納帳');

  function txDesc(model, ev) {
    const t = ev.tx;
    const memo = t.memo ? '　' + t.memo : '';
    if (ev.kind === 'adjust') return '残高調整（使途不明）' + memo;
    if (t.type === 'transfer') {
      if (ev.dir === 'out') {
        const to = model.accById.get(t.toAccountId);
        return (to ? to.name : '（不明な口座）') + 'へ振替' + memo;
      }
      const from = model.accById.get(t.accountId);
      return (from ? from.name : '（不明な口座）') + 'から振替' + memo;
    }
    const cat = model.catById.get(t.categoryId);
    let s = (cat ? cat.name : '（未分類）') + memo;
    if (t.withdrawDate && B.isAutoCard(model.accById.get(t.accountId), model.accById))
      s += `（引落 ${U.md(t.withdrawDate)}）`;
    return s;
  }

  /**
   * 行の種類
   *   carry      … 繰越（期首・期末）
   *   entry      … 取引（txId があれば編集できる）
   *   start      … 残高登録（ここから開始）
   *   gap        … 残高差額（未調整）
   *   monthTotal … 月計
   *   cumTotal   … 累計
   * mark: 'ok'（照合済） / 'diff'（差額あり）
   */
  L.build = function (model, accId, from, to) {
    const acc = model.accById.get(accId);
    const p = model.perAcc.get(accId);
    const k0 = B.queryKey(from, 'start');
    const k1 = B.queryKey(to, 'end');
    const fullYear = from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4);
    const open = B.balanceAtKey(model, accId, k0);
    const rows = [];
    rows.push({
      type: 'carry', date: from, desc: fullYear ? '前年より繰越' : '前期より繰越',
      balance: open.value, status: open.status,
    });
    let running = open.value;
    let monthIn = 0, monthOut = 0, cumIn = 0, cumOut = 0;
    let curMonth = null;
    let lastEntry = rows[0];

    const closeMonth = () => {
      if (curMonth == null) return;
      rows.push({ type: 'monthTotal', ym: curMonth, in: monthIn, out: monthOut });
      rows.push({ type: 'cumTotal', ym: curMonth, in: cumIn, out: cumOut });
      monthIn = monthOut = 0;
    };
    const addEntry = (row) => {
      const ym = U.ym(row.date);
      if (curMonth !== ym) {
        closeMonth();
        curMonth = ym;
      }
      const delta = (row.in || 0) - (row.out || 0);
      if (running != null) running += delta;
      row.balance = running;
      monthIn += row.in || 0; monthOut += row.out || 0;
      cumIn += row.in || 0; cumOut += row.out || 0;
      rows.push(row);
      lastEntry = row;
    };

    // 期間内の取引とチェックポイントを時点順に並べる
    const evs = p ? p.events.filter((e) => e.key > k0 && e.key <= k1) : [];
    const snaps = p ? p.snaps.filter((s) => s.key > k0 && s.key <= k1) : [];
    let si = 0;
    const flushSnapsUpTo = (key) => {
      while (si < snaps.length && snaps[si].key <= key) {
        const s = snaps[si++];
        const d = model.diffs.get(s.snap.id);
        if (d.first) {
          if (open.status !== 'exact') {
            addEntry({ type: 'start', date: s.snap.date, desc: `残高登録 ${U.yen(s.snap.amount)}（ここから開始）` });
            running = s.snap.amount;
            lastEntry.balance = running;
            lastEntry.mark = 'ok';
          } else lastEntry.mark = 'ok';
        } else if (d.diff !== 0) {
          addEntry({
            type: 'gap', date: s.snap.date, desc: '残高差額（未調整）',
            in: d.diff > 0 ? d.diff : 0, out: d.diff < 0 ? -d.diff : 0, mark: 'diff', diff: d.diff,
          });
          running = s.snap.amount;
          lastEntry.balance = running;
        } else lastEntry.mark = 'ok';
      }
    };

    const used = new Set();
    for (let i = 0; i < evs.length; i++) {
      if (used.has(i)) continue;
      const e = evs[i];
      flushSnapsUpTo(e.key - 1);
      if (e.kind === 'wd') {
        // 同じ日・同じカードの引き落としは1行にまとめる
        let delta = e.delta, n = 1;
        for (let j = i + 1; j < evs.length && evs[j].key === e.key; j++) {
          if (evs[j].kind === 'wd' && evs[j].card === e.card) {
            delta += evs[j].delta;
            n++;
            used.add(j);
          }
        }
        const date = e.tx.withdrawDate;
        let desc;
        if (e.card === accId) {
          const bank = model.accById.get(acc.settlementAccountId);
          desc = `引き落とし（${bank ? bank.name : ''}）`;
        } else {
          const card = model.accById.get(e.card);
          desc = `${card ? card.name : 'カード'} 引き落とし（${n}件）`;
        }
        addEntry({ type: 'entry', date, desc, in: delta > 0 ? delta : 0, out: delta < 0 ? -delta : 0, withdraw: { card: e.card, date } });
      } else {
        addEntry({
          type: 'entry', date: e.kind === 'adjust' ? e.tx.date : e.tx.date, desc: txDesc(model, e),
          in: e.delta > 0 ? e.delta : 0, out: e.delta < 0 ? -e.delta : 0,
          txId: e.kind === 'tx' ? e.tx.id : null, adjust: e.kind === 'adjust',
        });
      }
    }
    flushSnapsUpTo(k1);
    closeMonth();
    rows.push({
      type: 'carry', date: to, desc: fullYear ? '次年へ繰越' : '次期へ繰越', balance: running,
      status: running == null ? 'unknown' : 'exact',
    });
    return { account: acc, name: L.bookName(acc && acc.kind), from, to, open, rows, totalIn: cumIn, totalOut: cumOut };
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
