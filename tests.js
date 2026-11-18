/* 残高計算の自動テスト（設計書「テスト観点」） — test.html と Node の両方で動く */
(function (KB) {
  'use strict';
  const U = KB.util, B = KB.balance, C = KB.credit, R = KB.report, L = KB.ledger;

  let seq = 0;
  const ts = () => '2026-11-17T00:00:' + String(seq++).padStart(2, '0') + '.000Z';
  const acc = (id, kind, extra) => Object.assign({ id, name: id, kind, order: 0, createdAt: ts() }, extra || {});
  const cat = (id, kind) => ({ id, name: id, kind, order: 0 });
  const tx = (o) => Object.assign({ id: 't' + seq, createdAt: ts() }, o);
  const snap = (id, accountId, date, timing, amount) => ({ id, accountId, date, timing, amount, createdAt: ts() });

  function base() {
    return {
      accounts: [acc('財布', 'cash')],
      categories: [cat('食費', 'expense'), cat('日用品', 'expense'), cat('給与', 'income'), cat('その他収入', 'income')],
      snapshots: [snap('s1', '財布', '2026-11-17', 'end', 30000), snap('s2', '財布', '2026-11-25', 'end', 27500)],
      transactions: [
        tx({ id: 'a', type: 'expense', date: '2026-11-18', amount: 800, accountId: '財布', categoryId: '食費' }),
        tx({ id: 'b', type: 'expense', date: '2026-11-20', amount: 1200, accountId: '財布', categoryId: '日用品' }),
        tx({ id: 'c', type: 'expense', date: '2026-11-10', amount: 2000, accountId: '財布', categoryId: '食費' }),
      ],
    };
  }
  const withTx = (d, ...t) => Object.assign({}, d, { transactions: d.transactions.concat(t) });
  const adjust = tx({ id: 'adj', type: 'adjust', date: '2026-11-25', amount: -500, accountId: '財布', snapshotId: 's2' });

  KB.runTests = function () {
    const results = [];
    const eq = (name, actual, expected) =>
      results.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });

    let m = B.buildModel(base());
    eq('11/18 夜の残高（順算）', B.balanceAt(m, '財布', '2026-11-18', 'end'), { value: 29200, status: 'exact' });
    eq('11/25 の差額（調整前）', m.diffs.get('s2').diff, -500);
    eq('11/1 朝の残高（逆算・推定）', B.balanceAt(m, '財布', '2026-11-01', 'start'), { value: 32000, status: 'estimated' });
    eq('11/17 朝の残高', B.balanceAt(m, '財布', '2026-11-17', 'start').value, 30000);

    m = B.buildModel(withTx(base(), tx({ type: 'expense', date: '2026-11-17', amount: 1000, accountId: '財布', categoryId: '食費' })));
    eq('11/17 に支出1,000円を追加したときの 11/17 朝', B.balanceAt(m, '財布', '2026-11-17', 'start').value, 31000);

    m = B.buildModel(withTx(base(), adjust));
    eq('調整を記録した後の 11/25 の差額', m.diffs.get('s2').diff, 0);
    eq('調整後も「やり直し」用の元の差額は −500', m.diffs.get('s2').rawDiff, -500);

    const nov = R.month(m, 2026, 11);
    eq('11月の月次集計（月初・収入・支出・調整・月末）',
      [nov.open.value, nov.income, nov.expense, nov.adjust, nov.unadjusted, nov.close.value],
      [32000, 0, 4000, -500, 0, 27500]);
    const novNoAdj = R.month(B.buildModel(base()), 2026, 11);
    eq('調整なしなら −500 は「未調整の差額」に出る', [novNoAdj.adjust, novNoAdj.unadjusted, novNoAdj.close.value], [0, -500, 27500]);
    eq('恒等式：月初＋収入−支出＋調整＋未調整＝月末',
      novNoAdj.open.value + novNoAdj.income - novNoAdj.expense + novNoAdj.adjust + novNoAdj.unadjusted, novNoAdj.close.value);

    // 振替
    const dT = base();
    dT.accounts.push(acc('銀行', 'bank'));
    dT.snapshots.push(snap('sb', '銀行', '2026-11-01', 'start', 100000));
    dT.transactions.push(tx({ type: 'transfer', date: '2026-11-21', amount: 10000, accountId: '銀行', toAccountId: '財布' }));
    m = B.buildModel(dT);
    const before = B.totalAt(m, '2026-11-20', 'end').value, after = B.totalAt(m, '2026-11-21', 'end').value;
    const r = R.month(m, 2026, 11);
    eq('振替1万円（銀行→財布）：合計残高は変わらない', after, before);
    eq('振替は月の収支に入らない', [r.income, r.expense], [0, 4000]);
    eq('振替で財布は＋1万円', B.balanceAt(m, '財布', '2026-11-21', 'end').value, 29200 - 1200 + 10000);

    // チェックポイントなし
    const dU = base();
    dU.accounts.push(acc('へそくり', 'cash'));
    m = B.buildModel(dU);
    eq('チェックポイントなしの口座', B.balanceAt(m, 'へそくり', '2026-11-20', 'end').status, 'unknown');

    // クレジットカード
    const dC = base();
    dC.accounts.push(acc('銀行', 'bank'), acc('カード', 'credit', { settlementAccountId: '銀行' }));
    dC.snapshots.push(snap('sb', '銀行', '2026-11-01', 'start', 100000), snap('sc', 'カード', '2026-11-01', 'start', 0));
    dC.transactions.push(
      tx({ type: 'expense', date: '2026-11-14', amount: 3000, accountId: 'カード', categoryId: '食費', withdrawDate: '2026-12-10' }),
      tx({ type: 'expense', date: '2026-11-15', amount: 2000, accountId: 'カード', categoryId: '日用品', withdrawDate: '2026-12-10' })
    );
    m = B.buildModel(dC);
    const g = C.groups(m, 'カード');
    eq('12/10 引き落とし合計', [g.length, g[0].date, g[0].total, g[0].count], [1, '2026-12-10', 5000, 2]);
    eq('銀行残高：12/9夜は変化なし、12/10夜に5,000円減る',
      [B.balanceAt(m, '銀行', '2026-12-09', 'end').value, B.balanceAt(m, '銀行', '2026-12-10', 'end').value], [100000, 95000]);
    eq('カード残高：利用で −5,000円、引き落としで 0 に戻る',
      [B.balanceAt(m, 'カード', '2026-11-30', 'end').value, B.balanceAt(m, 'カード', '2026-12-10', 'end').value], [-5000, 0]);
    eq('カード利用は11月の支出、12月の支出には入らない', [R.month(m, 2026, 11).expense, R.month(m, 2026, 12).expense], [9000, 0]);
    eq('引き落とし日の残高が足りる', g[0].insufficient, false);
    const dC2 = JSON.parse(JSON.stringify(dC));
    dC2.snapshots.find((s) => s.id === 'sb').amount = 3000;
    eq('引き落とし日の銀行残高が合計未満なら「残高不足」', C.groups(B.buildModel(dC2), 'カード')[0].insufficient, true);
    eq('引き落とし日の初期値：直前の引き落とし日が今日以降ならその日',
      C.defaultWithdrawDate(dC.transactions, 'カード', '2026-11-17'), '2026-12-10');
    eq('引き落とし日の初期値：直前の引き落とし日が過去なら空欄',
      C.defaultWithdrawDate(dC.transactions, 'カード', '2026-12-11'), '');

    // 年次
    m = B.buildModel(withTx(dC, adjust));
    const y = R.year(m, 2026);
    eq('年次の収入・支出・調整は12か月の合計と一致',
      [y.total.income, y.total.expense, y.total.adjust],
      [U.sum(y.months, (x) => x.income), U.sum(y.months, (x) => x.expense), U.sum(y.months, (x) => x.adjust)]);
    eq('年初＋収入−支出＋調整＋未調整＝年末',
      y.total.open.value + y.total.income - y.total.expense + y.total.adjust + y.total.unadjusted, y.total.close.value);
    eq('カテゴリ別年間表の年計の合計＝年間支出', U.sum(y.expenseRows, (x) => x.total), y.total.expense);

    // 出納帳
    const led = L.build(m, '財布', '2026-01-01', '2026-12-31');
    const rows = led.rows;
    eq('2026年の現金出納帳の繰越は推定', [rows[0].desc, rows[0].status, rows[0].balance], ['前年より繰越', 'estimated', 34000 - 2000]);
    const r1118 = rows.find((x) => x.type === 'entry' && x.date === '2026-11-18');
    eq('現金出納帳 11/18 の差引残高', r1118.balance, 29200);
    const rAdj = rows.find((x) => x.adjust);
    eq('11/25 の行：残高調整 出金500円、差引残高27,500円、照合済',
      [rAdj.desc, rAdj.out, rAdj.balance, rAdj.mark], ['残高調整（使途不明）', 500, 27500, 'ok']);
    const mt = rows.find((x) => x.type === 'monthTotal' && x.ym === '2026-11');
    eq('11月の月計', [mt.in, mt.out], [0, 4500]);
    eq('次年へ繰越＝12/31夜の残高', rows[rows.length - 1].balance, B.balanceAt(m, '財布', '2026-12-31', 'end').value);
    const bankLed = L.build(m, '銀行', '2026-01-01', '2026-12-31');
    const wdRows = bankLed.rows.filter((x) => x.withdraw);
    eq('預金出納帳 12/10 は引き落とし1行', wdRows.map((x) => [x.date, x.desc, x.out]), [['2026-12-10', 'カード 引き落とし（2件）', 5000]]);
    const ledNoAdj = L.build(B.buildModel(base()), '財布', '2026-11-01', '2026-11-30');
    const gap = ledNoAdj.rows.find((x) => x.type === 'gap');
    eq('未調整の差額は「残高差額（未調整）」行になり、帳簿の残高は登録額に合う',
      [gap.out, gap.mark, gap.balance, ledNoAdj.rows[ledNoAdj.rows.length - 1].balance], [500, 'diff', 27500, 27500]);
    const startRow = ledNoAdj.rows.find((x) => x.type === 'start');
    eq('最初の残高登録の行', [startRow.date, startRow.balance], ['2026-11-17', 30000]);

    // 朝・夜
    const dS = base();
    dS.snapshots = [snap('m1', '財布', '2026-11-17', 'start', 30000)];
    dS.transactions = [tx({ type: 'expense', date: '2026-11-17', amount: 1000, accountId: '財布', categoryId: '食費' })];
    m = B.buildModel(dS);
    eq('朝時点の登録はその日の支出を含まない', [B.balanceAt(m, '財布', '2026-11-17', 'start').value, B.balanceAt(m, '財布', '2026-11-17', 'end').value], [30000, 29000]);

    // 金額入力
    eq('金額：全角・カンマ・円', U.parseAmount('１，２００円').value, 1200);
    eq('金額：マイナス（残高）', U.parseAmount('−500', { allowNegative: true }).value, -500);
    eq('金額：0円はエラー', !!U.parseAmount('0').error, true);
    eq('金額：文字はエラー', !!U.parseAmount('abc').error, true);
    eq('金額：上限超えはエラー', !!U.parseAmount('1000000000').error, true);
    eq('月末日', [U.monthEnd(2026, 2), U.monthEnd(2028, 2), U.monthEnd(2026, 12)], ['2026-02-28', '2028-02-29', '2026-12-31']);

    return results;
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
