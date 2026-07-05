# アクションバー件数を「選択済み×可視」に一致させる（issue #31）

## 背景

`SelectionStore` は title 由来のキーを保持し、`injectRowCheckboxes` は observer tick では
prune しない（フィルタタブ往復で選択を保持するため。PR #27 レビュー第3ラウンドで可視性ベースの
prune を撤去した）。このトレードオフにより、リネーム（インプレース）や NotebookLM 側の削除で
一覧から消えた行の選択キーが `store` に残留し得る（幽霊選択）。

アクションバー（`ui/action-bar.ts`）は件数を `store.size` で表示するため、残留キーがあると
「N 件選択中」の N が可視のチェック状態と一致しなくなる。削除方向には安全（`buildTargets` は
可視行のみ対象なので誤削除は起きず、無言 no-op になるだけ）だが、UI 表示のズレはユーザーを
混乱させる。

参照: issue #31、PR #27 レビュー、`src/types.ts`（title 識別の既知制約）。

## 目的

アクションバーの件数表示を `store.size`（選択キー総数）から **「選択済みかつ現在可視」**
（`buildTargets(store, root).length` 相当）に変更し、prune せずに件数と可視選択を一致させる。
タブ往復での選択保持（残留キー方針）と両立させる。

## スコープ

対象（アクションバーの件数が現れる箇所すべてを可視件数に統一）:
- 「N 件選択中」の表示（`bar-count`）
- 削除ボタンのラベル「選択した N 件を削除」（`bar-delete`）
- 削除ボタンの N=0 無効化（`del.disabled`）

非対象:
- `store` からの残留キーの prune（撤去済み方針を維持。タブ往復での選択消失を招くため）
- 同名タイトルの識別（title 識別の既知制約。本 issue の範囲外）
- `buildTargets` / 削除ロジック自体（既に可視行のみ対象で正しい）

## 設計

### アーキテクチャ（案 A: 件数算出コールバックの DI）

`ui/action-bar.ts` は UI モジュールであり、DOM セレクタ（`selectors.ts`）に依存させない
（CLAUDE.md の分離規約）。件数の算出は呼び出し側（`main.ts`）から**コールバックとして注入**する。

**`ui/action-bar.ts`**
- `mountActionBar` のオプションに `count?: () => number` を追加する。span 要素のローカル変数
  `count` との命名衝突を避けるため、分割代入で `count: countFn` に束縛する。
- `render` はこのコールバックで件数を取得する（`currentCount = () => countFn?.() ?? store.size`）。
  「N 件選択中」・削除ボタンラベル・N=0 無効化はすべてこの値を使う。
- `count` 未指定時は `store.size` にフォールバックする（後方互換。`root` を渡さない既存テストや
  DOM を持たない呼び出しはこれで従来どおり動く）。
- 戻り値に `refresh(): void` を追加し、外部（observer tick）から再描画を促せるようにする。
  `refresh` は現在の busy 状態のまま `render` を呼び直すだけ。

**`main.ts`**
- `mountActionBar` に `count: () => buildTargets(store, root).length` を渡す。
- 一覧再描画 observer のコールバックを
  `() => injectRowCheckboxes(store, root)` から
  `() => { injectRowCheckboxes(store, root); bar.refresh() }` に変更する
  （`bar` は observer 定義より前に生成済み）。

### データフロー（件数の意味 = 選択済み×現在可視）

- **選択変化**: `store.set/toggle/replaceAll/clear` → `emit` → `onChange(render)` →
  `count()` = 最新の可視選択数。
- **一覧再描画**（リネーム / NotebookLM 側削除 / フィルタタブ切替）: observer tick →
  `injectRowCheckboxes` → `bar.refresh()` → `render` → `count()`。
  幽霊選択（残留キーだが不可視）は `buildTargets` が拾わないため件数に出ない。

### エラー処理・エッジケース

- **削除実行中**: observer を切断する（`main.ts` が一覧を大量に mutate するため）。この間
  `refresh` は呼ばれないが、`setProgress`/`setBusy` 経由で `render` は走る。削除完了後 finally の
  再注入（`injectRowCheckboxes`）と `setBusy(false)` → `render` で件数は再同期される。
- **削除後の成功分解除**: `render` の onChange 経路が emit ごとに `buildTargets`（O(行数)）を
  再計算するため、成功分を 1 件ずつ `store.set(key, false)` すると解除件数分の重複スキャンに
  なる。`store.replaceAll`（残す = 現選択 − 成功分）で 1 回の emit に畳む。幽霊選択キーは成功して
  いないため保持され、残留キー方針と整合する。
- **`count` が例外を投げないこと**: `buildTargets` は純粋な DOM 読み取り（`getNotebookRows` →
  `getRowIdentity` → `makeTarget`）で throw しない。
- **`root` なし（テスト）**: `count` 未指定 → `store.size` フォールバックで従来どおり。
- **パフォーマンス**: observer tick ごとに `buildTargets`（全行スキャン O(行数)）が 1 回増える。
  同 tick で走る `injectRowCheckboxes` も同オーダーの全行スキャンであり、追加コストは有界。

## テスト計画

**`tests/action-bar.test.ts`**（既存4テストは `count` 未指定のまま通過 = フォールバック検証を兼ねる）
- 新規: `count` コールバックを渡すと `render` がそれを使う（`store.size` ではなく `count()` の値を
  「N 件選択中」・削除ボタンラベル・無効化に反映する）。
- 新規: `refresh()` を呼ぶと `count()` が再評価され、表示が更新される。

**`tests/main-wiring.test.ts`**
- 可視行 ＋ 残留選択キー（幽霊選択）が混在する状況を「すべて選択（A,B）→ B の行を DOM から削除」で
  作り、`init` 後のアクションバー件数が**可視選択のみ**（`buildTargets` 相当）を反映すること、
  observer tick 経由でも更新されることを検証。

## 受け入れ基準

- 幽霊選択（残留キーだが一覧に不可視）があっても、アクションバーの件数・削除ボタンラベルが
  可視のチェック状態と一致する。
- タブ往復での選択保持は維持される（prune しない）。
- `npm run typecheck` と `npm test` が通る。
- 既存の action-bar / main-wiring テストは（後方互換フォールバックにより）壊れない。
