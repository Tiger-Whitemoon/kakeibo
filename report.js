/* 月次・年次集計（設計書「5. 月次集計」「7. 年次集計」） */
(function (KB) {
  'use strict';
  const U = KB.util;
  const B = KB.balance;
  const R = (KB.report = {});

  /**
   * 期間 [from, to] の集計
   * 期首残高 = from の朝時点、期末残高 = to の夜時点
   * 恒等式：期首 ＋ 収入 − 支出 ＋ 調整 ＋ 未調整の差額 ＝ 期末
   */
  R.period = function (model, from, to) {
    const k0 = B.queryKey(from, 'start');
    const k1 = B.queryKey(to, 'end');
    const inRange = (k) => k > k0 && k <= k1;
    let income = 0, expense = 0, adjust = 0, unadjusted = 0;
    const expByCat = new Map(), incByCat = new Map();

    model.data.transactions.forEach((t) => {
      if (t.type === 'income' || t.type === 'expense') {
        if (!inRange(B.txKey(t.date))) return;
        const map = t.type === 'income' ? incByCat : expByCat;
        map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
      } else if (t.type === 'adjust') {
        const s = model.snapById.get(t.snapshotId);
        const key = s ? B.snapKey(s) - 1 : B.txKey(t.date);
        if (inRange(key)) adjust += t.amount;
      }
    });
    model.diffs.forEach((d) => {
      if (!d.first && inRange(d.key)) unadjusted += d.diff;
    });

    const accIds = [...model.perAcc.keys()];
    const open = B.totalAt(model, from, 'start', accIds);
    const close = B.totalAt(model, to, 'end', accIds);
    const byAccount = model.data.accounts.map((a) => ({
      account: a,
      open: B.balanceAt(model, a.id, from, 'start'),
      close: B.balanceAt(model, a.id, to, 'end'),
    }));
    return { from, to, income, expense, net: income - expense, adjust, unadjusted, open, close, byAccount, expByCat, incByCat };
  };

  R.month = (model, y, m) => R.period(model, U.monthStart(y, m), U.monthEnd(y, m));

  /** 年次：年間サマリー・月別推移・カテゴリ×月 */
  R.year = function (model, y) {
    const total = R.period(model, `${y}-01-01`, `${y}-12-31`);
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(R.month(model, y, m));
    const catTable = (kind) => {
      const key = kind === 'expense' ? 'expByCat' : 'incByCat';
      const cats = model.data.categories.filter((c) => c.kind === kind);
      const ids = new Set(cats.map((c) => c.id));
      // 削除済みカテゴリ等の取引も落とさない
      months.forEach((mo) => mo[key].forEach((_, id) => ids.add(id)));
      return [...ids]
        .map((id) => {
          const cat = model.catById.get(id);
          const vals = months.map((mo) => mo[key].get(id) || 0);
          return { id, name: cat ? cat.name : '（未分類）', order: cat ? cat.order : 9999, vals, total: U.sum(vals) };
        })
        .filter((r) => r.total !== 0 || (model.catById.get(r.id) && !model.catById.get(r.id).archived))
        .sort((a, b) => a.order - b.order);
    };
    return { year: y, total, months, expenseRows: catTable('expense'), incomeRows: catTable('income') };
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
