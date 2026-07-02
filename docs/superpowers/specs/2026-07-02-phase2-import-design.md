# Phase 2 設計書 — タブ / URL の一括インポート

> 対応要件: `docs/requirements.md` §4 Phase 2（F2-1 / F2-3。F2-2 は先送り）
> ステータス: 承認済み（2026-07-02）

## 1. 目的

ノートブックページ（`/notebook/<id>`）に、複数 URL をまとめてソース追加する機能を付ける。
NotebookLM 標準の「ソースを追加 → ウェブサイト」フローは 1 URL ずつしか受け付けないため、
これを DOM 自動化で順次実行し一括化する。

## 2. スコープ判断

| 要件 | 本設計での扱い | 理由 |
|---|---|---|
| **F2-3** 複数 URL 貼り付けインポート | **実装する** | content script 完結。インポートのコア機能 |
| **F2-1** 開いているタブの一括インポート | **実装する** | F2-3 の入力（URL リスト）にタブ URL を流し込む形で実現。タブ列挙のみ background + `tabs` 権限が必要 |
| **F2-2** ツールバーからのワンクリックインポート | **先送り（issue 化）** | 「どのノートブックに追加するか」のターゲティング設計が別物（最後に開いたノートブックの記憶 = `storage` 権限、NotebookLM タブへのクロスタブ制御が必要）。暫定セレクタの上に載せる面積を増やしすぎない |

## 3. 重要な前提: ソース追加フローの DOM は未調査（暫定セレクタ）

`docs/requirements.md` §10 のとおり、Phase 2（ソース追加フロー）の実 DOM 調査は未実施。
本設計は一般に知られる NotebookLM の UI フローに基づく**暫定セレクタ**で実装する。

- 追加フローの想定: ソースパネルの「追加」ボタン → アップロードダイアログ（`mat-dialog-container`）
  → ソース種別チップ「ウェブサイト」 → URL 入力 → 「挿入」ボタン → ダイアログが閉じる。
- **クラス名への依存を最小化**し、`aria-label` / テキスト内容（ja / en 両対応の正規表現）で
  候補要素をマッチングする方式を主軸にする。Angular Material のクラス churn に最も強い。
- セレクタ・マッチャは Phase 1 同様 `selectors.ts` に集約。実機確認は
  `docs/e2e-checklist-phase2.md`（新規）で行い、ズレていたら selectors.ts だけを直す。
- 想定外 DOM のときは `waitFor` タイムアウト → **失敗を記録して安全に停止**（Phase 1 と同じ規約）。

## 4. 検討したアプローチ

| 案 | 概要 | 評価 |
|---|---|---|
| **A. ノートブックページにパネル + 最小 background（採用）** | インポート UI は content script がノートブックページに注入。background は「送信元ウィンドウのタブ一覧を返す」だけ | Phase 1 のパターン（DI・selectors 集約・jsdom テスト）をそのまま流用でき、UI とターゲットノートブックが自然に一致する |
| B. popup 中心 UI | 拡張機能 popup にタブ選択 UI を置き、NotebookLM タブへメッセージで指示 | ターゲットノートブックの特定が難しい（NotebookLM タブが無い/複数のケース）。popup は jsdom テストしづらく新規面積が大きい |
| C. RPC（batchexecute）直接 | 内部 API を直接叩く | 要件 §3.2 で非採用と決定済み |

## 5. ファイル構成（追加・変更分）

```
src/
├─ background/
│  └─ main.ts              # ★新規: タブ列挙のみの service worker
├─ content/
│  ├─ main.ts              # 変更: ページ種別ルーティング（一覧 / ノートブック）
│  ├─ selectors.ts         # 変更: ソース追加フローの暫定セレクタ/マッチャ追加
│  ├─ dom-utils.ts         # 変更: setInputValue（Angular 向け input イベント発火）追加
│  ├─ i18n.ts              # 変更: インポート用文言（ja/en）追加
│  ├─ url-list.ts          # ★新規: URL リストのパース/検証/重複排除（純関数）
│  ├─ importer.ts          # ★新規: インポートオーケストレータ（DI・逐次・中断・安全停止）
│  ├─ tabs-bridge.ts       # ★新規: background への listTabs メッセージの content 側ラッパ
│  └─ ui/
│     ├─ import-panel.ts   # ★新規: フローティングボタン + インポートパネル
│     └─ import-panel.css  # ★新規
├─ types.ts                # 変更: ImportProgress / ImportResult / TabInfo 追加
manifest.config.ts          # 変更: permissions: ['tabs'] と background 追加
docs/e2e-checklist-phase2.md # ★新規: 実機での暫定セレクタ検証手順
tests/                      # url-list / importer / import-panel / tabs-bridge /
                            # selectors(ソース追加) / main ルーティング の各テスト追加
```

## 6. 各コンポーネント設計

### 6.1 ページルーティング（main.ts）

- ページ種別は **URL パスで判定**する（ノートブックページの DOM 構造に依存しない）:
  - `location.pathname` が `/notebook/` で始まる → ノートブックページ → インポート UI をマウント。
  - それ以外で `.all-projects-container` が存在 → 一覧ページ → 既存の Phase 1 `init()`。
- NotebookLM は Angular SPA で `history.pushState` 遷移のためイベントが取れない。既存の
  bootstrap `MutationObserver` を「常駐ルーター」に拡張し、DOM 変化のたびに
  pathname / コンテナ有無をチェック、ページ種別が変わったら現 UI を dispose して切替える。
  同種別のままなら何もしない（チェックは文字列比較のみで軽量）。
- 既存 `init()`（一覧ページ側）の内部は変更しない（Phase 1 のレビュー済み配線を保護）。

### 6.2 URL パース（url-list.ts / 純関数）

```
parseUrlList(text: string): { valid: string[]; invalid: string[] }
```

- 改行・空白で分割、trim、空要素除去。
- `new URL()` でパースし **http / https のみ** valid。それ以外（ftp:, chrome:, ただの単語等）は invalid へ。
- 重複は初出順を保って排除。

### 6.3 インポートオーケストレータ（importer.ts）

`deleter.ts` と同型の DI 構成。`document` に触らない。

```ts
interface ImporterDeps {
  getAddSourceButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void
  click(el: HTMLElement): void
  waitFor: typeof waitFor
  timeout?: number   // 既定 10000ms（URL フェッチを伴うため削除より長め）
}
importUrls(urls: string[], deps: ImporterDeps,
           opts: { onProgress?; signal? }): Promise<ImportResult>
```

1 URL あたりのシーケンス（各ステップ `waitFor` で出現待ち）:

1. 「追加」ボタン出現待ち → クリック（ダイアログを開く）。
2. ダイアログ出現待ち → 「ウェブサイト」チップ出現待ち → クリック。
3. URL 入力欄出現待ち → `setInputValue`（値設定 + `input` イベント発火。Angular のフォーム
   バインディングは代入だけでは反応しないため）。
4. 挿入ボタンが**有効になるのを**待つ（`disabled` でない状態を waitFor）→ クリック。
5. 掴んだダイアログノードが DOM から外れる（`isConnected === false`）まで待つ = 1件完了。
   （deleter と同じ「掴んだノードで完了判定」パターン。再検索しない）

制御規約（Phase 1 と同一）:

- **失敗（タイムアウト / 要素不在）で停止**。失敗 URL を記録し、残りは未処理として報告。
  無効 URL は開始前に `parseUrlList` で弾いてあるため、実行時失敗 ≒ DOM 不一致か
  NotebookLM 側のエラー（ソース上限等）であり、続行しないのが安全。
- 中断（signal）は **URL 境界でのみ**判定。処理中の1件は完了させる。
- 進捗コールバック `{ total, completed, failed, currentUrl }`。

インポートは非破壊操作のため、削除のような件数タイプ確認は**設けない**（ボタンに件数を
明示するのみ）。実行中は再入場ガード（busy フラグ）で二重実行を防ぐ。

### 6.4 インポートパネル（ui/import-panel.ts）

- ノートブックページの DOM に依存しない **`document.body` 直下の固定配置 UI**:
  - 右下フローティングボタン（`data-nlk="import-fab"`）でパネル開閉。
  - パネル（`data-nlk="import-panel"`）:
    - **textarea**（URL を1行1件で貼り付け。F2-3）— これが唯一のインポート対象ソース。
    - 「開いているタブを読み込む」ボタン → `tabs-bridge` でタブ一覧を取得し、
      **チェックボックス付きタブリスト**を表示（既定全チェック。NotebookLM 自身のタブと
      http/https 以外は除外）→「選択したタブを追加」で textarea に URL を追記（F2-1）。
    - 有効 / 無効 URL 件数のライブ表示（`parseUrlList` を input のたびに実行）。
    - 「N件をインポート」ボタン（有効0件 or busy で無効化）、実行中は進捗表示と「中断」。
- すべての注入要素に `data-nlk` 属性（Phase 1 規約）。
- 完了後: 成功 / 失敗 / 未処理件数のサマリを表示。textarea から成功分の行を取り除く
  （失敗・未処理分が残るのでリトライしやすい）。

### 6.5 タブ列挙（background/main.ts + tabs-bridge.ts）

- background service worker は**ステートレスで1メッセージのみ**対応:
  - `{ type: 'nlk:list-tabs' }` → `chrome.tabs.query({ windowId: sender.tab.windowId })`
    → `{ tabs: [{ title, url }] }`（http/https のみ、`notebooklm.google.com` は除外）。
- content 側 `tabs-bridge.ts` は `chrome.runtime.sendMessage` を Promise 化した
  `listOpenTabs()` を提供。`chrome` オブジェクトは引数注入可能にして jsdom でテストする。
- **権限**: `permissions: ['tabs']` を追加（他タブの URL / title 取得に必須）。
  要件 §7 は「background service worker（タブ取得等）」を想定済み。ストア審査向けの
  正当化: 「開いているタブの URL をノートブックへ一括追加する機能にのみ使用。外部送信なし」。

### 6.6 セレクタ（selectors.ts への追加。すべて暫定）

- `getAddSourceButton`: ソースパネル内の追加ボタン。`aria-label` / テキストが
  `/ソースを追加|追加|add source/i` にマッチする `button` を優先順で探索。
- `getSourceDialog`: `mat-dialog-container`（削除確認と同じコンテナ要素。ノートブック
  ページではソース追加ダイアログとして使われる）。
- `getWebsiteChip`: ダイアログ内のチップ群（`mat-chip` / `.mdc-evolution-chip` /
  `[role="option"]` / `button`）からテキスト `/ウェブサイト|website/i` にマッチするものを探し、
  クリック可能な祖先（`closest`）を返す。
- `getUrlInput`: ダイアログ内の `input[type="url"]` → `input[type="text"]` → `textarea` の
  優先順で最初に見つかる可視要素。
- `getSubmitButton`: ダイアログ内のテキスト `/挿入|insert/i` の `button`、
  無ければ `button[type="submit"]`。
- ファイル冒頭コメントに「§8.5 相当の実 DOM 調査は未実施。実機確認は
  e2e-checklist-phase2.md」と明記する。

### 6.7 i18n

既存の `{placeholder}` テンプレート方式に ja / en の文言を追加
（fab ラベル、パネルタイトル、placeholder、タブ読み込み、件数、進捗、サマリ、エラー等）。

## 7. エラー処理・安全性

- すべての要素待ちにタイムアウト（既定 10000ms）。超過 → その URL を失敗として**停止**し、
  「NotebookLM の画面構造が想定と異なる（または追加に失敗した）ため中断」を表示。
- ソース数上限（無料 50 / Plus 300）到達時は NotebookLM 側で挿入が失敗する想定 →
  上記の安全停止に帰着（既知の制限として E2E チェックリストに記載）。
- 失敗時に NotebookLM のダイアログが開いたまま残ることがあるが、**追加のクリーンアップ
  クリックはしない**（想定外状態でこれ以上操作しないのが安全側。ユーザーが手動で閉じる）。
- インポートは非破壊だが、途中停止しても再実行で重複ソースになり得る点はサマリ文言で補足しない
  （NotebookLM 側に重複検知は無い。textarea から成功分を除去することで実質的に防ぐ）。
- SPA 遷移で dispose された場合は進行中ループを abort する（Phase 1 の issue #16 と同じ規約）。

## 8. 権限・プライバシー

- `host_permissions` は従来どおり `https://notebooklm.google.com/*` のみ。
- `permissions: ['tabs']` を新規追加（F2-1 に必須。最小権限の原則の範囲内で、
  `<all_urls>` ホスト権限は要求しない）。
- 外部ネットワーク送信ゼロは維持。タブ情報は端末内（content ↔ background メッセージ）で完結。

## 9. テスト方針（Vitest + jsdom）

| モジュール | テスト内容 |
|---|---|
| `url-list.ts` | 分割 / trim / http(s) 判定 / invalid 振り分け / 重複排除 / 順序保持 |
| `importer.ts` | モック deps で全ステップ順次実行、進捗更新、途中失敗で停止、signal で URL 境界中断、ダイアログ close 待ち |
| `ui/import-panel.ts` | textarea 入力 → 件数表示、タブリスト表示 / 選択追記、busy 中の無効化、サマリ表示、成功行の除去 |
| `tabs-bridge.ts` | モック chrome で sendMessage 呼び出しと Promise 解決 / エラー |
| `selectors.ts`（追加分） | 想定 DOM フィクスチャで各 getter がマッチ / 不在時 null |
| `main.ts` ルーティング | pathname 切替で一覧 UI / インポート UI がマウント・dispose される |

background（`chrome.tabs.query`）はロジックを薄い関数に切り出してユニットテストし、
結線は手動 E2E（`docs/e2e-checklist-phase2.md`）で確認する。

## 10. 受け入れ基準

- [ ] ノートブックページで URL リストを貼り付け、一括でソース追加できる（F2-3）。
- [ ] 現在のウィンドウの開いているタブから選択して一括追加できる（F2-1）。
- [ ] 想定外 DOM ではクラッシュせず、失敗を通知して安全に停止する。
- [ ] 追加権限は `tabs` のみ。外部送信ゼロを維持。
- [ ] 文言は ja / en 対応。
- [ ] `npm run typecheck` / `npm test` が緑。

## 11. スコープ外

- F2-2（ツールバーワンクリック）→ issue 化して Phase 2.5 以降で検討。
- Phase 3 全機能（YouTube / RSS / 横断管理 / 音声 DL / サービス最適化）。
- RPC 直接方式。
- ソース追加フローの実 DOM 調査そのもの（本実装は暫定セレクタ。実機確認は E2E チェックリストで行い、ズレは selectors.ts の修正で追随する）。
