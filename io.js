/* バックアップ（JSON）・CSV出力・初期データ */
(function (KB) {
  'use strict';
  const U = KB.util;
  const IO = (KB.io = {});
  const VERSION = 1;

  IO.DEFAULT_CATEGORIES = [
    ['食費', 'expense', '#e5534b'], ['日用品', 'expense', '#d4a72c'], ['交通費', 'expense', '#3e8ed0'],
    ['住居費', 'expense', '#8256d0'], ['光熱費', 'expense', '#e0823d'], ['通信費', 'expense', '#2da44e'],
    ['娯楽', 'expense', '#bf3989'], ['その他', 'expense', '#8c959f'],
    ['給与', 'income', '#1a7f37'], ['その他', 'income', '#6e7781'],
  ];

  IO.defaultCategories = () =>
    IO.DEFAULT_CATEGORIES.map(([name, kind, color], i) => ({ id: U.uuid(), name, kind, color, order: i + 1 }));

  IO.exportJSON = function () {
    const s = KB.state;
    return JSON.stringify(
      {
        app: 'kakeibo', version: VERSION, exportedAt: U.now(),
        accounts: s.accounts, categories: s.categories, transactions: s.transactions, snapshots: s.snapshots,
      },
      null, 1
    );
  };

  /** 復元前の検査。問題があれば error を返す */
  IO.parseBackup = function (text) {
    let d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      return { error: 'JSONファイルとして読めません' };
    }
    if (!d || d.app !== 'kakeibo') return { error: 'この家計簿のバックアップファイルではありません' };
    if (typeof d.version !== 'number' || d.version > VERSION)
      return { error: `対応していない版のファイルです（版 ${d.version}）。アプリを最新にしてください` };
    for (const k of ['accounts', 'categories', 'transactions', 'snapshots'])
      if (!Array.isArray(d[k])) return { error: `ファイルの中身が足りません（${k}）` };
    const bad = [].concat(d.accounts, d.categories, d.transactions, d.snapshots).find((r) => !r || typeof r.id !== 'string');
    if (bad) return { error: 'ファイルの中に壊れたデータがあります' };
    const alive = (a) => a.filter((r) => !r.deleted).length;
    return { data: d, summary: { accounts: alive(d.accounts), transactions: alive(d.transactions), snapshots: alive(d.snapshots), exportedAt: d.exportedAt } };
  };

  const TYPE = { income: '収入', expense: '支出', transfer: '振替', adjust: '調整' };

  /** 全取引のCSV */
  IO.transactionsCSV = function () {
    const { data, model } = KB.live();
    const name = (id, map) => (map.get(id) ? map.get(id).name : '');
    const rows = [['日付', '種類', '金額', '口座', '振替先', 'カテゴリ', '引き落とし日', 'メモ']];
    data.transactions
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1))
      .forEach((t) =>
        rows.push([
          t.date, TYPE[t.type] || t.type, t.amount, name(t.accountId, model.accById), name(t.toAccountId, model.accById),
          name(t.categoryId, model.catById), t.withdrawDate || '', t.memo || '',
        ])
      );
    return U.csv(rows);
  };

  IO.TYPE = TYPE;
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
