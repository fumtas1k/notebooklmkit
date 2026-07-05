# notebooklmkit — 要件定義書

Google NotebookLM（コンシューマ版）を便利にする Chrome 拡張機能。
複数ソースの一括削除や、開いているタブの一括インポートなどを提供する。

> ステータス: ドラフト v0.1（2026-07-01）

---

## 1. 目的・背景

- NotebookLM の Web UI は、ソースの削除が1件ずつ・複数タブの取り込みが手作業など、
  大量のソースを扱うときの操作コストが高い。
- これらの繰り返し作業を拡張機能で自動化・一括化し、NotebookLM の使い勝手を大きく改善する。

## 2. 対象ユーザー・利用環境

- **対象ユーザー**: NotebookLM をヘビーに使う個人（リサーチ、学習、情報整理など）。
- **対象ブラウザ**: Google Chrome（Manifest V3）。将来的に Chromium 系（Edge / Brave）も視野。
- **対象サービス**: コンシューマ版 NotebookLM（`https://notebooklm.google.com/`）。
  無料 / Plus を想定。**Enterprise 版は対象外**（別 API を持つため）。

## 3. 重要な前提・技術方針

### 3.1 公式 API が存在しない

コンシューマ版 NotebookLM には公開 API がない。操作手段は次の2択：

| 方式 | 仕組み | 評価 |
|---|---|---|
| **A. DOM 自動化** | content script が画面上のボタンを疑似操作 | 規約リスク低め・実装直感的・UI変更に弱い |
| **B. RPC 直接** | 内部 `batchexecute` を直接呼ぶ | 高速・一括に強い / 規約リスク高・非常に壊れやすい |

### 3.2 採用方針: **まず A（DOM 自動化）で構築**

- Web Store 公開を見据え、規約リスクとブラックボックス依存を抑える。
- 高速化・バックグラウンド処理がどうしても必要になった機能だけ、将来 B の部分導入を検討（ハイブリッド）。
- **RPC 直接方式は現時点では非採用**（判断は各フェーズのレビュー時に見直す）。

### 3.3 配布方針: **将来的に Chrome Web Store 公開**

- そのため次を初期段階から守る:
  - **権限最小化**（必要な `host_permissions` / `permissions` のみ）
  - **外部送信ゼロ**（ユーザーデータは端末内で完結。分析トラッカー等を入れない）
  - **プライバシーポリシー**の用意
  - **i18n 対応**（日本語 / 英語）

## 4. 機能要件（フェーズ分け）

### Phase 1 — MVP: ノートブック一覧の複数選択・一括削除 ★最優先

対象は **ノートブック一覧（ダッシュボード）**。NotebookLM は一覧に複数選択機能がなく、
削除は各行の3点メニューから1件ずつしかできない。ここに一括削除を追加する。

- **F1-1** ノートブック一覧の各行に選択用チェックボックス（またはそれに準ずるUI）を付与する。
- **F1-2** 「全選択 / 全解除」を提供する。
- **F1-3** 選択したノートブックをまとめて削除する。削除は NotebookLM 標準の削除フロー
  （行メニュー→「削除」→確認ダイアログ「Delete」）を自動で順次実行する。
- **F1-4** 実行前に「N件を削除します」という確認を出す（誤操作防止。NotebookLM の削除は取り消し不可のため）。
  特に全選択時など件数が多い場合は、より強い確認（件数の明示等）を行う。
- **F1-5** 進捗表示（例: 3 / 10 削除中）と、失敗時のエラー表示・途中中断。

**受け入れ基準（Phase 1）**
- 一覧で任意の複数ノートブックを選択し、一括削除できる。
- 削除中に NotebookLM の DOM 構造が想定外でも、クラッシュせずエラーを通知して停止する。
- 拡張の権限は `host_permissions: notebooklm.google.com` を中心に最小限であること。

### Phase 2 — インポート機能

- **F2-1** 開いているタブの一括インポート: 現ウィンドウの全タブ、または選択したタブの URL をまとめてソース追加。
- **F2-2** 現在ページから新規ノートブック作成: ツールバーアイコンから現在アクティブなタブ（または選択タブ）の URL を **新規ノートブックとして作成**（既存ノートブックへの追記ではない）＋作成後に音声解説の生成を自動押下。
- **F2-3** 複数 URL 貼り付けインポート: URL リストをテキストで貼り付け、一括でソース追加。
- インポートは NotebookLM の「ソースを追加 → ウェブサイト/URL」フローを DOM で自動化する。

### Phase 3 — 高度機能（将来検討・優先度未確定）

- **F3-1** YouTube 動画 / プレイリストの一括インポート。
- **F3-2** RSS フィード取り込み。
- **F3-3** 複数ノートブックの横断管理（一覧・切り替え・一括操作）。
- **F3-4** 音声概要（Audio Overview）のダウンロード。
- **F3-5** 対応サービス最適化（Notion / ChatGPT / Claude / Gemini / X / Medium / Substack 等）。

## 5. 非機能要件

- **堅牢性**: NotebookLM の UI 変更で壊れやすいため、DOM セレクタは一箇所に集約し変更容易にする。
  想定外の DOM でも安全に停止する（ユーザーデータを壊さない）。
- **性能**: 一括削除・一括インポートは UI 操作を挟むため逐次処理。適切な待機（要素出現待ち）で確実性を優先。
- **安全性**: 破壊的操作（削除）は必ず件数確認を挟む。
- **プライバシー**: ネットワーク送信は NotebookLM への操作のみ。第三者への送信なし。
- **保守性**: セレクタ / RPC 等の外部依存部分を分離し、壊れた際に素早く追随できる構成。
- **国際化**: 日本語・英語の UI 文言。

## 6. 制約・リスク

- **R1（最重要）**: 非公式手段のため、NotebookLM の UI 更新でいつでも動かなくなる可能性がある。
- **R2**: Google の利用規約・自動化ポリシーに抵触するリスク（DOM 自動化で低減するが完全にゼロではない）。
- **R3**: Chrome Web Store の審査で権限や自動化の説明を求められる可能性。
- **R4**: 削除は取り消し不可 — 誤削除防止 UX が必須。

## 7. 技術スタック（案 / 未確定）

- Manifest V3、TypeScript。
- ビルド: Vite（+ CRXJS 等の MV3 向けプラグイン）を候補に。
- content script（NotebookLM ページに注入）+ popup / options（設定・操作UI）+ background service worker（タブ取得等）。
- DOM 操作ユーティリティ（要素待機・安全クリック）を共通化。
- テスト: 可能な範囲でユニット + 手動E2Eチェックリスト。

## 8. Chrome Web Store 公開に向けた要件（Phase 1 完了以降）

- ストア掲載情報（説明文・スクリーンショット・アイコン）。
- プライバシーポリシー URL。
- 権限の正当化説明。
- バージョニングと更新フロー。

## 8.5 NotebookLM DOM 調査結果（2026-07-01 実機確認）

Phase 1（一覧の一括削除）に必要な実 DOM を確認済み。UI 更新で変わり得るため、
セレクタは一箇所に集約する前提。

### アプリ全体
- **Angular Material 製**。`mdc-*` / `mat-*` は比較的安定、`ng-tns-*` / `_ngcontent-*` は動的生成のため**依存しない**。
- ノートブックは内部的に「**project**」と呼ばれる。

### ノートブック一覧（`https://notebooklm.google.com/`）
- 一覧はテーブル: `div.all-projects-container > div.my-projects-container > project-table > table.project-table > tbody > tr[mat-row][role=row]`。
- テーブルは2つ存在（`project-table` ×2。最近／その他などのグループ）。
- 各行 `tr` のカラム:
  - `td.title-column`（`span.project-table-emoji` + `span.project-table-title` にタイトル）
  - `td.sources-column` / `td.created-time-column` / `td.share-icon-column` / `td.role-column`
  - `td.actions-column` → `project-action-button > button.project-button-more`（aria-label「プロジェクトの操作メニュー」）
- **一覧に標準の複数選択は無い**（右上の3アイコンは grid / list の表示密度切替であって選択モードではない）。**表示モード切替時のコンテナ置換は §8.8 参照**（掴んだノードを監視する observer が発火しなくなる gotcha）。
- **仮想スクロールなし**: 全ノートブックが DOM 上に描画される（確認時 約497行）。→ 全行の列挙が容易。
- 各行の `tr` に `jslog` 属性があり内部 ID を含む（RPC 方式で必要になるが、機密扱いのため取得時は要注意）。

### ノートブック削除フロー（1件あたり）
1. 行の `button.project-button-more` をクリック → メニューが `.cdk-overlay-container` に描画される。
2. メニュー項目 `button.mat-mdc-menu-item.delete-button`（テキスト「削除」）をクリック。
3. 確認ダイアログ `mat-dialog-container`（タイトル「このノートブックをすべての場所から削除しますか？」）が出る。
   - 確定: `button.primary-button`（「Delete」）
   - 取消: `button.tertiary-button`（「キャンセル」）
4. 削除後は該当行が DOM から消え一覧が再描画される。→ **削除は対象を先に確定し、1件ずつ再検索しながら順次実行**する方式が安全。

### フィルタタブ
- `すべて` / `マイ ノートブック` / `おすすめのノートブック`。一括削除の対象は「自分が Owner のノートブック」に限定するのが安全。

### Phase 1 設計への示唆
- 各 `tr` にチェックボックスを注入 ＋ 選択件数と「選択したN件を削除」ボタンを持つアクションバーを追加。
- 実行時は選択行を（タイトル or ID で）先に確定 → 1件ずつ「メニュー→削除→確認ダイアログのDelete」を自動実行、各ステップは要素出現待ち。
- 大量選択（特に全選択）は取り消し不可のため強い確認を必須化。

## 8.6 NotebookLM ソース追加フロー DOM 調査結果（2026-07-03 実機確認）

Phase 2（URL / タブ一括インポート）で使うソース追加フローの実 DOM を確認済み。
セレクタは `src/content/selectors.ts` に集約し、テキスト / aria-label マッチを主軸に、
候補集合を下記の安定クラス / 属性で絞る方針。

- **ソース追加ボタン**: `button.add-source-button`（`aria-label="ソースを追加"`）。左ソースパネル内。
- **ダイアログ**: `mat-dialog-container`（削除確認と同じコンテナ要素）。
- **ソース種別ボタン群**: 「ファイルをアップロード / ウェブサイト / ドライブ / コピーしたテキスト」の4つ。
  すべて `button.drop-zone-icon-button`。ウェブサイトは `button.drop-zone-icon-button > span「ウェブサイト」`。
  同ダイアログ内にテキスト「ウェブ」を含む種別ドロップダウンボタン（`drop-zone-icon-button` 非該当）が別に存在する
  ため、種別チップ候補（`SELECTORS.sourceChipCandidates`）から汎用 `button` を外し
  `button.drop-zone-icon-button` に絞って誤マッチを避ける（`mat-chip` 等の chip 系候補は
  将来の UI 変化に備えて残す）。
- **URL 入力**: `textarea[formcontrolname="urls"]`（placeholder「リンクを貼り付ける」）。`input` 系は無し。
  ダイアログに「複数の URL はスペース / 改行区切りで1回受付」の記載あり。
  **importer は 2 件以上を改行連結で1回投入し、コミット前失敗のみ1件ずつフォールバックする**
  （2026-07-05 実装。設計は `docs/superpowers/specs/2026-07-05-tab-import-ux-batch-design.md`）。
  なお、バッチ成功＝ダイアログ close であり個別 URL の到達性は保証しない（到達不能な1件を暗黙に取りこぼし得る。詳細は上記 spec のリスク節）。
- **挿入ボタン**: テキスト「挿入」`button[type="button"]`（`mdc-button--unelevated`, `mat-primary`）。
  `type="submit"` ではないため、`button[type="submit"]` フォールバックは使わずテキストマッチに一本化する。

## 8.7 音声解説（Audio Overview）生成タイル DOM 調査結果（2026-07-04 実機確認）

#51 でツールバー作成後に音声解説の生成をトリガーする。実機調査（2026-07-04）で確定:

- **生成タイル**: `div[role="button"].create-artifact-button-container`（`aria-label="音声解説"`）。Studio パネルの
  成果物生成ボタン群（スライド資料 / 動画解説 / マインドマップ / … も同クラスで aria-label は各名称）の一つ。
  **`<button>` 要素ではない**ため `getAudioOverviewButton` は `.create-artifact-button-container` / `[role="button"]`
  も候補に含める。
- **クリックで即生成**: タイルを1回クリックすると既定設定で音声生成が始まる（Studio に「音声解説を生成しています…」表示）。
  カスタマイズダイアログは開かない。
- **取り違え注意**: タイル右上に `button.edit-button`（`aria-label="音声解説をカスタマイズ"`）があり、同じ「音声解説」語を
  含むが、押すとカスタマイズダイアログ（形式 / 言語 / 長さ + 生成ボタン）が開くだけで生成しない。`getAudioOverviewButton` は
  aria-label に「カスタマイズ / customize」を含むものを除外する。
- **無効化の表現**: タイルは `aria-disabled` で無効を表す（native `.disabled` ではない）。`triggerAudioOverview` の
  enabled 判定は native `disabled` と `aria-disabled="true"` の両方を見る（issue #57 の実機確定に対応）。
- **クリック方式（主ワールド必須）**: タイルは `div[role="button"]`（Angular Material）。通常の content script
  （隔離ワールド）が生成した合成イベントはページ側ハンドラに効かない（主ワールドの instanceof 判定等に落ちる）。
  ページ CSP は `script-src` に `chrome-extension:` を許可しないため、主ワールド content script の動的 import も不可。
  よって background から `chrome.scripting.executeScript({ world: 'MAIN' })`（CSP 免除）で主ワールドに注入し、
  実ポインタ列（pointerdown→mousedown→pointerup→mouseup→click、座標つき）を発火する（`clickMarkedTargetInMainWorld`）。
  content script はタイルに一時マーカー属性 `data-nlk-click-target` を付け、`nlk:click-main-world` を background に送る。
  このために `scripting` 権限を使う（対象は host_permissions=notebooklm に限定）。
- **クリックタイミング（再試行必須）**: ソース挿入直後はソース解析が未完了で、タイルは `aria-disabled=null` でも
  クリックが空振りする（生成が始まらない）。そのため `triggerAudioOverview` は「クリック → 生成開始を待つ」を、
  生成開始（Studio に「音声解説を生成しています…」表示）を検知できるまで最大 5 回・各 30s 間隔で再試行する。
  各クリック前に生成中かを確認して二重生成を防ぐ。解析完了後のクリックで生成が始まり、検知して停止する。
- **生成開始検知（テキスト＋要素の OR）**: 二重生成防止・再試行停止に使う「生成が始まったか」の判定は、
  従来の表示テキスト一致（`document.body.innerText` の「音声解説を生成しています…」等）に加え、
  **生成中カード要素の出現**（`getAudioGenerationCard`）を OR で見る（issue #60）。テキスト描画が
  `clickInterval` を超えて遅延しても、要素をより早く検知して再クリック（二重生成）を防ぐ狙い。
  さらに `triggerAudioOverview` はループ先頭のプリチェックに加え、**クリック直前にも生成中を再チェック**して
  プリチェック〜クリック間の窓を塞ぐ。**生成カードの安定セレクタと「要素の出現が表示テキストより早いか」は
  実機確認待ち**（現状は best-effort。空振りしてもテキスト判定にフォールバックし現状と同等）。`clickInterval`（30s）は
  実機で生成開始→表示の遅延を計測してから妥当値を再確認する（未計測）。

## 8.8 一覧の表示モード切替とコンテナ置換 DOM 調査結果（2026-07-05 実機確認）

一覧ページ右上の表示モード切替（カード＝グリッド / 一覧＝リスト）と、切替時の DOM 挙動を
実機（Claude in Chrome）で確認。§8.5（2026-07-01・テーブル前提）を補足・更新する。

### 2つの表示モード
- **一覧（リスト）表示**: §8.5 のテーブル構造 `project-table > table.project-table > tbody > tr[mat-row]`。
  行のタイトルは `span.project-table-title`、3点メニューは `project-action-button > button.project-button-more`。
- **カード（グリッド）表示**: `project-button.project-button > mat-card.project-button-card` 構造。
  タイトルは `span.project-button-title`、3点メニューは同じ `project-action-button > button.project-button-more`
  （aria-label「プロジェクトの操作メニュー」。**テーブルと共通**）。おすすめ/公開カードは publisher 情報を持ち
  moreButton を持たない（= `isDeletableRow` が false）。
- どちらのモードでも `.all-projects-container` は存在する（→ ページ種別検出には使えるが、モード判別には使えない）。
- **カード表示にも対応済み**（issue #66）: `getNotebookRows` はテーブル行 `SELECTORS.row` とカード
  `SELECTORS.cardRow`（`project-button.project-button`）の和集合を返す。カードのチェックボックスは
  `div.project-button-box` 内・`project-action-button`（3点メニュー）の直前に注入する。

### 表示モード切替時のノード置換（重要 gotcha）
- 切替で NotebookLM は一覧コンテナ **`.all-projects-container` を新ノードに丸ごと置換**する
  （`data-probe` 属性で印を付けて往復すると印が消える＝別ノード）。
- 一方、祖先 **`welcome-page` / `.welcome-page-container` / `.app-body` は切替（list→card→list 往復）を
  通して生存・単一インスタンス**（祖先チェーン: `.all-projects-container` < `.welcome-page-container`
  < `welcome-page` < `.app-body` < `labs-tailwind-root`）。
- 拡張のアクションバー（`[data-nlk="action-bar"]`）は `document.body` 直下にマウントされ、切替の影響を受けない。

### 設計への示唆（issue #67 で対応）
- 再描画・再注入用の長寿命 `MutationObserver` は、**置換され得る `.all-projects-container` ではなく、
  生存する安定祖先に張る**（掴んだノードを監視すると置換後に detach され発火せず silent failure）。
  実装は `getListObserveTarget`（`welcome-page` → `.welcome-page-container` → `.app-body` の多段
  フォールバック。単一タグのリネームで即再発しないため）。ページ種別検出（`detectPage`）は
  `.all-projects-container` の有無のままでよい（役割分離）。

### カード表示チェックボックスの E2E 確認（issue #66・2026-07-05 実機）
実カード DOM に拡張と同一の注入＋CSS を適用して確認済み:
- チェックボックス（18×18）が3点メニューの**左**に表示される（box 子順: アイコン → チェックボックス → `project-action-button`）。
- CSS `z-index:2`（`position:relative`）でカード全体オーバーレイ `a.primary-action-button` より**前面**に出る
  （チェックボックス中心の `elementFromPoint` が自要素を返す）。
- チェックボックスのクリックでトグルでき、**カード遷移は起きない**（URL 不変。アンカー外＋label の stopPropagation）。
- **削除フローは表と同一**: カードの3点メニューを開くと deleter が使う削除項目
  `.cdk-overlay-container button.mat-mdc-menu-item.delete-button`（テキスト「削除」）が同じく現れる
  → `deleter` は無改造でカードにも適用できる。

## 9. スコープ外（当面）

- NotebookLM Enterprise 対応。
- モバイル対応。
- NotebookLM 以外のサービスへのエクスポート（Phase 3 で再検討）。

## 10. 未確定事項 / 次のステップ

- [x] NotebookLM の実 DOM 構造の調査（一覧・削除フロー）。→ 「8.5」に記録。
- [ ] Phase 3 の各機能の優先順位づけ。
- [ ] 技術スタックの確定（ビルドツール・TS 構成）。
- [ ] Phase 1 の詳細設計（チェックボックス注入方法、選択状態の持ち方、削除の逐次実行と再描画対応）。
- [x] Phase 2（ソース追加フロー）の DOM 調査。→ 「8.6」に記録（2026-07-03）。実装は
  `selectors.ts` に反映済み。実機確認手順は `docs/e2e-checklist-phase2.md` §0。

**次のアクション**: Phase 1（一覧の一括削除）の詳細設計・実装に進む。技術スタック確定が先。
