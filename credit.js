/* クレジットカードの引き落とし（設計書「6. クレジットカードの引き落とし」） */
(function (KB) {
  'use strict';
  const U = KB.util;
  const B = KB.balance;
  const C = (KB.credit = {});

  /** 引き落とし日の初期値：同じカードで最後に入力した引き落とし日が今日以降ならその日、過去なら空 */
  C.defaultWithdrawDate = function (transactions, cardId, today, excludeTxId) {
    let last = null;
    transactions.forEach((t) => {
      if (t.accountId !== cardId || !t.withdrawDate || t.id === excludeTxId) return;
      if (t.type !== 'expense' && t.type !== 'income') return;
      if (!last || (t.createdAt || '') > (last.createdAt || '')) last = t;
    });
    if (last && last.withdrawDate >= today) return last.withdrawDate;
    return '';
  };

  /**
   * カード × 引き落とし日ごとの合計
   * 合計 = 支出の合計 − 収入（返品など）の合計
   */
  C.groups = function (model, cardId) {
    const card = model.accById.get(cardId);
    if (!B.isAutoCard(card, model.accById)) return [];
    const map = new Map();
    model.data.transactions.forEach((t) => {
      if (t.accountId !== cardId || !t.withdrawDate) return;
      if (t.type !== 'expense' && t.type !== 'income') return;
      if (!map.has(t.withdrawDate))
        map.set(t.withdrawDate, { cardId, date: t.withdrawDate, total: 0, count: 0, items: [] });
      const g = map.get(t.withdrawDate);
      g.total += t.type === 'expense' ? t.amount : -t.amount;
      g.count++;
      g.items.push(t);
    });
    const bankId = card.settlementAccountId;
    const groups = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    groups.forEach((g) => {
      g.items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const bal = B.balanceAt(model, bankId, g.date, 'end');
      g.bankBalance = bal;
      g.insufficient = bal.status !== 'unknown' && bal.value < 0;
    });
    return groups;
  };

  /** 今日以降で最も近い引き落とし（ホーム用） */
  C.nextGroup = function (model, cardId, today) {
    return C.groups(model, cardId).find((g) => g.date >= today) || null;
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
