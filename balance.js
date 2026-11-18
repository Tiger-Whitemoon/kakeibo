/* 残高計算（設計書「残高計算ルール」1〜4、6） — 純粋関数のみ */
(function (KB) {
  'use strict';
  const U = KB.util;
  const B = (KB.balance = {});

  /*
   * 時点キー = 通し日数 × 10 + 並び順
   *   0: 朝チェックポイントの調整取引
   *   1: 朝チェックポイント
   *   2: その日の通常取引（収入・支出・振替・カード引き落とし）
   *   3: 夜チェックポイントの調整取引
   *   4: 夜チェックポイント
   */
  B.snapKey = (s) => U.dayNum(s.date) * 10 + (s.timing === 'start' ? 1 : 4);
  B.queryKey = (date, timing) => U.dayNum(date) * 10 + (timing === 'start' ? 1 : 4);
  B.txKey = (date) => U.dayNum(date) * 10 + 2;

  B.isAutoCard = (acc, accById) =>
    !!(acc && acc.kind === 'credit' && acc.settlementAccountId && accById.has(acc.settlementAccountId));

  const byCreated = (a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 :
    (a.createdAt || '') < (b.createdAt || '') ? -1 : (a.createdAt || '') > (b.createdAt || '') ? 1 :
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  /**
   * data = { accounts, categories, transactions, snapshots }（削除済みは含めない）
   * 戻り値の model は残高・差額・出納帳の計算に使う
   */
  B.buildModel = function (data) {
    const accById = new Map(data.accounts.map((a) => [a.id, a]));
    const catById = new Map(data.categories.map((c) => [c.id, c]));
    const snapById = new Map(data.snapshots.map((s) => [s.id, s]));
    const perAcc = new Map();
    data.accounts.forEach((a) => perAcc.set(a.id, { events: [], snaps: [], cum: [] }));
    const push = (accId, ev) => {
      const p = perAcc.get(accId);
      if (p) p.events.push(ev);
    };

    const txs = data.transactions.slice().sort(byCreated);
    const adjBySnap = new Map();
    txs.forEach((t, i) => {
      const amt = t.amount;
      if (t.type === 'income') push(t.accountId, { key: B.txKey(t.date), delta: amt, kind: 'tx', tx: t, seq: i });
      else if (t.type === 'expense') push(t.accountId, { key: B.txKey(t.date), delta: -amt, kind: 'tx', tx: t, seq: i });
      else if (t.type === 'transfer') {
        push(t.accountId, { key: B.txKey(t.date), delta: -amt, kind: 'tx', tx: t, seq: i, dir: 'out' });
        push(t.toAccountId, { key: B.txKey(t.date), delta: amt, kind: 'tx', tx: t, seq: i, dir: 'in' });
      } else if (t.type === 'adjust') {
        const s = snapById.get(t.snapshotId);
        const key = s ? B.snapKey(s) - 1 : B.txKey(t.date);
        push(t.accountId, { key, delta: amt, kind: 'adjust', tx: t, seq: i });
        if (s) {
          if (!adjBySnap.has(s.id)) adjBySnap.set(s.id, []);
          adjBySnap.get(s.id).push(t);
        }
      }
      // クレジットカード：引き落とし日に カード＋ / 引き落とし口座− （設計書 6）
      const acc = accById.get(t.accountId);
      if ((t.type === 'expense' || t.type === 'income') && t.withdrawDate && B.isAutoCard(acc, accById)) {
        const sign = t.type === 'expense' ? amt : -amt;
        const key = B.txKey(t.withdrawDate);
        push(acc.id, { key, delta: sign, kind: 'wd', tx: t, seq: 1e9 + i, card: acc.id });
        push(acc.settlementAccountId, { key, delta: -sign, kind: 'wd', tx: t, seq: 1e9 + i, card: acc.id });
      }
    });

    data.snapshots.forEach((s) => {
      const p = perAcc.get(s.accountId);
      if (p) p.snaps.push({ snap: s, key: B.snapKey(s) });
    });

    perAcc.forEach((p) => {
      p.events.sort((a, b) => a.key - b.key || a.seq - b.seq);
      let c = 0;
      p.cum = p.events.map((e) => (c += e.delta));
      p.snaps.sort((a, b) => a.key - b.key);
    });

    const model = { data, accById, catById, snapById, perAcc, adjBySnap };
    model.diffs = new Map(); // snapId -> 差額情報
    perAcc.forEach((p, accId) => B.snapshotDiffs(model, accId).forEach((d) => model.diffs.set(d.snap.id, d)));
    return model;
  };

  /** key 以下の取引の増減合計（二分探索） */
  function cumTo(p, key) {
    let lo = 0, hi = p.events.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p.events[mid].key <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans < 0 ? 0 : p.cum[ans];
  }
  B._cumTo = cumTo;

  /**
   * 時点キー qkey での残高
   * status: exact（順算） / estimated（逆算・推定） / unknown（チェックポイントなし）
   */
  B.balanceAtKey = function (model, accId, qkey) {
    const p = model.perAcc.get(accId);
    if (!p || p.snaps.length === 0) return { value: null, status: 'unknown' };
    let prev = null, next = null;
    for (const s of p.snaps) {
      if (s.key <= qkey) prev = s;
      else { next = s; break; }
    }
    if (prev) return { value: prev.snap.amount + cumTo(p, qkey) - cumTo(p, prev.key), status: 'exact' };
    return { value: next.snap.amount - (cumTo(p, next.key) - cumTo(p, qkey)), status: 'estimated' };
  };

  B.balanceAt = (model, accId, date, timing) => B.balanceAtKey(model, accId, B.queryKey(date, timing || 'end'));

  /** 全口座の合計（不明の口座は除き、件数を返す） */
  B.totalAt = function (model, date, timing, accIds) {
    let value = 0, unknown = 0, estimated = false;
    const ids = accIds || [...model.perAcc.keys()];
    ids.forEach((id) => {
      const b = B.balanceAt(model, id, date, timing);
      if (b.status === 'unknown') unknown++;
      else {
        value += b.value;
        if (b.status === 'estimated') estimated = true;
      }
    });
    return { value, unknown, estimated };
  };

  /**
   * チェックポイントごとの差額（設計書 4）
   * diff = 登録額 − 直前のチェックポイントからの計算額（調整取引込み）
   * rawDiff = 調整取引を除いた差額（「調整をやり直す」で使う）
   */
  B.snapshotDiffs = function (model, accId) {
    const p = model.perAcc.get(accId);
    if (!p) return [];
    return p.snaps.map((s, i) => {
      const adjs = model.adjBySnap.get(s.snap.id) || [];
      const adjSum = U.sum(adjs, (t) => t.amount);
      if (i === 0) return { snap: s.snap, key: s.key, first: true, expected: null, diff: 0, rawDiff: 0, adjSum, adjs };
      const prev = p.snaps[i - 1];
      const expected = prev.snap.amount + cumTo(p, s.key) - cumTo(p, prev.key);
      const diff = s.snap.amount - expected;
      return { snap: s.snap, key: s.key, first: false, expected, diff, rawDiff: diff + adjSum, adjSum, adjs };
    });
  };

  /**
   * 登録しようとしている残高の「計算残高」（入力中の差額表示用）
   * excludeSnapId を除いた上で、その時点の残高を求める
   */
  B.previewSnapshot = function (data, accId, date, timing, excludeSnapId) {
    const d2 = Object.assign({}, data, {
      snapshots: data.snapshots.filter((s) => s.id !== excludeSnapId),
      transactions: data.transactions.filter((t) => !(t.type === 'adjust' && t.snapshotId === excludeSnapId)),
    });
    const m = B.buildModel(d2);
    const qkey = B.queryKey(date, timing);
    const p = m.perAcc.get(accId);
    // 直前のチェックポイントがある場合のみ「計算残高」を出す（逆算の推定値とは比べない）
    const hasPrev = p && p.snaps.some((s) => s.key < qkey);
    if (!hasPrev) return { expected: null };
    // 自分の調整取引は除外済み。同時点直前の他の調整取引は含める
    return { expected: B.balanceAtKey(m, accId, qkey).value };
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
