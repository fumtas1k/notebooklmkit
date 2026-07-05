# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Google NotebookLM のコンシューマ版（`https://notebooklm.google.com/`）に機能を追加する Manifest V3 の Chrome 拡張機能。NotebookLM には**公開 API が存在しない**ため、すべて **content script からの DOM 自動化**（NotebookLM 自身の UI フローを疑似クリックで操作）で実現している。RPC / `batchexecute` 直接呼び出しは明確にスコープ外（`docs/requirements.md` §3 参照）。

Phase 1（実装済み）: ノートブック一覧の複数選択＋一括削除。Phase 2（実装済み: F2-1 / F2-2 / F2-3）: F2-1/F2-3 はタブ / URL の一括インポート、F2-2 はツールバーアイコンから現在ページ（または選択タブ）を**新規ノートブックとして作成**（既存への追記ではない）＋作成後に音声解説の生成を自動押下。全体のフェーズ計画は `docs/requirements.md` を参照。

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

content script（`src/content/`）と background service worker（`src/background/main.ts`）で構成される（popup はまだ無い）。壊れやすい部分とテスト可能なロジックを意図的に分離する設計。background は当初「タブ列挙のみ」だったが、F2-2 で役割が増えた: (1) 同一ウィンドウのタブ URL 列挙（`nlk:list-tabs`）、(2) ツールバーアイコン `chrome.action.onClicked` を起点に新規作成タブを開き `pendingCreate` を storage 保存、(3) 作成の進捗をタブ別バッジ（`…`/`✓`/`!`）で表示し、`chrome.alarms` で `…` 固着を検知するウォッチドッグ（MV3 SW のアイドル終了に耐える。issue #47）、(4) 音声解説タイルを主ワールドで実クリックする `chrome.scripting.executeScript({ world:'MAIN' })`（隔離ワールドの合成イベントは Angular Material タイルに効かないため。§8.7）。使用権限は `tabs` / `storage` / `alarms` / `scripting`（`manifest.config.ts`。用途は各行コメント参照。`storage` / `alarms` / `scripting` は F2-2、`tabs` は F2-1 用）。

**セレクタは一箇所に集約。** NotebookLM の DOM セレクタはすべて `src/content/selectors.ts`（`SELECTORS` 定数）にある。NotebookLM の UI が変わったら、まずこのファイルを直す。セレクタは `docs/requirements.md` §8.5 に記録された実 DOM 調査に基づく。安定しているのは `mdc-*` / `mat-*`（Angular Material）。`ng-tns-*` / `_ngcontent-*`（動的生成）には**絶対に依存しない**。

**行の識別はタイトルで行う（ID ではない）。** `src/types.ts` の `makeTarget()` が `title:<タイトル>` という選択キーを導出する。NotebookLM の行ごとの `jslog` 属性は全行で同一なので識別子に使えない。既知のエッジケース: 同名タイトル（例: 複数の「無題のノートブック」）は区別できず、片方を削除すると両方に影響し得る。同様に、選択状態も title ベースのキーで保持するため、NotebookLM 側で削除/リネームされて一覧から消えた行の選択キーは `SelectionStore` に残留し得る（フィルタタブ切替で非表示になっただけの選択を保持するため、observer での可視性ベース prune を撤去したことのトレードオフ）。その結果、幽霊件数（選択件数表示はあるがチェック無し）・削除クリックの無言 no-op・後から同名タイトルを作った際の意図しないプリチェックが起こり得るが、`buildTargets` は可視行のみを対象とするため過剰削除は発生しない（「すべて解除」で復旧可能。詳細は issue #32 / #31）。

**削除ロジックは依存性注入で DOM 非依存。** `src/content/deleter.ts`（`deleteNotebooks`）は `DeleterDeps` オブジェクト（findRow, getMoreButton, click, waitFor など）を受け取るため、実ページなしでシーケンス処理を単体テストできる。重要な不変条件:
- 対象を先にすべて確定してから、**1件ずつ削除し、各行は再描画後に再検索する**（NotebookLM は削除のたびに一覧を再描画する）。
- 各削除は NotebookLM 標準フローに従う: 3点メニューボタン →「削除」メニュー項目 → 確認ダイアログの Delete ボタン。各ステップは `waitFor` の要素出現ポーリングで待つ。ダイアログ容器ではなく **Delete ボタン自体**の出現を待つ（ボタンは少し遅れて現れる）。
- 完了判定は、掴んだ行ノードが DOM から外れること（`row.isConnected`）で行う。タイトルで再検索すると同名の別行を拾い続けるため使わない。
- 失敗 / タイムアウト時は**停止**（安全側）し、失敗を記録する。中断はアイテム境界でのみ判定 —— 処理中の1件は必ず完了させる。

**Phase 2（インポート）は Phase 1 と同じ分離を踏襲。** `src/content/importer.ts`（`importUrls`）は `ImporterDeps` を受け取る DI 構成で、1 URL ずつ「ソース追加 → ウェブサイト → URL 入力 → 挿入 → ダイアログ消滅待ち」を逐次実行する。失敗で安全停止という deleter と同じ規約。2 件以上は §8.6 のとおり1ダイアログへ改行連結で**一括投入**し、コミット前失敗のみ1件ずつにフォールバックする（コミット後失敗は重複回避で停止）。**ソース追加フローのセレクタは 2026-07-03 実機調査済み**（`docs/requirements.md` §8.6）。テキスト / aria-label マッチング（`SOURCE_TEXT`）を主軸に、候補集合を安定クラス（`drop-zone-icon-button` 等）で絞る方針。中断は挿入クリック前なら要素待ちレベルで即時に効き、挿入後はその1件の完了を待って URL 境界で停止する。実機確認は `docs/e2e-checklist-phase2.md` §0 に従う。`main.ts` の `start()` は pathname で一覧ページ（Phase 1 UI）とノートブックページ（インポートパネル）を出し分ける常駐ルーター。タブ一括インポート（F2-1）は content → background の `nlk:list-tabs` メッセージで同一ウィンドウのタブ URL を取得する（`tabs` 権限はこのためだけに使用）。

**F2-2（現在ページから新規ノートブック作成）も同じ DI 分離。** `src/content/notebook-creator.ts` は `createNotebookWithUrls`（「新規作成 → ウェブサイト → URL 入力 → 挿入 → ダイアログ消滅待ち」を importer 同様の DI で実行）と `triggerAudioOverview`（作成成功時に音声解説の生成タイルを fire-and-forget で押下。生成開始検知＝再試行停止＆二重生成防止は「表示テキスト一致 OR 生成カード要素の出現」の OR。§8.7 / issue #60）を提供する。ツールバー起点の配線は background（上記）＋ `main.ts` の `handlePendingCreate`（storage の `pendingCreate` を TTL 内なら1度だけ実行し結果を background に返す。実機フローは §8.7 / issue #51）。

**配線は `main.ts`。** `start()` は `.all-projects-container` の出現を待つ（NotebookLM はクライアントレンダリングの Angular SPA で、script 評価時点ではコンテナが無いことが多い）。その後 `init()` が SelectionStore を用意し、行チェックボックスを注入し、アクションバーをマウントし、再描画時にチェックボックスを再注入する `MutationObserver` を設定する。**削除実行中は observer を切断する**（拡張自身が一覧を大量に書き換えるため）。`finally` で再接続する。`main.ts` 末尾では `location.hostname === 'notebooklm.google.com'` のときだけ自動起動するので、テスト（jsdom）でモジュールを import しても副作用は無い。

**その他のモジュール:** `selection.ts`（監視可能な `SelectionStore`。中身は Set）、`dom-utils.ts`（タイムアウト＋中断つきポーリングの `waitFor`、`safeClick`、`setInputValue`、`TimeoutError` / `AbortError`）、`i18n.ts`（`{placeholder}` テンプレート方式。`navigator.language` で JA / EN）、`confirm-dialog.ts` ＋ `ui/`（チェックボックス注入、アクションバー、インポートパネル、大量 / 全選択削除時の件数タイプ確認）、`tabs-bridge.ts`（content → background の `nlk:list-tabs` で同一ウィンドウのタブ URL を取得。F2-1）、`url-list.ts`（貼り付けテキストから URL を抽出・正規化。F2-3）。`notebook-creator.ts` は上記 F2-2 段落を参照。

## 規約

### テスト・実装パターン

- **DI ＋純粋ロジックでテスト可能に。** 主要なロジックモジュール（deleter, selection, i18n, dom-utils, selectors, importer, notebook-creator, tabs-bridge, url-list 等）は `document` を直接触らない —— 協力オブジェクトを受け取るか、`root: ParentNode` 引数（既定は `document`）を取ることで、テストが jsdom フラグメントを渡せるようにしている。新しいロジックもこのパターンに従うこと。`src/content/*.ts` には対応する `tests/*.test.ts` がある。
- **注入する DOM には `data-nlk` 属性を付ける**（例: `data-nlk="action-bar"`）。チェックボックスのホストセルは `CHECKBOX_ATTR` を使う。注入要素の検索 / 二重注入防止や、テストのフックに使う。
- **jsdom（実ブラウザ仕様どおり）の `<input>.value` は代入時に改行を除去する。** 複数行テキスト（改行区切りの複数 URL 等）を扱うテストのフェイク入力欄は `<input>` ではなく `<textarea>` を使う（`<input>` だと `\n` が消えて複数行の投入・分割を再現できず、テストが実挙動と乖離したまま緑になる）。実機のソース追加欄も `textarea[formcontrolname="urls"]`（§8.6）なので `<textarea>` が忠実（importer のバッチ投入テストで顕在化。PR #76）。
- Linter / フォーマッタは未設定。静的チェックのゲートは `npm run typecheck`（strict モード。未使用のローカル変数 / 引数はエラー）。

### DOM 自動化の gotcha（silent failure を疑う）

- **「OR 追加だから悪化しない（strictly better）」は意味論の真部分集合を確認してから主張する。** 既存判定に新判定を OR で足す変更で「最悪でも現状同等」と言えるのは、新判定が true のとき既存判定も（いずれ）true になる＝**新 ⊆ 既存**が成り立つ場合だけ。片方が漏らす false positive 経路があると、抑止ガード等の用途で silent failure を招く。特に**要素テキストの可視性は非対称**: `document.body.innerText` は非表示テキスト（`display:none` 等）を除外するが、要素の `el.textContent` は**非表示も含む**。この非対称を見落とすと「新 ⊄ 既存」になる（issue #60 で音声解説の生成検知が該当。実例は `getAudioGenerationCard` / `docs/requirements.md` §8.7）。
- **要素の可視性判定は jsdom で `offsetParent` / `checkVisibility()` を使わない**（jsdom では `offsetParent` が常に null になりテストで全要素が不可視扱いになる）。祖先を辿って `getComputedStyle` の `display === 'none'` / `visibility === 'hidden'` と `hidden` 属性を見る保守的判定にする（jsdom でもインラインスタイルに対して決定的に動く。実装例は `selectors.ts` の `isRenderedVisible`）。
- **長寿命の `MutationObserver` は、置換され得るノードでなく生存する安定祖先に張る。** NotebookLM は再描画や表示モード切替（カード⇄一覧）で一覧コンテナ `.all-projects-container` を**新ノードに丸ごと置換**する（実 DOM は `docs/requirements.md` §8.8）。掴んだノード自体を `observe` すると、置換後は detached な旧ノードを監視し続けて発火せず、チェックボックス再注入が止まる silent failure になる（#67）。切替を生き延びる祖先（`welcome-page` → `.welcome-page-container` → `.app-body`。実装は `getListObserveTarget`）に多段フォールバックで張り、単一タグのリネームで即再発しないようにする。コンテナが一瞬 detach しても pathname 不変なら teardown しないルーターガード（#38）と合わせて、「掴んだノードの寿命」を常に疑うこと。
- **`host.insertBefore(node, before)` の `before` は host の直接子に限定する。** `before` が host の直接子でないと DOM 仕様上 `NotFoundError` を投げる。参照要素を子孫検索（`host.querySelector(sel)`）で求めると、将来 NotebookLM がその要素をラップしたとき子孫を拾って throw し、注入ループ（`injectRowCheckboxes`）全体が中断して**全行でチェックボックスが消え、observer 再発火で throw を繰り返す** silent failure になる。直接子のみに絞る（`host.querySelector(':scope > ' + sel)`）と、ラップ時は `before=null` → 末尾 append で graceful degradation する（#73 の `getCheckboxHost` カード分岐が該当。カード DOM は §8.8。「掴んだノードの寿命 / silent failure を疑う」方針の具体例）。
- **jsdom で検証できない CSS / 配置 / スタッキング（z-index 等）は、実ページで経験的に検証する。** 単体テストは DOM 構造・イベント・ストア更新は固定できるが、レイアウトや `z-index`・`elementFromPoint` の重なりは jsdom では確認できない。拡張を再ビルド・再読込せずとも、**実 NotebookLM ページ（Claude in Chrome）に拡張と同一の注入ロジック＋CSS を適用**し、`getBoundingClientRect`（配置）・`elementFromPoint`（最前面がその要素か＝オーバーレイより前面か）・クリック後の `location.href` 不変（遷移しないか）を測ると確実かつ高速（#66 の E2E で有効。測定結果は §8.8）。視覚依存の変更は §8.x に測定結果を記録し、実機 E2E チェックリストにも観点を残す。
- **実機調査で DOM 前提が変わったら `docs/requirements.md` §8.x を更新する。** セレクタのコメントや設計判断は調査記録の節を根拠に引用するため、古い節（例: §8.5 は 2026-07-01 のテーブル前提で、カード/テーブルの2表示モードや切替でのコンテナ置換を含まない）を根拠に新コメントを書くと traceability の齟齬が出る（#67 レビューで顕在化）。新事実は該当節に追記するか、無ければ設計ドキュメント（`docs/superpowers/specs/`）を参照先にする。

### 配布制約

- **ストア公開を見据えた制約**（`docs/requirements.md` §3.3）: 権限最小化（`host_permissions: notebooklm.google.com` のみ ——`manifest.config.ts` 参照）、外部ネットワーク送信ゼロ / トラッカー無し、日英 i18n。これらは維持すること。

## Issue 作成

- **レビュー指摘のうち当該 PR で対応しないものは issue 化する。** コードレビューで挙がった指摘で、その PR のスコープでは修正しないが対応した方が良いものは、放置せず GitHub issue として起票する。
- **issue には優先度とカテゴリのラベルを付ける。** 優先度（例: `priority: high` / `priority: medium` / `priority: low`）と、カテゴリ（例: `refactor` / `security` / `chore` / `bug` / `enhancement` / `documentation` など）を必ず付与する。該当するラベルがリポジトリに無ければ作成してから付ける。

## PR / マージ

- **PR は squash マージ**。件名は `<日本語の説明> (#PR番号)`（例: `#36: 現在ページから新規ノートブックを作成 (#46)`）、本文末尾に `Closes #issue番号`。`gh pr merge <n> --squash --delete-branch` を使う。
- **spec / plan ドキュメントも feature ブランチ側でコミットする。** main に直コミットすると squash マージ後にローカル main が origin/main と分岐する（復旧は `git reset --hard origin/main`。squash 済みなら内容は保全される）。
- **機能ステータス / アーキテクチャに影響する実装 PR では CLAUDE.md も同じ PR で更新する。** フェーズ実装状況（概要の「実装済み / 未実装」）、モジュール構成、background の役割、権限の用途などに変化があれば、その PR で CLAUDE.md の該当記述も直す。散文の更新を後回しにすると数スプリントで陳腐化し、古い記述を根拠に新コメントを書いて誤りが伝播する（#69/#70 で監査による一括修正が必要になった）。
- **stacked PR の base を `--delete-branch` で squash マージすると、上段 PR は main に retarget されず自動クローズする**（reopen 不可）。回避策: (1) スタックせず独立ブランチにする、または (2) 上段を先に `gh pr edit <上段> --base main` で main に retarget してから下段を `--delete-branch` でマージする。復旧: 上段の固有コミットを `git rebase --onto origin/main <旧base先端>`（`<旧base先端>` ＝マージ前の下段ブランチ先端）で main に載せ替え → `git push --force-with-lease` → main 向けに**新規 PR** を作成（旧 PR には新 PR への案内コメントを残す）。
- **マージ後は post-merge-retro ルーチンを回す**（振り返り→CLAUDE.md/scripts/skills 改善提案→承認で PR）。セッション内 `gh pr merge` ならフックが自動リマインドする（GitHub UI マージは対象外なので手動実行）。

## 計画ドキュメント

`docs/superpowers/specs/` と `docs/superpowers/plans/` に設計仕様と実装計画がある（本リポジトリは Superpowers のブレスト→仕様→計画のワークフローを使う）。フェーズを実装する前に、意図された設計をここで確認すること。
