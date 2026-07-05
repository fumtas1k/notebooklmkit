# タブ一括インポートの UX 改善 + バッチ投入 設計

作成日: 2026-07-05 / 対象: F2-1 / F2-3（`src/content/ui/import-panel.ts`, `src/content/importer.ts`）

## 背景と課題

ノートブックページ右下のインポートパネル（`mountImportPanel`）で「開いているタブを読み込む」を使うと、
同一ウィンドウの全タブがチェックボックス付きで一覧表示される。現状の3つの課題:

1. **タブが多いと一覧が窮屈で見づらい**（`.nlk-import-tab-list` の行が詰まり、選択状況も把握しづらい）。
2. **最初から全タブが選択済みで、まとめて外す手段が無い**（`import-panel.ts` で `check.checked = true` 固定）。
3. **インポートが1 URL ずつ逐次処理**（`importer.ts` の `importUrls` は URL ごとに
   「ソース追加ダイアログを開く→1件入力→挿入→閉じるのを待つ」をループ）。
   一方 NotebookLM のウェブサイトソース追加ダイアログは **1回の投入で改行/スペース区切りの
   複数 URL を受け付ける**（`docs/requirements.md` §8.6 line 166）ため、1件ずつは非効率。

## スコープ

- **対象**: インポートパネルのタブ一覧 UI（①②）と、インポート実行ロジックのバッチ化（③）。
- **対象外（→ issue 化）**: タブ一覧の絞り込み検索ボックス（`priority: low` / `enhancement`）。
- 既存の DI ＋純粋ロジック分離、安全停止規約、権限最小化は不変。

## ① 一覧の見やすさ

- **件数ヘッダー**: タブ一覧の直上に「選択 {selected} / 全 {total}」を表示する行を追加する
  （i18n テンプレート）。チェックボックスの変更で**ライブ更新**する。
- **スクロール領域と行間隔の CSS 改善**: `.nlk-import-tab-list` に読みやすい行 padding / 行間を与え、
  スクロール領域として明確化する（`max-height` を保ちつつスクロールバーを分かりやすく）。
  各行は現状どおり**タイトル1行省略**（`white-space: nowrap` + ellipsis）を維持し、URL は `title` 属性ツールチップのまま
  （実装量を抑える）。
- jsdom で検証できない配置・スタッキングは無い（パネルは `document.body` 直下固定・既存構造の踏襲）。

## ② 全選択／全解除トグル

- 件数ヘッダー行の右側に**トグルボタン1つ**を置く（`data-nlk="import-toggle-all"`）。
- ラベルは状態で切替:
  - 全チェック時 → 「すべて解除」。押すと全チェックを OFF。
  - 1つでも未チェック → 「すべて選択」。押すと全チェックを ON。
- 既定は現状どおり**全選択**（ユーザーの明示要望）。トグル/個別チェックの変更で件数ヘッダーとラベルを再描画する。
- タブ一覧を再読込（「開いているタブを読み込む」再押下）したら、また全選択 + ラベル「すべて解除」に戻る。

### UI 構造（`renderTabList` 相当の再構成）
```
tabList (data-nlk=import-tab-list)
 ├─ header (data-nlk=import-tab-header)
 │   ├─ span 件数「選択 N / 全 M」(data-nlk=import-tab-counts)
 │   └─ button トグル (data-nlk=import-toggle-all)
 └─ listBody (data-nlk=import-tab-items) … スクロール領域
     └─ label × N（既存の import-tab-item / import-tab-check）
```
- 件数・ラベルの更新は `updateTabHeader()` にまとめ、各チェックの `change` と トグル押下から呼ぶ。
- 空タブ時（`noTabs`）・エラー時（`tabsError`）はヘッダー無しでメッセージのみ（現状踏襲）。

## ③ バッチ投入（全件1回 + フォールバック）

`importer.ts` を「コミット境界」で整理する。既存 `importOne(value, deps, signal)` は多行 `value` を
そのまま入力欄にセットできるため**バッチ投入に再利用**し、`importUrls` オーケストレーション側で
コミット前/後を区別する薄い分岐を足す。

### コミット境界の明確化
`importOne` の内部ステップ:
- ①ソース追加ボタン ②ウェブサイトチップ ③URL 入力 ④挿入ボタン有効化待ち … **ここまで未コミット**（`signal` 付き）
- ⑤挿入クリック（**コミット点**） ⑥ダイアログ消滅待ち（`signal` 無し＝見届ける）

現状 `importOne` は④の後に click →⑤待ち。バッチ/フォールバック双方でコミット前後を判定できるよう、
`importOne` が「挿入クリック済みか」を呼び出し側へ伝える必要がある。実装方針:

- `importOne` を **コミット前失敗**（`①〜④` で throw: `AbortError` またはタイムアウト）と
  **コミット後失敗**（⑥で throw）を区別できる形にする。具体的には throw 時に
  `committed: boolean` を持つ**型付きエラー**（例: `ImportStepError extends Error { committed: boolean }`）を投げる。
  - `①〜④` の `waitFor` 由来の失敗（`TimeoutError` / `AbortError`）→ `committed=false`。
  - `⑥` の `waitFor` 由来の失敗（`TimeoutError`）→ `committed=true`。
  - `AbortError` はこれまで通り呼び出し側で `aborted` として扱う（`committed=false` 相当）。

### `importUrls` の新フロー
```
1. urls が 1件なら従来の逐次ループ（バッチの利点なし）。2件以上でバッチ試行。
2. バッチ試行: importOne(urls.join('\n'), deps, signal)
   - 成功 → result.succeeded = 全 urls。return。
   - AbortError（コミット前中断）→ result.aborted=true。return。
   - コミット前失敗（committed=false のエラー）→ フォールバックへ（何も追加されていない＝安全）。
   - コミット後失敗（committed=true のエラー）→ 追加済みか不明。重複回避のため
     result.failed に全 urls をまとめて記録し停止（フォールバックしない＝安全側）。return。
3. フォールバック: 既存の1件ずつループ（importOne を url ごとに呼ぶ）。
   失敗/中断は既存規約（安全停止・URL 境界中断）どおり。
```

### 進捗表示（`onProgress`）
- バッチ試行中: `currentUrl` は使わず、`total` 件を「一括追加中」と表現できるよう
  進捗イベントを1回発火（UI 側で「N件を一括追加中…」を表示）。
- フォールバック移行時: 既存の1件ずつ進捗にそのまま切り替わる（`completed` / `failed` は
  バッチ失敗後は 0 から再カウント。バッチはコミット前失敗のみフォールバックするので二重カウントは起きない）。
- UI（`import-panel.ts` の `setProgress`）は文言のみ調整。**方針を確定**: `ImportProgress` 型に
  任意フラグ `batch?: boolean` を追加し、バッチ試行中の進捗イベントで `batch: true` を立てる。
  UI はこのフラグを見て「{total} 件を一括追加中…」を表示する（暗黙判定より明示的で回帰しにくい）。

## テスト方針（jsdom + DI）

`tests/importer.test.ts` に追加:
- **バッチ成功**: 2件以上を渡し、`importOne` が1回だけ呼ばれ（入力値が改行連結）、全件 succeeded。
- **コミット前失敗→フォールバック**: バッチの④で挿入ボタンが有効化せずタイムアウト → 1件ずつループに移行し、
  valid は succeeded / invalid は failed に切り分く（フォールバックが URL 単位で動く）。
- **コミット後失敗→停止**: 挿入クリック後にダイアログが消えず ⑥ タイムアウト → 全 urls を failed 記録し、
  フォールバックしない（`importOne` が追加で呼ばれない）。
- **中断（コミット前）**: バッチ ①〜④ で `signal` abort → `aborted=true`、ソース未追加。
- **1件のみ**: 従来ループを通る（バッチ分岐に入らない）。

`tests/import-panel.test.ts`（無ければ新規）に追加:
- タブ読込後、全チェック時トグルラベルが「すべて解除」、押下で全 OFF・ラベル「すべて選択」・件数「選択 0 / 全 M」。
- 個別に1つ OFF にするとラベルが「すべて選択」に変わり件数が減る。
- 「選択したタブを追加」は**チェック済みのみ** textarea へ（既存挙動の回帰確認）。

DOM に触るロジックは `data-nlk` フックで検証。`import-panel.ts` はテスト可能なよう
`root` 差し込み済み（既存）。

## i18n 追加キー（`src/content/i18n.ts`）

- `tabSelectionCounts`: 「選択 {selected} / 全 {total}」/ EN 相当。
- `selectAll` / `deselectAll`: トグルラベル。
- （必要なら）バッチ進捗 `importBatchProgress`: 「{count} 件を一括追加中…」/ EN 相当。

## 影響範囲・非影響

- **変更**: `src/content/importer.ts`, `src/content/ui/import-panel.ts`,
  `src/content/ui/import-panel.css`, `src/content/i18n.ts`, `src/types.ts`（`ImportProgress` に
  `batch?: boolean` を追加）, テスト。
- **非変更**: セレクタ（`selectors.ts`）は変更不要（既存のソース追加フローをそのまま使う）。
  background / 権限 / manifest 不変。deleter・notebook-creator 不変。
- **CLAUDE.md**: 概要のフェーズ記述に大きな変化は無いが、importer が「複数 URL を1ダイアログで
  一括投入（失敗時1件ずつフォールバック）」に変わる点はアーキテクチャ節に一言反映する。

## リスク / 留意

- **コミット後の状態不明**: 挿入クリック後にダイアログが消えないケースは、追加済み/未追加が判別できない。
  フォールバックすると重複投入の恐れ → **停止**を選択（安全側）。ユーザーは再インポート時に
  重複を目視で避けられる（`removeUrls` は succeeded のみ除去するため、failed 分は textarea に残る）。
- **NotebookLM 側の1回あたり上限**: 巨大な URL 数を1回投入した際の上限や描画遅延は未計測。
  今回は「全件1回」を採用（ユーザー選択）。もし実機で上限に当たる場合は、後日チャンク分割を issue 化して検討。
- **実機確認**: `docs/e2e-checklist-phase2.md` に「多数タブでの一覧スクロール/全解除トグル」と
  「複数 URL の一括投入成功」の観点を追記する。
