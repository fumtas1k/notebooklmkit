# チェックボックス当たり判定拡大 設計

日付: 2026-07-02
ステータス: 承認済み

## 背景 / 問題

ノートブック一覧の行に注入しているチェックボックス（`src/content/ui/row-checkbox.ts`）は、素の `<input type="checkbox">`（約13px）に対してチェックボックス自身の `click` だけ `stopPropagation()` している。そのためチェックボックスの数ピクセル外側をクリックすると行クリックに素通しになり、意図せずノートブックが開いてしまう。

## 決定事項

チェックボックスを `<label>` で包み、label の padding で透明な当たり判定を広げる。チェックボックス自体も約18pxにやや拡大する（ユーザー選択: 「余白拡大＋やや大きく」）。

### 検討した代替案

- **input 自体に padding** — ネイティブチェックボックスは `appearance` を殺さないと padding が効かない。不採用。
- **`transform: scale()`** — 当たり判定は広がるがレイアウト計算とズレ、描画がぼやける。不採用。

## 設計

変更ファイルは `src/content/ui/row-checkbox.ts` と `src/content/ui/row-checkbox.css`（＋ `tests/row-checkbox.test.ts`）。

1. `<label data-nlk="checkbox-hit">` を作り、その中に既存の `<input type="checkbox">` を入れてタイトルセル先頭に挿入する。
2. **label 側**に `click` の `stopPropagation()` を付ける（行クリック＝ノートブック遷移への伝播を遮断）。label 内どこをクリックしてもブラウザ標準動作でチェックボックスがトグルするため、追加のトグルロジックは不要。
3. スタイルは co-located CSS（`row-checkbox.css`。`action-bar.css` と同じ規約で `row-checkbox.ts` から import）に data 属性セレクタで記述する:
   - `label[data-nlk="checkbox-hit"]`: `padding: 8px` / `cursor: pointer` / `display: inline-block` / `vertical-align: middle` / `margin-left: -8px` / `margin-right: 4px`（`margin-left: -8px` は左 padding 分を打ち消し、チェックボックスの左端位置を旧実装相当に保ちつつ左側の当たり判定は維持する。padding 8px + margin-right 4px で現行の 12px 相当の間隔を維持）
   - `input[data-nlk-checkbox]`（属性値は行ごとに異なるため存在セレクタ）: `width: 18px` / `height: 18px` / `display: block`（`cursor: pointer` は親 label から継承されるため指定しない）
4. `CHECKBOX_ATTR` は引き続き **input に付ける**（冪等チェック・store 同期・テストのフックの意味を変えない）。`change` → `store.set(...)` も現状のまま。

### エッジケース

label 経由のクリックでは click イベントが label → input の順で発生するが、`stopPropagation` は行への伝播だけを止め、input の既定トグルと `change` 発火には影響しない。

## テスト

`tests/row-checkbox.test.ts` に追加:

1. label の余白部分（label 自体）をクリックしても行側のリスナーへ伝播しないこと。
2. label クリックでチェック状態と store がトグルすること。

既存テスト（冪等注入・`CHECKBOX_ATTR`・store 同期）は変更後も通ること。
