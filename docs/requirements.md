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
- **対象サービス**: コンシューマ版 NotebookLM / Gemini Notebook（`https://notebook.google.com/`。
  旧 `https://notebooklm.google.com/` は 301 リダイレクト。§8.9）。
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
- 拡張の権限は `host_permissions: notebook.google.com`（+ 旧 `notebooklm.google.com`）を中心に最小限であること。

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

### ノートブック一覧（`https://notebook.google.com/`。調査当時は `notebooklm.google.com`。§8.9）
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
   - **注: 3. のボタンクラスは 2026-08-08 の UI 刷新で `yes-button` / `no-button` に変わった。§8.10 を参照。**
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

- **注: 2026-10-04 の刷新で `add-source-button` / `drop-zone-icon-button` は消滅した。現行のクラスは §8.13 を参照。**
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
  - **注: この挙動は 2026-08-08 の刷新で逆転し、タイルクリックはカスタマイズダイアログを開くようになった。§8.12 を参照。**
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

**注: 2026-10-04 の刷新で、タイトル要素・3点メニューの DOM と「おすすめ行は moreButton を持たない」前提が変わった。現行は §8.14 を参照。**

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

## 8.9 ドメイン移行: notebooklm.google.com → notebook.google.com（2026-08-08 実機確認）

NotebookLM が **`notebook.google.com`** へ移行し、ブランド表示も「**Gemini Notebook**」に変わった
（`<title>` / ダイアログ文言 / フッターとも "Gemini Notebook"）。

### 事実
- `https://notebooklm.google.com/` → **301 恒久リダイレクト** → `https://notebook.google.com/`。
  パスは保持される（`/notebook/<ID>` → `https://notebook.google.com/notebook/<ID>`）。
  `curl -o /dev/null -w '%{http_code} -> %{redirect_url}'` で確認。
- **DOM は無変更**。§8.5 / §8.6 / §8.7 / §8.8 のセレクタはすべて新ドメインでそのまま通る。
  実機測定（カード表示・356 行）:
  - `project-button.project-button` 356 / `span.project-button-title` 356
  - `project-action-button button.project-button-more` 327（残り 29 はおすすめ = Reader 行。§8.5 と同じ内訳）
  - チェックボックス注入先（`div.project-button-box` と直接子 `project-action-button`）327 / 327
  - observer 対象 `welcome-page` あり、`.all-projects-container` あり、`button.create-new-button` あり
  - ノートブックページ: パスは `/notebook/<ID>` のまま、`button.add-source-button`（aria-label「ソースを追加」）あり、
    ソース追加ダイアログの「ウェブサイト」チップ → `textarea[formcontrolname="urls"]` → 「挿入」ボタン、
    Studio の `.create-artifact-button-container`（音声解説）もすべて健在。

### 影響（この移行だけで全機能が停止した）
リダイレクトは**サーバー側 301** なので、旧ドメインではページが描画される前に転送される
＝ `matches: ['https://notebooklm.google.com/*']` の content script は**一度も注入されない**。
その結果、削除チェックボックス / アクションバー / インポートパネルが一切出ず、F2-2 も
background が旧ドメインでタブを開くだけで content 側の作成処理が走らない（1分後に badge `!`）。

### 設計への示唆
- 対象ホストは `src/types.ts` の **`SUPPORTED_HOSTS` を単一の真実**にし、`manifest.config.ts` の
  `host_permissions` / `content_scripts[].matches` と content の起動ガード（`isSupportedHost`）を
  そこから導出する。従来はこの3箇所に文字列がハードコードされていて、ズレが silent failure になった。
- 新旧**両ドメインを保持**する（旧は 301 で実質死んでいるが、段階ロールアウト / ロールバックに耐えるため）。
- ホスト判定は完全一致で行う（`notebook.google.com.evil.test` / `evil-notebook.google.com` を弾く）。
- **「UI が壊れた」ときはまず DOM を疑う前に URL を疑う。** セレクタが1つ残らず外れているように
  見えるときは、そもそも content script が動いていない可能性が高い。

## 8.10 削除確認ダイアログの刷新（2026-08-08 実機確認）

§8.9 のドメイン移行と同時期に、削除確認ダイアログのボタンが差し替わっていた。
**ドメイン移行とは独立した UI 変更**で、content script が動くようになって初めて顕在化した（#81）。

### 変更点

| | 旧（§8.5・2026-07-01） | 新（2026-08-08） |
|---|---|---|
| 確定 | `button.primary-button`（「Delete」）| **`button.yes-button`**（「削除」）|
| 取消 | `button.tertiary-button`（「キャンセル」）| **`button.no-button`**（「キャンセル」）|
| 文言 | 「このノートブックをすべての場所から削除しますか？」| 「このノートブックを削除しますか？」|

実機での実測クラス（ダイアログ内の全 `button`）:
- `mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-unthemed`（× 閉じる）
- `mdc-button mat-mdc-button-base no-button mdc-button--outlined mat-mdc-outlined-button mat-primary`（キャンセル）
- `mdc-button mat-mdc-button-base yes-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary`（削除）

旧 `button.primary-button` / `button.tertiary-button` のヒット数は **0**。
3点メニュー側（`button.mat-mdc-menu-item.delete-button`）は無変更で、メニュー項目は
「タイトルを編集 / コレクションに追加 / 上部に固定 / 削除」の4つ。

### 症状と機序
`getConfirmDeleteButton` が常に `null` を返し、`deleteOne` の④で `waitFor` が timeout（既定5秒）
→ `deleteNotebooks` が失敗を記録して**安全側に停止**。NotebookLM 側の確認ダイアログは
拡張が閉じないため、**モーダルが開いたまま止まって見える**。

### 設計への示唆
- 確定ボタンの取得は **安定クラス（`yes-button`）→ テキスト完全一致（`/^(削除|delete)$/i`）** の二段構え。
- **「キャンセル系テキストは何があっても返さない」を最上位の不変条件**にする（実装では候補集合から
  先に除外）。取り違えの事故の質が非対称なため:
  - 掴み損ねる → タイムアウトで停止。安全でユーザーも気付ける。
  - キャンセルを掴む → 削除が**無言で no-op** になり、行が消えないまま deleter が待ち続ける。
- テキストは**完全一致**にする（前方一致だと「削除しない」「Delete all」等を拾い得る）。
- 該当なしは `null` を返して停止させる（推測でクリックしない）。

## 8.11 確認ダイアログの「出現 ≠ 操作可能」（2026-08-08 実機確認）

§8.10 でボタンを正しく掴めるようにした後も、一括削除が1件目で止まった。切り分けの結果、
**確認ダイアログ出現直後のクリックは、ダイアログを閉じるだけで削除を実行しない**ことが判明した（#82）。

### 切り分け（実機 3 通り）

| 実験 | クリック方式 | 結果 |
|---|---|---|
| 拡張の実走 | 隔離ワールド・出現即クリック | モーダルは閉じる、**削除されず**（`成功 0件 / 失敗 1件`）|
| 実験1 | 主ワールド・**2000ms 待って**クリック | **削除成功**（`row.isConnected: false`、件数 −1）|
| 実験2 | 主ワールド・**出現即**（1ms）クリック | モーダルは閉じる、**削除されず**（症状を再現）|

→ **隔離ワールドは無関係**（§8.7 の音声解説タイルとは別の機序）。差は**クリックのタイミングだけ**。
リロードしても対象が残ったため「一覧が古いだけ（楽観的 UI 未更新）」でもない。

### 待つべき DOM シグナルが存在しない

ダイアログ出現後 0 / 50 / 100 / 150 / 200 / 300 / 450 / 700 / 1000ms を計測したが、**何も変化しない**:

- `mat-dialog-container` は 0ms 時点で既に存在し、`button.yes-button` も同時に存在
- `getComputedStyle` の `opacity` はダイアログ・ボタンとも最初から `1`
- インラインスタイルは `--mat-dialog-transition-duration: 150ms` のみで 1000ms まで不変
- `.cdk-overlay-pane` は `position: static;` のまま

見た目は出現時点で完成しており、未完了なのは Angular 側のハンドラ初期化。**DOM からは観測できない**ため、
状態シグナル待ちにはできず固定待機で凌ぐしかない。

### 対策（`deleter.ts`）

1. **settle 待機**: 確認ボタンを見つけてから押すまでに待つ（既定 400ms、`settleMs` で注入可能）。
   実機では 400ms で初回成功（`attempts: 1`）を 3 件連続で確認。
2. **未削除を確認したうえでの再試行**: settle だけでは環境差（マシン速度・一覧の重さ）で
   取りこぼし得るため、消滅待ちがタイムアウトしたら `row.isConnected` を見て
   **掴んだ行ノードが残っている**ときに限りフローごとやり直す（既定 3 回、`maxAttempts`）。

再試行が二重削除にならない根拠: 再試行するのは「掴んだ行ノードがまだ DOM に接続されている」場合だけで、
現行 DOM では削除で行ノードが外れる（実機確認済み）ため、これは削除が起きていないことを意味する。
ただしノードが別ノートブックに再利用される DOM ではこの同値は崩れるので、ID キーのときは再試行の
入口で同一性も確認する（§8.14「再試行時の同一性確認」/ #87）。逆に行が消えているのに消滅待ちが
失敗した場合は、削除が遅れて成立したものとして完了扱いにし、押し直さない（成功済みかもしれないものを
押し直すと同名の別行を巻き込むため。#82 codex P1）。
対象をまたいで再試行することはないので、「失敗したら停止」という Phase 1 の安全方針は維持される。

### 設計への示唆
- **要素が「出現した」ことと「操作を受け付ける」ことは別**。`waitFor` で掴んだ直後に押す実装は、
  アニメーションや遅延初期化を持つ UI に対して silent failure を生む。
- **クリックが効かないときは「イベントが届いていない」と決めつけない。** ここでは実際に届いており
  （ダイアログは閉じた）、届いた先の状態が未完成だった。§8.7 の「合成イベントが効かない」と症状が
  似ているため、主ワールド化のような重い対策に飛びつく前に**待機時間だけを変えた対照実験**を行う。

## 8.12 音声解説タイルの刷新: 即生成 → カスタマイズダイアログ（2026-08-08 実機確認）

§8.7（2026-07-04）は「タイルを1回クリックすると既定設定で音声生成が始まる。カスタマイズ
ダイアログは開かない」と記録していたが、2026-08 の刷新で**この前提が逆転した**（#84）。

### 変更点

| | 旧（§8.7・2026-07-04）| 新（2026-08-08）|
|---|---|---|
| タイルをクリック | **即・生成開始** | **「音声解説をカスタマイズ」ダイアログが開く** |
| 生成の確定 | 不要 | ダイアログ内の**「生成」ボタンが必要** |

タイルの取得自体は §8.7 のまま有効（`div.create-artifact-button-container`、
`aria-label="音声解説"`、`aria-disabled` なし）。壊れたのは**クリック後のフロー**。

### 「音声解説をカスタマイズ」ダイアログの実 DOM

`mat-dialog-container`（本文に「音声解説」を含む）。内包する `button` は実測で 5 種:

```
mdc-icon-button mat-mdc-icon-button mat-mdc-button-base            → close(×)
mat-button-toggle-button mat-focus-indicator                       → 短め / デフォルト（長さ）
mdc-button mat-mdc-button-base mdc-button--outlined mat-...        → 「N 件のソース」
mdc-button mat-mdc-button-base mdc-button--unelevated
  mat-mdc-unelevated-button button-color--primary mat-unthemed     → 「生成」
```

- 確定ボタンは `<button>`。`type` 属性なし、`aria-label` なし。
- **テキスト完全一致「生成」はダイアログ内に 1 件だけ**。
- 削除ダイアログの `yes-button` のような確定ボタン専用の安定クラスは**無い**（汎用 Material クラスのみ）。

### 症状と機序
`triggerAudioOverview` はタイルを押した後 `isGenerating()` を `clickInterval`（既定 30 秒）待つ。
ダイアログが開くだけで生成は始まらないので空振りし、再試行してもダイアログが手前にあるため
タイルを押せず `MAX_ATTEMPTS` まで失敗する。利用者からは「モーダルが出て先に進まない」と見える。

### 対策（`notebook-creator.ts` / `selectors.ts`）
1. タイルクリック後に `getAudioGenerateButton()` の出現を `DIALOG_WAIT_MS`（5 秒）待ち、
   出たら **settle 400ms を挟んで**クリックする（§8.11 と同型の「出現 ≠ 操作可能」対策）。
2. ダイアログが出ない経路（旧 UI / 将来の変更）でも壊れないよう、出現しなければ**素通り**して
   従来どおり生成開始を待つ。
3. 待機中に生成が始まっていたら押さない（二重生成防止。#60 の W1 封じと同じ考え方）。

### セレクタ設計
確定ボタン専用クラスが無いため、**ダイアログが音声解説のものであることを本文テキストで確認**して
から、テキスト**完全一致** `/^(生成|generate)$/i` で引く。
- ダイアログの絞り込みは必須 —— 無関係なダイアログ（削除確認等）の主ボタンを押すと破壊的になり得る。
- 完全一致も必須 —— 前方一致だと「音声解説を生成しています…」を拾い、生成中カードを押しに行く。

### 実機検証
修正後のシーケンス（タイル → ダイアログ待ち → settle 400ms → 「生成」）で
「音声解説を生成しています...」への到達を確認。

## 8.13 新規作成ボタンとソース種別ボタンの刷新（2026-10-04 実機確認）

F2-2（ツールバーアイコン → 新規ノートブック作成）が「ボタンを押しても新規作成に進まない」状態に
なった。DOM セレクタ 2 箇所が同時に外れていた（ホスト / URL は §8.9 のまま無傷）。

### 変更点

| | 旧 | 新（2026-10-04）|
|---|---|---|
| 一覧の作成ボタン | `button.create-new-button`、`aria-label="ノートブックを新規作成"`（2026-07-04）| **専用クラスなし**（汎用 Material クラスのみ）、`aria-label="新しいノートブック"`、textContent は `add_2新しいノートブック`（アイコンのリガチャ込み）|
| ソース種別ボタン | `button.drop-zone-icon-button`（§8.6）| `button.source-action-button`（親は `div.source-buttons`）|
| ソース追加ボタン | `button.add-source-button`（§8.6）| 専用クラスなし、`aria-label="ソースを追加"`（既存の aria-label フォールバックで取得できており修正不要）|

- 作成ボタンの祖先: `nb-button` → `div.projects-header-actions` → `div.projects-header-row` →
  `div.my-projects-container` → `div.all-projects-container`。一覧ページ内で該当は 1 件。
- 種別ボタンは「ファイルをアップロード / ウェブサイト / 書籍 / ドライブ / コピーしたテキスト」の 5 つ。
  ウェブサイトの textContent は `link_2video_youtubeウェブサイト`。
- 同ダイアログの「ウェブ」コーパス選択ボタン（`nb-button.corpus-select` 配下。`source-action-button`
  非該当）は引き続き存在するため、候補集合をクラスで絞る方針（§8.6）は維持する。
- **無傷だったもの**: クリック後の `/notebook/<id>?addSource=true` 遷移とダイアログ自動オープン、
  `mat-dialog-container`、`textarea[formcontrolname="urls"]`、テキスト「挿入」の `button[type="button"]`、
  挿入後のダイアログ消滅（実測 約 235ms）。

### 症状と機序
`getCreateNewButton` はクラス → `SOURCE_TEXT.createNew` の順で探すが、クラスが消え、文言
「新しいノートブック」も旧正規表現（`新規作成|ノートブックを新規作成|create new|new notebook`）に
一致しないため常に `null`。`createNotebookWithUrls` の ① が 15 秒でタイムアウトして `false`
（バッジ `!`）になる。仮に ① を通っても ② の種別チップが `null` で同様に止まる。② は importer
（F2-1 / F2-3）と共有しているため、**インポートも同時に壊れていた**。

### 対策（`selectors.ts`）
1. `getCreateNewButton`: 専用クラスが無くなったので **aria-label 完全一致**
   （`SOURCE_TEXT.createNewExact`）を主軸にする。部分一致（`createNew` に「新しいノートブック」を追加）は
   その後ろの保険。完全一致を先にするのは、「新しいノートブック…」という題のノートブックの
   ボタンが文書順で先にあっても掴まないため。
2. `SELECTORS.sourceChipCandidates` に `button.source-action-button` を追加（旧クラスも残す）。

### 実機検証
実験用ノートブックを 1 つ作成して確認（`https://example.com/` を 1 件挿入）。新しい判定で
作成ボタン取得 → クリックで遷移 → 種別チップ取得 → URL 欄 → 挿入有効化 → 挿入 → ダイアログ消滅まで
通ること、およびノートブックページの「ソースを追加」→ 種別チップ取得（インポート経路）を確認した。

## 8.14 一覧の 3点メニュー・タイトル・おすすめ行・削除確認の刷新（2026-10-04 実機確認）

§8.13 と同じ刷新で、Phase 1（一括削除）も**チェックボックスが 1 つも出ない**状態になっていた
（アクションバーだけ表示され「0件選択中」のまま）。

### 変更点

| | 旧 | 新（2026-10-04）|
|---|---|---|
| 3点メニュー | `project-action-button > button.project-button-more` | `project-action-button > nb-icon-button.project-button-more > button`（内側 `button` は専用クラスなし、`aria-label="プロジェクトの操作メニュー"`）|
| 一覧表示のタイトル | `span.project-table-title`（絵文字は兄弟 span）| `a.project-table-title`（`title` 属性にタイトル、`span.project-table-emoji` を**内包**）|
| おすすめ行の 3点メニュー | 無し（§8.5 / #23 はこれで削除可否を判定）| **有り**。メニューは「コレクションに追加 / 上部に固定 / ノートブックを報告」で「削除」は無い |
| 削除確認の確定 / 取消 | `button.yes-button` / `button.no-button`（§8.10）| クラス消滅。「削除」は `mat-tonal-button`、「キャンセル」は専用クラスなし |

- セクション容器は両表示モード共通: `.all-projects-container` 直下に `div.my-projects-container` と
  `div.featured-projects-container`。おすすめカードは `mat-card.featured-project-card`。
- 所有ノートブックのメニュー: 「タイトルを編集 / コレクションに追加 / 上部に固定 / 削除」。
  削除項目 `.cdk-overlay-container button.mat-mdc-menu-item.delete-button` は**無傷**。
- カードのチェックボックスホスト `div.project-button-box` と、その直接子 `project-action-button`、
  カードタイトル `span.project-button-title`、安定祖先 `welcome-page` は無傷。
- 一覧表示は既定で各セクション先頭のみ（実測 10 + 5 行）を出し、「もっと見る / すべて表示」で展開する。

### 症状と機序
`getMoreButton` が全行で `null` → `isDeletableRow` が全行 `false` → チェックボックス注入対象ゼロ。
セレクタだけ直すと今度はおすすめ行が「削除可能」と誤判定される（3点メニューが付いたため）。
また一覧表示のタイトルは `textContent` だと「📄 タイトル」になり、カード表示のキーと食い違う。

### 対策（`selectors.ts`）
1. `SELECTORS.moreButton` に新形 `project-action-button .project-button-more button` を追加（旧形も残す）。
2. `isDeletableRow`: moreButton あり **かつ** `.featured-projects-container` の外。ロール列の文言は
   ロケール依存なので使わない（#23 と同じ理由）。取りこぼしても deleter は「削除」項目が出ず
   タイムアウトで安全停止する。
3. `SELECTORS.title` をタグ非依存の `.project-table-title` にし、`getRowIdentity` は `title` 属性を
   優先（無ければ `textContent`）。カード表示と同じタイトルになり、表示切替後も選択キーが一致する。
4. 削除確認ボタンは修正不要 —— §8.10 の二段構え（安定クラス → テキスト完全一致）の後段で取れている。
5. deleter の行取得を `findDeletableRowByIdentity`（削除可能な行に限定）に変更。グリッド表示では
   おすすめセクションが文書順で先にあり、所有ノートブックと同名のおすすめ行があるとタイトルだけの
   検索ではそちらを掴む。旧 DOM では 3点メニューが無く即停止していたが、新 DOM では「削除」項目の
   無いメニューを開いてタイムアウトし、選択した行を消せない（誤削除にはならない。独立レビュー指摘）。

6. **行の識別をノートブック ID に変更**（`types.ts` の `makeTarget` / `selectors.ts` の `getRowIdentity`）。
   新 DOM では全行が ID を持つ: 一覧は `a.project-table-title` の `href="/notebook/<id>"`、カードは
   `span.project-button-title` の `id="project-<id>-title"`。実測でグリッド 413 行すべて ID あり・重複なし、
   一覧 15 行の ID はすべてグリッド側と一致。キーは `id:<id>`、ID を取れない DOM では従来の
   `title:<タイトル>` にフォールバックする。これで §8.5 以来の「同名ノートブックを区別できない」
   （片方だけチェックしても 2 件扱いになり、削除で両方消える）が解消する。行検索もキー一致に
   したので、ID で確定した対象を同名の別行に取り違えない。
7. 一覧表示のチェックボックス配置（`row-checkbox.css`）。タイトルが `display:flex` の `a` になり、
   注入した label が独立行に落ちて行高が 52 → 61px に伸びていた。チェックボックス直後のタイトルを
   `inline-flex` にして同じ行に並べる。実測（359 行）: 行高はすべて 52px、チェックボックスとタイトルの
   中心 Y の差は 0px、タイトルのセル外へのはみ出しなし、`elementFromPoint` で両者とも最前面。

8. 一覧の再スキャン observer に `attributes`（`attributeFilter: ['href', 'id']`）を追加。ID は属性に
   あるため、Angular が行ノードを同名の別ノートブックへ付け替えた場合（変化が属性だけ）にも
   チェックボックスのキーと checked を追従させる（独立レビュー指摘。実機での発生は未確認の予防）。

### 未対応（既知）
- my-projects 側に閲覧者権限の共有ノートブックがある場合のメニュー構成は未調査（2026-10-04 時点、調査アカウントの
  一覧に出ている所有側 10 行はすべてロール「オーナー」で、該当ノートブックが無い）。「削除」項目が無ければ下記のとおりメニューを閉じて安全停止する。

### 再試行時の同一性確認とメニューの後始末（#87 / #88）
- **再試行の入口で同一性を確認する。** 掴んだ行ノードは `row.isConnected` だけでは「同じノートブックを
  指している」と言えない（Angular がノードを別ノートブックへ再利用しても true のまま）。キーが ID のとき
  だけ、2 回目以降の試行の入口で `findRow(target)` を引き、**掴んだノードそのものが返らなければ**
  （別ノード / `null`）throw して安全停止する。`null` は「削除成立」とはみなさない: `findRow`
  （`findDeletableRowByIdentity`）は ID 一致に加えて行セレクタ・3点メニューの存在・おすすめセクション外を
  要求するので、未削除でも再描画中は引けないことがある。成功扱いにすると未削除のまま次の対象へ進み、
  選択も解除される（外部レビュー指摘）。引き直したノードは操作しない（確認だけ）ので、
  「掴んだノードだけを操作し続ける」方針は変わらない。タイトルキーは一意でないため適用しない。
- **結果不明は失敗として報告する（既知の誤報）。** 上の停止時、および最終試行で削除が成立したのに
  ノードが再利用されて残った場合、実際には消えていても「失敗」として停止する。安全側に倒した結果で、
  利用者は一覧を見れば実態が分かる。現行 DOM ではノード再利用自体を観測していない。
- **「削除」項目が出ずタイムアウトしたらメニューを閉じる。** 3点メニューを開くと `cdk-overlay-container` に
  `div.cdk-overlay-backdrop.cdk-overlay-transparent-backdrop` が 1 枚足され、パネルは
  `div.mat-mdc-menu-panel.project-actions-menu`。バックドロップを `click()` するとパネルもバックドロップも
  消え、URL は変わらない（2026-10-04、おすすめ行のメニュー = 「コレクションに追加 / 上部に固定 /
  ノートブックを報告」で計測。ページ内スクリプトによる計測で、拡張経由の確認ではない）。
  `getOpenMenuBackdrop` は行の3点メニューのパネル（`project-actions-menu`）が開いているときだけ
  透明バックドロップを返す。確認ダイアログの
  バックドロップ（dark）は返さない。

### メニュー / 確認ダイアログと対象行の対応付け（#94・2026-10-04 実機）
計測はページ内スクリプト（`getDeleteMenuItemFor` と同一ロジックを評価）。確認ダイアログは開いて構造を読んだ後
キャンセルで閉じており、何も削除していない。ビルドした拡張経由の確認ではない。

- **3点メニューのトリガー** `button.mat-mdc-menu-trigger`（`aria-haspopup="menu"`）は、閉じているとき
  `aria-expanded="false"`（`aria-controls` なし）、開いている間だけ `aria-expanded="true"` と
  `aria-controls="mat-menu-panel-N"` を持つ。パネルは `div#mat-menu-panel-N.mat-mdc-menu-panel.project-actions-menu`
  （`role="menu"`）で、「削除」項目 `button.mat-mdc-menu-item.delete-button` はその中にある。
  「削除」を押すとトリガーは `aria-expanded="false"` に戻る。
- **取り違えの再現**: 行 A のメニューを開く → バックドロップで閉じる → 行 B のメニューを開く、とすると、
  ページ全体から引く旧 `getDeleteMenuItem()` は B の「削除」を返す（A の削除フローがこれを掴むと B を消す）。
  `getDeleteMenuItemFor(A のトリガー)` は `null`、`getDeleteMenuItemFor(B のトリガー)` だけが項目を返す。
  おすすめ行のメニュー（「削除」項目なし）ではトリガーが開いていても `null`。
- **確認ダイアログは対象を示さない。** 本文は「このノートブックを削除しますか？このノートブックとそのすべての
  コンテンツは、Gemini を含むすべての場所から完全に削除されます。」のみで、タイトルも ID も DOM に無い
  （`confirm-dialog` > `base-dialog` > `h2.header-title` / `span.message-text` / `div.dialog-footer`。
  取消は `nb-button.no-button.tertiary-button` > `button`）。内容からは誰のダイアログか判別できないため、
  deleter は順序とノードで束縛する:
  1. メニューを開く前に、確認ダイアログが無くなるのを待つ（直前の件のダイアログが閉じ切っていないだけの
     ことがある）。タイムアウトまで残っていれば由来不明として停止。
  2. 自分のトリガーのパネル内の「削除」だけを押す。
  3. 最初に見えた `mat-dialog-container` のノードに束縛する。確定ボタンを掴む前にそのノードが消えたり
     別ノードに替わったりしたら停止（後から在るダイアログは自分が開いたものではない）。
  4. settle 待機の後、掴んだ確定ボタンがまだ DOM に接続されているときだけ押す。押さなかった場合も
     行の消滅待ちには進む（利用者が自分で確定していれば完了、消えなければ再試行 / 失敗）。
- **残る前提**: 4 の接続確認からクリックまでは同期。確認ダイアログ表示中は dark バックドロップが一覧を
  覆うので、利用者が別の行の削除確認を開くには先に自分のダイアログを閉じる必要があり、その時点で
  3 または 4 が効く。ダイアログのノードが再利用される（閉じて開き直しても同じノード）DOM では 3 は
  効かないが、現行の Angular Material はダイアログごとにコンテナを作り直す（未計測・ライブラリの
  一般的な挙動からの推測）。

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
