# 表示モード切替後にチェックボックスが再注入されない不具合の修正

- 日付: 2026-07-05
- 対象: ノートブック一覧（Phase 1 の複数選択 UI）
- 種別: bug fix

## 背景 / 症状

ノートブック一覧の右上には表示モード切替アイコン（グリッド＝カード表示 / リスト＝一覧表示）がある。
**カード表示から一覧表示に切り替えると、削除用チェックボックスが表示されない**。

## 実機調査（2026-07-05・Claude in Chrome で確認）

- 一覧（リスト）表示はテーブル構造 `project-table table.project-table tbody tr[mat-row]`（現行セレクタが対象とするもの）。**フレッシュに一覧表示でロードした場合はチェックボックスが正常に注入される**（338 行中、削除可能 333 行に注入）。
- カード表示は `project-button`（`span.project-button-title` / `project-action-button button.project-button-more`）構造で、現行のテーブル前提セレクタに一切マッチしない。→ カード表示ではフレッシュロードでもチェックボックス 0 個（**別課題。今回スコープ外**）。
- **決定的所見**: 一覧コンテナ `.all-projects-container` に印（`data-probe`）を付けてから表示モードを切り替えると、印の付いたノードは消え、新しい `.all-projects-container` ノードに**丸ごと置換**される（`containerSameNode: false`）。
- 一方、祖先 `welcome-page` / `.welcome-page-container` / `.app-body` は切替（list→card→list の往復）を通して**生存**し、いずれも単一インスタンス。
- アクションバー（拡張が注入する `[data-nlk="action-bar"]`）は `document.body` 直下にマウントされ、一覧ツリーの外なので切替の影響を受けず生存する。

## 根本原因

`init()`（`src/content/main.ts`）は再スキャン用 `MutationObserver` を **init 時点の `.all-projects-container` ノード**に対して `observe` する。
表示モード切替で NotebookLM がこのコンテナを新ノードに置換すると、observer は**古い detached ノードを監視し続け**、新コンテナ配下の行に対して発火しない。結果、チェックボックスが再注入されない。

補助的要因: `start()` のルーター（`apply` / `detectPage`）は pathname 不変・ページ種別不変（list→list）のため `init()` を再実行しない。よって observer 以外の再注入経路も無い。

## 修正方針: 安定祖先を監視する

再スキャン observer の監視対象を、切替を生き延びる安定祖先 **`welcome-page`**（一覧ページの Angular コンポーネント要素・単一インスタンス・`.all-projects-container` はその子孫）に変更する。

コンテナ置換は `welcome-page` 配下の childList mutation として observer に届くため、`injectRowCheckboxes` が再実行され、新テーブルの行にチェックボックスが再注入される。

### この方式の利点

- `init()` を再実行しないため、`SelectionStore`（選択状態）と body 直下のアクションバーがそのまま維持される。ちらつき・選択消失が無い。切替後は既存 store に基づき checked 状態も復元される。
- アクションバーは `welcome-page` の subtree 外（`document.body` 直下）なので、`setProgress` のテキスト更新で無駄な再スキャンは走らない（現行の「監視対象を絞る」意図を維持）。
- `injectRowCheckboxes` は冪等で、属性書き込みはキー変化時のみのガード付き。mutation ごとの再実行は O(行数) で有界。

### 却下した代替案

- **ルーターでコンテナ置換を検知して `init()` を再実行**: アクションバーの再構築でちらつきが出て、`SelectionStore` がリセットされ選択状態が失われる。劣る。

## 変更内容

### `src/content/selectors.ts`

- `SELECTORS.listRoot = 'welcome-page'` を追加（一覧ページの安定ルート。表示モード切替で置換される `.all-projects-container` の生存する祖先）。
- `getListObserveTarget(root: ParentNode = document): HTMLElement | null` を追加（`welcome-page` を返す。無ければ null）。

### `src/content/main.ts`

- observer の監視対象決定を「`getListObserveTarget(root)` → 無ければ `.all-projects-container` → 無ければ body/root」の優先順に変更する。フォールバックにより、`welcome-page` が無いテスト環境や将来の DOM 変化でも従来同等に動く。
- 削除完了後 `finally` の observer 再接続は同じ `container` 変数を使うため自動追従。
- 監視対象を安定祖先に変える理由（コンテナ置換で detached になる問題）をコメントに記録。
- `detectPage` は `.all-projects-container` の有無でページ種別を判定するまま（変更しない）。

## テスト（TDD）

`tests/main-wiring.test.ts` に追加:

1. **表示切替後の再注入**: `<welcome-page><div class="all-projects-container">…行A,B…</div></welcome-page>` を detached root に構築 → `init(root)` で初期注入を確認 → `.all-projects-container` を別の行（C,D）を含む新ノードに丸ごと置換 → `await Promise.resolve()` で microtask を flush → 新行 C,D にチェックボックスが注入されることを assert。
2. **選択状態の維持**: 切替前に行 A を選択 → 同名の行 A を含む新コンテナに置換 → 再注入後に A の checked が復元されることを確認。
3. 既存テスト（`welcome-page` を含まない `LIST` フィクスチャ）はフォールバックにより従来通り通過することを確認。

MutationObserver コールバックは microtask としてキューされるため、既存テスト同様 `await Promise.resolve()` で flush する。

## スコープ外（別 issue 化）

- **カード表示（`project-button`）でのチェックボックス対応**: カード表示は現行セレクタに一切マッチせず未対応。GitHub issue（enhancement / priority: medium）として起票する。

## 実機 E2E 確認

`npm run build` → `dist/` を読み込み、一覧ページで:

1. 一覧（リスト）表示 → チェックボックスが出ることを確認。
2. カード表示に切替 → 一覧表示に戻す → **チェックボックスが復活する**ことを確認（本修正の主眼）。
3. 切替前に数件選択 → 往復 → 選択状態が維持されることを確認。
4. 一括削除が切替後も正常に動くことを確認。
