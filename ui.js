/* 画面切替・共通部品 */
(function (KB) {
  'use strict';
  const U = KB.util;
  const UI = (KB.ui = { views: {} });

  UI.NAV = [
    ['', 'ホーム'], ['list', '取引一覧'], ['balance', '残高'], ['withdraw', '引き落とし'],
    ['report', '月次'], ['annual', '年次'], ['ledger', '出納帳'], ['config', '設定'],
  ];
  UI.KIND = { cash: '現金', bank: '銀行', emoney: '電子マネー', credit: 'クレジットカード', other: 'その他' };

  /* ---------- ルーティング（URL の # で切替） ---------- */
  // 形式：#home / #list / #report-2026-11 / #annual-2026（英数字とハイフンのみ）
  UI.parseHash = function () {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('-');
    const path = parts[0] === 'home' ? '' : parts[0];
    return { path, params: { y: parts[1], m: parts[2] } };
  };
  UI.go = (path) => {
    const h = '#' + (path || 'home');
    if (location.hash === h) UI.render();
    else location.hash = h;
  };

  UI.render = function () {
    const root = document.getElementById('app');
    const { data } = KB.live();
    const nav = document.getElementById('nav');
    const fab = document.getElementById('fab');
    if (data.accounts.length === 0) {
      nav.innerHTML = '';
      fab.hidden = true;
      UI.views.setup(root);
      return;
    }
    fab.hidden = false;
    const { path, params } = UI.parseHash();
    const view = UI.views[path || 'home'] || UI.views.home;
    nav.innerHTML = UI.NAV.map(
      ([p, label]) => `<a href="#${p || 'home'}" class="${p === path || (!UI.views[path] && p === '') ? 'active' : ''}">${label}</a>`
    ).join('');
    const active = nav.querySelector('.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try {
      view(root, params);
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="card error">画面の表示中にエラーが起きました：${U.esc(e.message)}</div>`;
    }
  };

  /* ---------- ダイアログ ---------- */
  function makeDialog(id) {
    let d = document.getElementById(id);
    if (!d) {
      d = document.createElement('dialog');
      d.id = id;
      document.body.appendChild(d);
    }
    return d;
  }

  /** opts: { title, body(html), wide, onMount(el, close) } */
  UI.openDialog = function (opts) {
    const d = makeDialog('dlg');
    d.className = opts.wide ? 'wide' : '';
    d.innerHTML = `<form method="dialog" class="dlg" novalidate>
      <div class="dlg-head"><h2>${U.esc(opts.title)}</h2><button type="button" class="icon-btn" data-close aria-label="閉じる">×</button></div>
      <div class="dlg-body">${opts.body}</div></form>`;
    const close = () => {
      if (d.open) d.close();
    };
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    d.onclick = (e) => {
      if (e.target === d) close();
    };
    if (!d.open) d.showModal();
    if (opts.onMount) opts.onMount(d, close);
    return { el: d, close };
  };

  /** 確認ダイアログ（入力ダイアログの上に重ねられる） → Promise<boolean> */
  UI.confirm = function (message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const d = makeDialog('dlg-confirm');
      d.className = 'confirm';
      d.innerHTML = `<div class="dlg"><div class="dlg-body"><p class="confirm-msg">${U.esc(message).replace(/\n/g, '<br>')}</p>
        <div class="actions"><button type="button" class="btn" data-no>${U.esc(opts.cancelLabel || 'キャンセル')}</button>
        <button type="button" class="btn ${opts.danger ? 'danger' : 'primary'}" data-yes>${U.esc(opts.okLabel || 'OK')}</button></div></div></div>`;
      const done = (v) => {
        d.close();
        resolve(v);
      };
      d.querySelector('[data-yes]').onclick = () => done(true);
      d.querySelector('[data-no]').onclick = () => done(false);
      d.oncancel = (e) => {
        e.preventDefault();
        done(false);
      };
      d.showModal();
      d.querySelector('[data-yes]').focus();
    });
  };

  UI.toast = function (msg, kind) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => (t.className = ''), 2600);
  };

  /** 保存処理を包み、失敗時はメッセージを出す */
  UI.guard = async function (fn) {
    try {
      await fn();
      return true;
    } catch (e) {
      console.error(e);
      UI.toast('保存に失敗しました。バックアップを取ってください（' + (e && e.message ? e.message : e) + '）', 'error');
      return false;
    }
  };

  /* ---------- 表示用の小物 ---------- */
  UI.balanceHTML = function (b, opts) {
    if (!b || b.status === 'unknown') return '<span class="muted">不明</span>';
    const tag = b.status === 'estimated' ? ' <span class="tag est" title="後の残高登録から逆算した推定値">推定</span>' : '';
    return `<span class="amt ${b.value < 0 ? 'neg' : ''}">${U.yen(b.value)}</span>${opts && opts.noTag ? '' : tag}`;
  };
  UI.signed = (v, kind) => {
    if (kind === 'income') return `<span class="amt inc">+${U.num(v)}</span>`;
    if (kind === 'expense') return `<span class="amt exp">−${U.num(v)}</span>`;
    return `<span class="amt">${U.num(v)}</span>`;
  };
  UI.accountOptions = (accounts, selected, opts) =>
    (opts && opts.empty ? `<option value="">${U.esc(opts.empty)}</option>` : '') +
    accounts.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${U.esc(a.name)}${a.archived ? '（非表示）' : ''}</option>`).join('');
  UI.categoryOptions = (cats, selected) =>
    cats.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${U.esc(c.name)}${c.archived ? '（非表示）' : ''}</option>`).join('');

  UI.fieldError = function (root, name, msg) {
    const el = root.querySelector(`[data-err="${name}"]`);
    if (el) {
      el.textContent = msg || '';
      el.hidden = !msg;
    }
  };

  /** 一覧テーブルのCSV/印刷ボタン */
  UI.toolButtons = (id) =>
    `<div class="tools no-print"><button type="button" class="btn small" data-print="${id}" title="${U.inViewer() ? '印刷用のファイルを保存します。開くと印刷画面になります' : '印刷またはPDFに保存'}">${U.inViewer() ? '印刷用に保存' : '印刷・PDF'}</button>
     <button type="button" class="btn small" data-csv="${id}">CSV</button></div>`;

  UI.bindTools = function (root, handlers) {
    root.querySelectorAll('[data-print]').forEach((b) => (b.onclick = () => UI.print(b.dataset.print)));
    root.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => handlers[b.dataset.csv] && handlers[b.dataset.csv]()));
  };

  const PRINT_CSS = `body{font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;color:#000;font-size:10pt;margin:0;font-feature-settings:"tnum" 1}
    table{border-collapse:collapse;width:100%}th,td{padding:3px 5px;border-bottom:.5pt solid #999;text-align:left;vertical-align:top}
    thead th{border-bottom:1pt solid #333;font-size:9pt}.r{text-align:right}.nowrap{white-space:nowrap}
    .card-head,.tools,.no-print,.hint,.icon-btn{display:none!important}.print-only{display:block!important}
    h1{font-size:14pt;margin:0 0 3mm}h3{font-size:11pt;margin:5mm 0 2mm}p{margin:0 0 3mm}
    .tag{font-size:7.5pt;border:.5pt solid #777;border-radius:3px;padding:0 3px;margin-left:3px}.sub{font-size:8pt;color:#555}
    .muted{color:#555}.neg{color:#b42318}.mark{font-size:7.5pt;font-weight:700}.total td,.total th,tr.carry td,tr.subtotal td{font-weight:700}
    tr.cumtotal td{color:#555;font-size:8.5pt}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
    .bar{display:block;height:8px;border-radius:4px}.dot,.bar{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    a{color:inherit;text-decoration:none}thead{display:table-header-group}tr{page-break-inside:avoid}`;

  /** 印刷用の単独HTMLを作って保存する（claude.ai の中では印刷が使えないため） */
  UI.savePrintFile = async function (el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.tools,.no-print').forEach((x) => x.remove());
    const h = clone.querySelector('.print-only h1, h1.print-only');
    const title = (h ? h.textContent : document.title).trim();
    const wide = el.classList.contains('print-wide');
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${U.esc(title)}</title>
      <style>@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:12mm}${PRINT_CSS}</style></head>
      <body>${clone.innerHTML}<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})<\/script></body></html>`;
    const r = await U.download(`${title.replace(/[\\/:*?"<>|]/g, '_')}.html`, html, 'text/html');
    if (r === 'saved') UI.toast('印刷用のファイルを保存しました。開くと印刷画面になります（PDF保存も可）');
  };

  /** 指定した部分だけを印刷する（その他は印刷時に隠す） */
  UI.print = function (sectionId) {
    if (U.inViewer()) {
      const el = document.getElementById(sectionId);
      if (el) UI.savePrintFile(el);
      return;
    }
    document.body.classList.add('printing-section');
    document.querySelectorAll('.print-target').forEach((e) => e.classList.remove('print-target'));
    const el = sectionId ? document.getElementById(sectionId) : null;
    if (el) el.classList.add('print-target');
    else document.body.classList.remove('printing-section');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-section');
        if (el) el.classList.remove('print-target');
      }, 500);
    }, 50);
  };

  UI.monthNav = (y, m) => {
    let py = y, pm = m - 1, ny = y, nm = m + 1;
    if (pm < 1) { pm = 12; py--; }
    if (nm > 12) { nm = 1; ny++; }
    return { prev: [py, pm], next: [ny, nm] };
  };

  UI.thisYM = () => {
    const t = U.todayStr();
    return [+t.slice(0, 4), +t.slice(5, 7)];
  };
})(window.KB = window.KB || {});
