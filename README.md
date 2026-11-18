# 家計簿 試用版 v1（同期なし）

「いつ時点で、いくらあったか」を登録して始める家計簿です。ブラウザだけで動き、サーバーは不要です。

## 使い方

- **パソコンで試す**：このフォルダの `index.html` をブラウザ（Chrome / Edge 推奨）で開きます。
- **スマホでも使う**：GitHub Pages などで公開して、そのURLを開きます（下記）。
- データは開いたブラウザの中（IndexedDB）にだけ保存されます。別のブラウザや端末とは共有されません。
  「設定 → バックアップを保存」で定期的にJSONを保存してください。別の端末へは「バックアップから復元」で移せます。

## GitHub Pages で公開する手順（概要）

1. GitHub で新しいリポジトリを作る（例：kakeibo）
2. このフォルダの中身（index.html, css, js, test）をそのままアップロード
3. リポジトリの Settings → Pages で、Branch を `main`、フォルダを `/ (root)` にして保存
4. 数分後に表示される `https://（ユーザー名）.github.io/kakeibo/` を開く

## フォルダ構成

```
index.html          画面の外枠
css/style.css       PC・スマホ両対応のレイアウトと印刷用の設定
js/util.js          日付・金額などの共通処理
js/balance.js       残高計算（チェックポイント・順算・逆算・差額）
js/credit.js        クレジットカードの引き落とし
js/report.js        月次・年次集計
js/ledger.js        出納帳
js/db.js            保存（IndexedDB）
js/io.js            バックアップ・CSV・初期カテゴリ
js/ui.js            画面切替・共通部品
js/views/*.js       各画面と入力ダイアログ
js/app.js           起動
test/test.html      残高計算の自動テスト（ブラウザで開く）
test/run-node.js    同じテストを Node.js で実行（node test/run-node.js）
```

## 補足

- 出納帳は会計・税務の帳簿の様式に合わせていますが、確定申告用の帳簿としての要件を満たすことは保証しません。
- 同期（Googleドライブ）は v1.5 で追加予定です。データには同期用の項目（id・更新日時・削除印）を最初から持たせています。
