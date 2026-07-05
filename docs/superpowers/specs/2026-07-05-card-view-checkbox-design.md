# カード（グリッド）表示でのチェックボックス注入 設計

- 日付: 2026-07-05
- 対象: ノートブック一覧（Phase 1 の複数選択 UI）
- 種別: enhancement（issue #66）

## 背景 / 目的

一覧ページには表示モード切替（カード＝グリッド / 一覧＝リスト）がある。現行の複数選択 UI は
**テーブル前提のセレクタ**（`project-table table.project-table tbody tr[mat-row]`）のみに対応し、
カード表示（`project-button` 構造）ではチェックボックスが一切注入されず、一括選択・削除が使えない。
カード表示でも一覧表示と同様に一括選択・削除できるようにする。

## 実 DOM（2026-07-05 実機確認・requirements §8.8）

- **カード行**: `project-button.project-button > mat-card.project-button-card`
  - `a.primary-action-button`（role=link。カード全体のクリック遷移。**box とは兄弟**）
  - `div.project-button-box`
    - `div.project-button-box-icon`（絵文字アイコン）
    - `project-action-button > button.project-button-more`（aria-label「プロジェクトの操作メニュー」。**テーブルと共通**）
  - `div > span.project-button-title`（タイトル）
  - `div.project-button-subtitle`
- おすすめ/公開カードは publisher 情報を持ち **moreButton を持たない**（= `isDeletableRow` が false）。
- カード表示では `project-table` は 0 個、一覧表示では `project-button` は 0 個（**ページは常に一方のモード**）。
- 3点メニュー（moreButton）のセレクタはカード・テーブルで共通。

## 設計制約（他作業との衝突回避）

- **`main.ts` と `action-bar.ts` は変更しない。** 別セッションで進行中の issue #31（アクションバー件数を
  「選択×可視」に変更）が `action-bar.ts` / `main.ts` を触るため、本タスクはそれらに手を入れず、
  `selectors.ts` / `row-checkbox.ts` / `row-checkbox.css` とテストに閉じる。「すべて選択」は既に
  `getNotebookRows().filter(isDeletableRow)` 経由、observer は #67 で `welcome-page`（両モードを含む）に
  張られており、いずれも改修不要でカード行に波及する。

## 修正方針: セレクタをモード対応にする

既存の抽象（`getNotebookRows` / `getRowIdentity` / 注入ホスト取得 / `isDeletableRow`）を両モード対応に
拡張する。ページは常に一方のモードなので、行列挙は両セレクタの**和集合**（片方は空）で足りる。

### `src/content/selectors.ts`

- `SELECTORS` にカード用セレクタを追加:
  - `cardRow: 'project-button.project-button'`
  - `cardTitle: 'span.project-button-title'`
  - `cardCheckboxHost: 'div.project-button-box'`（注入ホスト）
- **`getNotebookRows`**: `SELECTORS.row`（テーブル行）と `SELECTORS.cardRow`（カード）の和集合を
  document order で返す。どちらか一方は必ず空。
- **`getRowIdentity`**: タイトルを `SELECTORS.title`（`span.project-table-title`）**または**
  `SELECTORS.cardTitle`（`span.project-button-title`）から取得（先に見つかった方。両立しない）。
- **`getCheckboxHost(row): { host: HTMLElement; before: Element | null } | null`** を新設し、
  `getTitleCell` を置き換える（呼び出しは row-checkbox.ts のみ）。モード別に返す:
  - テーブル行: `host = td.title-column`（無ければ最初の `td`）、`before = host.firstChild`（先頭に挿入）。
  - カード行: `host = div.project-button-box`、`before = project-action-button 要素`（3点メニューの直前＝左に挿入）。
  - どちらのホストも無ければ null（注入スキップ）。
- **`isDeletableRow` / `getMoreButton`**: セレクタ `project-action-button button.project-button-more` は
  両モード共通のため**変更しない**。おすすめカードは moreButton 無しで自動除外される。
- **`findRowByIdentity`**: `getNotebookRows` ＋ `getRowIdentity` 経由でモード非依存（変更不要）。

### `src/content/ui/row-checkbox.ts`

- `getTitleCell(row) ?? row.querySelector('td')` の箇所を `getCheckboxHost(row)` に置き換える。
  返り値の `host` に対し、返り値の `before`（null なら末尾）を使って
  `host.insertBefore(label, before)` する。既存のラベル＋チェックボックス生成・二重注入防止・
  identity 同期・おすすめ行の掃除ロジックはそのまま流用（モード非依存）。
- チェックボックスはカードでは `div.project-button-box` 内・`a.primary-action-button`（アンカー）の**外**に
  入るため、素のカードクリック遷移は起きない。既存の `label` の `click` stopPropagation も維持する
  （念のための二重防御）。

### `src/content/ui/row-checkbox.css`

- カード用スタイルを追加。`div.project-button-box` は既存レイアウト（アイコン左・アクション右）なので、
  注入ラベルが3点メニューの左に自然に並ぶよう配置を調整（`z-index` はカードの
  `a.primary-action-button` オーバーレイより前面。既存の moreButton が機能する stacking を踏襲）。
  既存のテーブル用当たり判定スタイル（`label[data-nlk="checkbox-hit"]`）と `data-nlk` セレクタで共存。

## 選択・削除の挙動

- **選択はモード跨ぎで維持**: 選択キーは title ベースで `SelectionStore` に保持。#67 で observer を
  `welcome-page`（両モードを含む安定祖先）に張ったため、モード切替で再注入され、カード⇄一覧で
  選択状態が引き継がれる（追加実装不要の副次効果）。
- **削除フローは deleter を無改造で再利用**: カードの3点メニューも
  `project-action-button button.project-button-more` → 同じ削除メニュー項目
  （`.cdk-overlay-container button.mat-mdc-menu-item.delete-button`）→ 同じ確認ダイアログ。
  deleter はモード非依存。**カードの削除フロー（メニュー項目・確認ダイアログ）が表と同一かは
  実装時に実機で確認**し、差異があれば §8.8 に追記する。
- 「すべて選択」/ `buildTargets` は `getNotebookRows().filter(isDeletableRow)` 経由で自動的にカード行を対象化。

## テスト

- **`tests/selectors.test.ts`**: カード DOM フラグメントで
  - `getNotebookRows` がカード `project-button` を列挙する / テーブルと混在しない（片方空）。
  - `getRowIdentity` が `span.project-button-title` からタイトルを取る。
  - `getCheckboxHost` がカードで `div.project-button-box` と `project-action-button` 直前の
    挿入位置を返す / テーブルで `td.title-column` と先頭挿入を返す / ホスト無しで null。
  - `isDeletableRow` がおすすめカード（moreButton 無し）で false。
- **`tests/row-checkbox.test.ts`**: カード行への注入で
  - `project-action-button` の直前（3点メニューの左）に1つだけ入る・冪等。
  - おすすめカード（moreButton 無し）には注入しない / 再利用で掃除する。
  - チェック操作が `SelectionStore` を更新・クリックがカード遷移に伝播しない。
- **`tests/main-wiring.test.ts`**: カード DOM で `init` → 注入される。`buildTargets` がカード選択に対応。
  （`main.ts` 本体は変更しないが、カード DOM を渡す結線テストは追加してよい。）

## スコープ外

- カード表示専用の視覚的な選択強調（選択カードの枠線ハイライト等）は含めない（YAGNI。まずは
  チェックボックスの機能提供のみ）。
- `action-bar.ts` の件数意味変更は #31 の担当（本タスクでは触らない）。

## 実機 E2E 確認

`npm run build` → `dist/` を読み込み、一覧ページのカード表示で:

1. カード表示でチェックボックスが3点メニューの左に出る / おすすめカードには出ない。
2. カードを数件選択 → アクションバー件数が増える → 一括削除が正常に動く（メニュー→削除→確認）。
3. カードで選択 → 一覧表示に切替 → 選択が維持される（逆方向も）。
4. チェックボックスのクリックでノートブックが開かない（遷移しない）。
