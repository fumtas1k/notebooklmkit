# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Google NotebookLM のコンシューマ版（`https://notebooklm.google.com/`）に機能を追加する Manifest V3 の Chrome 拡張機能。NotebookLM には**公開 API が存在しない**ため、すべて **content script からの DOM 自動化**（NotebookLM 自身の UI フローを疑似クリックで操作）で実現している。RPC / `batchexecute` 直接呼び出しは明確にスコープ外（`docs/requirements.md` §3 参照）。

Phase 1（実装済み）: ノートブック一覧の複数選択＋一括削除。Phase 2（計画中）: タブ / URL の一括インポート。全体のフェーズ計画は `docs/requirements.md` を参照。

ドキュメント・コードは日英バイリンガル。要件 / 設計ドキュメントとコードコメントは日本語。

## コマンド

```bash
npm run build      # vite build → dist/（読み込み可能な拡張機能一式）
npm run dev        # vite dev（HMR）
npm test           # vitest run（全テスト、jsdom）
npm run test:watch # vitest ウォッチ
npm run typecheck  # tsc --noEmit（strict、noUnusedLocals/Parameters）
npx vitest run tests/deleter.test.ts   # 単一テストファイル
npx vitest run -t "aborts"             # 名前指定で単一テスト
```

ビルドした拡張機能の読み込み: `npm run build` 後、`chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択。手動 E2E 手順は `docs/e2e-checklist-phase1.md` にある（削除は取り消し不可のため、破棄してよいノートブックを用意すること）。

## アーキテクチャ

すべて `src/content/` 配下にある（単一の content script。popup / background はまだ無い）。壊れやすい部分とテスト可能なロジックを意図的に分離する設計。

**セレクタは一箇所に集約。** NotebookLM の DOM セレクタはすべて `src/content/selectors.ts`（`SELECTORS` 定数）にある。NotebookLM の UI が変わったら、まずこのファイルを直す。セレクタは `docs/requirements.md` §8.5 に記録された実 DOM 調査に基づく。安定しているのは `mdc-*` / `mat-*`（Angular Material）。`ng-tns-*` / `_ngcontent-*`（動的生成）には**絶対に依存しない**。

**行の識別はタイトルで行う（ID ではない）。** `src/types.ts` の `makeTarget()` が `title:<タイトル>` という選択キーを導出する。NotebookLM の行ごとの `jslog` 属性は全行で同一なので識別子に使えない。既知のエッジケース: 同名タイトル（例: 複数の「無題のノートブック」）は区別できず、片方を削除すると両方に影響し得る。

**削除ロジックは依存性注入で DOM 非依存。** `src/content/deleter.ts`（`deleteNotebooks`）は `DeleterDeps` オブジェクト（findRow, getMoreButton, click, waitFor など）を受け取るため、実ページなしでシーケンス処理を単体テストできる。重要な不変条件:
- 対象を先にすべて確定してから、**1件ずつ削除し、各行は再描画後に再検索する**（NotebookLM は削除のたびに一覧を再描画する）。
- 各削除は NotebookLM 標準フローに従う: 3点メニューボタン →「削除」メニュー項目 → 確認ダイアログの Delete ボタン。各ステップは `waitFor` の要素出現ポーリングで待つ。ダイアログ容器ではなく **Delete ボタン自体**の出現を待つ（ボタンは少し遅れて現れる）。
- 完了判定は、掴んだ行ノードが DOM から外れること（`row.isConnected`）で行う。タイトルで再検索すると同名の別行を拾い続けるため使わない。
- 失敗 / タイムアウト時は**停止**（安全側）し、失敗を記録する。中断はアイテム境界でのみ判定 —— 処理中の1件は必ず完了させる。

**配線は `main.ts`。** `start()` は `.all-projects-container` の出現を待つ（NotebookLM はクライアントレンダリングの Angular SPA で、script 評価時点ではコンテナが無いことが多い）。その後 `init()` が SelectionStore を用意し、行チェックボックスを注入し、アクションバーをマウントし、再描画時にチェックボックスを再注入する `MutationObserver` を設定する。**削除実行中は observer を切断する**（拡張自身が一覧を大量に書き換えるため）。`finally` で再接続する。`main.ts` 末尾では `location.hostname === 'notebooklm.google.com'` のときだけ自動起動するので、テスト（jsdom）でモジュールを import しても副作用は無い。

**その他のモジュール:** `selection.ts`（監視可能な `SelectionStore`。中身は Set）、`dom-utils.ts`（タイムアウト＋中断つきポーリングの `waitFor`、`safeClick`、`TimeoutError` / `AbortError`）、`i18n.ts`（`{placeholder}` テンプレート方式。`navigator.language` で JA / EN）、`confirm-dialog.ts` ＋ `ui/`（チェックボックス注入、アクションバー、大量 / 全選択削除時の件数タイプ確認）。

## 規約

- **DI ＋純粋ロジックでテスト可能に。** 主要なロジックモジュール（deleter, selection, i18n, dom-utils）は `document` を直接触らない —— 協力オブジェクトを受け取るか、`root: ParentNode` 引数（既定は `document`）を取ることで、テストが jsdom フラグメントを渡せるようにしている。新しいロジックもこのパターンに従うこと。`src/content/*.ts` には対応する `tests/*.test.ts` がある。
- **注入する DOM には `data-nlk` 属性を付ける**（例: `data-nlk="action-bar"`）。チェックボックスのホストセルは `CHECKBOX_ATTR` を使う。注入要素の検索 / 二重注入防止や、テストのフックに使う。
- **ストア公開を見据えた制約**（`docs/requirements.md` §3.3）: 権限最小化（`host_permissions: notebooklm.google.com` のみ ——`manifest.config.ts` 参照）、外部ネットワーク送信ゼロ / トラッカー無し、日英 i18n。これらは維持すること。
- Linter / フォーマッタは未設定。静的チェックのゲートは `npm run typecheck`（strict モード。未使用のローカル変数 / 引数はエラー）。

## Issue 作成

- **レビュー指摘のうち当該 PR で対応しないものは issue 化する。** コードレビューで挙がった指摘で、その PR のスコープでは修正しないが対応した方が良いものは、放置せず GitHub issue として起票する。
- **issue には優先度とカテゴリのラベルを付ける。** 優先度（例: `priority: high` / `priority: medium` / `priority: low`）と、カテゴリ（例: `refactor` / `security` / `chore` / `bug` / `enhancement` / `documentation` など）を必ず付与する。該当するラベルがリポジトリに無ければ作成してから付ける。

## 計画ドキュメント

`docs/superpowers/specs/` と `docs/superpowers/plans/` に設計仕様と実装計画がある（本リポジトリは Superpowers のブレスト→仕様→計画のワークフローを使う）。フェーズを実装する前に、意図された設計をここで確認すること。
