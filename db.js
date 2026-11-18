/* 保存（IndexedDB）。使えない環境ではメモリだけで動き、画面に警告を出す */
(function (KB) {
  'use strict';
  const U = KB.util;
  const DB_NAME = 'kakeibo';
  const DB_VERSION = 1;
  const STORES = ['accounts', 'categories', 'transactions', 'snapshots'];
  const D = (KB.db = { persistent: false, error: null });
  let db = null;

  // 全データ（削除印付きも含む）
  KB.state = { accounts: [], categories: [], transactions: [], snapshots: [], settings: {} };

  function req2p(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  D.open = function () {
    return new Promise((resolve) => {
      let r;
      try {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB がありません');
        r = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        D.error = e;
        return resolve(false);
      }
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach((s) => {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = () => {
        db = r.result;
        D.persistent = true;
        resolve(true);
      };
      r.onerror = () => {
        D.error = r.error;
        resolve(false);
      };
      r.onblocked = () => {
        D.error = new Error('他のタブで古い版が開かれています');
        resolve(false);
      };
    });
  };

  D.loadAll = async function () {
    if (!db) return;
    const t = db.transaction(STORES.concat('settings'), 'readonly');
    for (const s of STORES) KB.state[s] = await req2p(t.objectStore(s).getAll());
    const settings = await req2p(t.objectStore('settings').getAll());
    KB.state.settings = {};
    settings.forEach((x) => (KB.state.settings[x.key] = x.value));
  };

  function writeMany(ops) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const names = [...new Set(ops.map((o) => o.store))];
      const t = db.transaction(names, 'readwrite');
      ops.forEach((o) => {
        if (o.clear) t.objectStore(o.store).clear();
        else t.objectStore(o.store).put(o.rec);
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('保存が中断されました'));
    });
  }

  /** 新規・更新（id・作成日時・更新日時を付ける）。recs は [store, rec] の配列 */
  D.saveMany = async function (pairs) {
    const now = U.now();
    const ops = pairs.map(([store, rec]) => {
      if (!rec.id) rec.id = U.uuid();
      if (!rec.createdAt) rec.createdAt = now;
      rec.updatedAt = now;
      return { store, rec };
    });
    await writeMany(ops);
    ops.forEach(({ store, rec }) => {
      const arr = KB.state[store];
      const i = arr.findIndex((x) => x.id === rec.id);
      if (i >= 0) arr[i] = rec;
      else arr.push(rec);
    });
    KB.invalidate();
  };
  D.save = (store, rec) => D.saveMany([[store, rec]]);

  /** 削除（同期に備えて実際には消さず、削除印を付ける） */
  D.removeMany = function (pairs) {
    return D.saveMany(pairs.map(([store, rec]) => [store, Object.assign({}, rec, { deleted: true })]));
  };
  D.remove = (store, rec) => D.removeMany([[store, rec]]);

  D.setSetting = async function (key, value) {
    KB.state.settings[key] = value;
    await writeMany([{ store: 'settings', rec: { key, value } }]);
  };

  /** 全データの置き換え（バックアップからの復元・全削除） */
  D.replaceAll = async function (data) {
    const ops = [];
    STORES.forEach((s) => {
      ops.push({ store: s, clear: true });
      (data[s] || []).forEach((rec) => ops.push({ store: s, rec }));
    });
    await writeMany(ops);
    STORES.forEach((s) => (KB.state[s] = (data[s] || []).slice()));
    KB.invalidate();
  };

  /** 削除印のないデータと計算モデル（変更があるまで使い回す） */
  let cache = null;
  KB.invalidate = () => (cache = null);
  KB.live = function () {
    if (cache) return cache;
    const alive = (r) => !r.deleted;
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
    const data = {
      accounts: KB.state.accounts.filter(alive).sort(byOrder),
      categories: KB.state.categories.filter(alive).sort(byOrder),
      transactions: KB.state.transactions.filter(alive),
      snapshots: KB.state.snapshots.filter(alive),
    };
    cache = { data, model: KB.balance.buildModel(data) };
    return cache;
  };
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
