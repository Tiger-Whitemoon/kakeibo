/* 起動 */
(function (KB) {
  'use strict';
  const UI = KB.ui;

  async function start() {
    const ok = await KB.db.open();
    if (ok) {
      try {
        await KB.db.loadAll();
      } catch (e) {
        console.error(e);
        KB.db.persistent = false;
        KB.db.error = e;
      }
    }
    if (!KB.db.persistent) {
      const b = document.getElementById('banner');
      b.hidden = false;
      b.textContent = 'このブラウザではデータを保存できません（プライベートブラウズ等）。閉じると入力内容は消えます。';
    }
    KB.invalidate();
    document.getElementById('fab').addEventListener('click', () => KB.actions.openTx());
    window.addEventListener('hashchange', UI.render);
    // 日付が変わったら「今日」を更新
    let day = KB.util.todayStr();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && KB.util.todayStr() !== day) {
        day = KB.util.todayStr();
        UI.render();
      }
    });
    UI.render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.KB = window.KB || {});
