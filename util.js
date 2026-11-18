/* 共通ユーティリティ（画面にも保存にも依存しない） */
(function (KB) {
  'use strict';
  const U = (KB.util = {});

  U.pad = (n) => String(n).padStart(2, '0');

  U.todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  };

  // 'YYYY-MM-DD' <-> 通し日数（UTC基準なので時差の影響なし）
  U.dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  U.fromDayNum = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  U.addDays = (s, k) => U.fromDayNum(U.dayNum(s) + k);
  U.isValidDate = (s) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && U.fromDayNum(U.dayNum(s)) === s;

  U.monthStart = (y, m) => `${y}-${U.pad(m)}-01`;
  U.monthEnd = (y, m) => U.fromDayNum(Date.UTC(y, m, 0) / 864e5);
  U.ym = (s) => s.slice(0, 7);

  U.uuid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
  U.now = () => new Date().toISOString();

  U.num = (v) => (v == null ? '' : (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ja-JP'));
  U.yen = (v) => (v == null ? '不明' : U.num(v) + '円');

  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  U.weekday = (s) => WD[new Date(U.dayNum(s) * 864e5).getUTCDay()];
  U.md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
  U.ymd = (s) => `${s.slice(0, 4)}/${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
  U.mdw = (s) => `${U.md(s)}（${U.weekday(s)}）`;

  U.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  U.MAX_AMOUNT = 999999999; // 9億9,999万9,999円

  /** 金額入力を整数に直す。全角数字・カンマ・「円」・各種マイナス記号を受け付ける */
  U.parseAmount = (str, opts) => {
    const allowNegative = !!(opts && opts.allowNegative);
    let s = String(str == null ? '' : str)
      .trim()
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[,，、\s円]/g, '')
      .replace(/^[−－ー‐―-]/, '-')
      .replace(/^[＋+]/, '');
    if (s === '') return { error: '金額を入力してください' };
    if (!/^-?\d+$/.test(s)) return { error: '数字で入力してください' };
    const v = parseInt(s, 10);
    if (Math.abs(v) > U.MAX_AMOUNT) return { error: '金額が大きすぎます（上限 9億9,999万9,999円）' };
    if (!allowNegative && v < 1) return { error: '1円以上で入力してください' };
    return { value: v };
  };

  /** CSV（Excelで文字化けしないよう BOM付きUTF-8） */
  U.csv = (rows) => {
    const cell = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  };

  /**
   * ファイルを保存する。claude.ai の中で動いているときは、その保存機能（downloads）を使う。
   * 戻り値：'saved' / 'declined' / 'error'
   */
  U.inViewer = () => typeof window !== 'undefined' && !!(window.claude && typeof window.claude.use === 'function');
  U.download = async (filename, text, mime) => {
    try {
      if (U.inViewer()) {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try {
            await dl.save({ filename, data: text });
            return 'saved';
          } catch (e) {
            if (e && e.code === 'declined') return 'declined';
            throw e;
          }
        }
      }
      U._anchorDownload(filename, text, mime);
      return 'saved';
    } catch (e) {
      console.error(e);
      if (KB.ui) KB.ui.toast('ファイルを保存できませんでした（' + ((e && (e.message || e.code)) || e) + '）', 'error');
      return 'error';
    }
  };
  U._anchorDownload = (filename, text, mime) => {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  U.sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
})(typeof window !== 'undefined' ? (window.KB = window.KB || {}) : (globalThis.KB = globalThis.KB || {}));
