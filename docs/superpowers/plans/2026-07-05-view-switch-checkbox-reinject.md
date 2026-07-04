# 表示モード切替後のチェックボックス再注入 修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧のカード表示⇄一覧表示を切り替えたあとも削除用チェックボックスが再注入されるようにする。

**Architecture:** 再スキャン用 `MutationObserver` の監視対象を、表示モード切替で置換される `.all-projects-container` から、切替を生き延びる安定祖先 `welcome-page` に変更する。コンテナ置換が `welcome-page` 配下の childList mutation として届き、既存の `injectRowCheckboxes`（冪等）が再実行される。`init()` は再実行しないので `SelectionStore`・アクションバーはそのまま維持される。

**Tech Stack:** TypeScript（strict）, Vite, Vitest（jsdom）, Chrome Manifest V3 content script。

## Global Constraints

- セレクタは `src/content/selectors.ts` の `SELECTORS` に集約する（UI 変更時の単一修正点）。安定クラス `mdc-*` / `mat-*` と Angular コンポーネントタグ（`project-table` 等）のみに依存し、`ng-tns-*` / `_ngcontent-*` には依存しない。
- ロジックモジュールは DI ＋ `root: ParentNode = document` 引数でテスト可能に保つ（jsdom フラグメントを渡せる）。
- 注入 DOM には `data-nlk` 属性を付ける。
- 静的ゲートは `npm run typecheck`（strict / 未使用ローカル・引数エラー）。Linter/フォーマッタは無し。
- 権限最小化・外部送信ゼロ・日英 i18n を維持（本修正では新規権限・ネットワーク・文言を追加しない）。

---

### Task 1: observer の監視対象を安定祖先 `welcome-page` に変更する

**Files:**
- Modify: `src/content/selectors.ts`（`SELECTORS` に `listRoot` 追加、`getListObserveTarget` 追加）
- Modify: `src/content/main.ts:91-98`（observer 監視対象の決定ロジック）
- Test: `tests/main-wiring.test.ts`（表示切替後の再注入テストを追加）
- Test: `tests/selectors.test.ts`（`getListObserveTarget` の単体テストを追加）

**Interfaces:**
- Produces: `SELECTORS.listRoot: 'welcome-page'`（`as const`）
- Produces: `getListObserveTarget(root: ParentNode = document): HTMLElement | null` — `root` 内の `welcome-page` 要素を返す。無ければ `null`。
- Consumes（main.ts 側）: 既存の `injectRowCheckboxes(store, root)`（冪等・キー変化ガード付き）、`LIST_OBSERVE_OPTIONS`。

---

- [ ] **Step 1: 表示切替後の再注入テストを書く（失敗させる）**

`tests/main-wiring.test.ts` の `describe('init', …)` ブロックの直後（`describe('start …')` の前）に、以下の describe を追加する。

```ts
// 表示モード切替（カード⇄一覧）で NotebookLM は .all-projects-container を
// 新ノードに丸ごと置換する。observer を安定祖先 welcome-page に張ることで、
// 置換後の新テーブルにもチェックボックスが再注入されることを検証する。
describe('init re-injects after view-mode switch (container swap)', () => {
  const WRAPPED = (rows: string) => `
  <welcome-page><div class="welcome-page-container"><div class="all-projects-container">
    <project-table><table class="project-table"><tbody>${rows}</tbody></table></project-table>
  </div></div></welcome-page>`

  const ROW = (title: string) => `
    <tr mat-row role="row"><td class="title-column"><span class="project-table-title">${title}</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>`

  it('re-injects checkboxes into a freshly swapped .all-projects-container', async () => {
    const root = document.createElement('div')
    root.innerHTML = WRAPPED(ROW('A') + ROW('B'))
    const dispose = init(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)

    // 表示モード切替を模倣: .all-projects-container を別行を含む新ノードで置換する。
    const wpc = root.querySelector('.welcome-page-container')!
    wpc.querySelector('.all-projects-container')!.remove()
    const fresh = document.createElement('div')
    fresh.innerHTML = `<div class="all-projects-container"><project-table><table class="project-table"><tbody>${ROW('C') + ROW('D')}</tbody></table></project-table></div>`
    wpc.appendChild(fresh.firstElementChild!)

    // MutationObserver コールバックは microtask としてキューされる。
    await Promise.resolve()
    await Promise.resolve()

    const boxes = root.querySelectorAll(`[${CHECKBOX_ATTR}]`)
    expect(boxes.length).toBe(2)
    const titles = [...boxes].map((b) => b.getAttribute('aria-label')).sort()
    expect(titles).toEqual(['C', 'D'])
    dispose()
  })

  it('restores checked state from the selection store after the swap', async () => {
    const root = document.createElement('div')
    root.innerHTML = WRAPPED(ROW('A') + ROW('B'))
    const dispose = init(root)
    // A を選択（注入済みチェックボックスを change 発火でトグル）。
    const boxA = [...root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)]
      .find((b) => b.getAttribute('aria-label') === 'A')!
    boxA.checked = true
    boxA.dispatchEvent(new Event('change'))

    // 同名 A を含む新コンテナへ置換。
    const wpc = root.querySelector('.welcome-page-container')!
    wpc.querySelector('.all-projects-container')!.remove()
    const fresh = document.createElement('div')
    fresh.innerHTML = `<div class="all-projects-container"><project-table><table class="project-table"><tbody>${ROW('A') + ROW('C')}</tbody></table></project-table></div>`
    wpc.appendChild(fresh.firstElementChild!)
    await Promise.resolve()
    await Promise.resolve()

    const newBoxA = [...root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)]
      .find((b) => b.getAttribute('aria-label') === 'A')!
    expect(newBoxA.checked).toBe(true)
    dispose()
  })
})
```

- [ ] **Step 2: `getListObserveTarget` の単体テストを書く（失敗させる）**

`tests/selectors.test.ts` の末尾（最後の `})` の前ではなく、ファイル最下部の適切な `describe` として）に追加する。まずファイル冒頭の import に `getListObserveTarget` を加える（既存の import 文へ追記）。

```ts
describe('getListObserveTarget', () => {
  it('returns the welcome-page element when present', () => {
    const root = document.createElement('div')
    root.innerHTML = '<welcome-page><div class="all-projects-container"></div></welcome-page>'
    expect(getListObserveTarget(root)?.tagName.toLowerCase()).toBe('welcome-page')
  })
  it('returns null when there is no welcome-page', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="all-projects-container"></div>'
    expect(getListObserveTarget(root)).toBeNull()
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run tests/main-wiring.test.ts tests/selectors.test.ts`
Expected: FAIL — `getListObserveTarget` が未定義（selectors.test.ts の import エラー）、および main-wiring の再注入テストで置換後の件数が 0 のまま（`expect(...).toBe(2)` 失敗）。

- [ ] **Step 4: `selectors.ts` に `listRoot` と `getListObserveTarget` を追加する**

`SELECTORS` オブジェクトに `listRoot` を追加する（`confirmDialog` 等が並ぶ Phase 1 セレクタ群の末尾、`cancelButton` の次の行）:

```ts
  cancelButton: 'button.tertiary-button',
  // 一覧ページの安定ルート。表示モード切替（カード⇄一覧）で .all-projects-container は
  // 新ノードに置換されるが、この welcome-page は生存する（2026-07-05 実機確認・§8.5）。
  // 再スキャン observer をここに張ることで、置換後の新テーブルにも再注入できる。
  listRoot: 'welcome-page',
```

そのうえで、`getTitleCell` などの getter 群の近く（`getNotebookRows` の下あたり）に以下を追加する:

```ts
// 再スキャン observer を張る安定祖先（表示モード切替で置換される .all-projects-container の
// 生存する親）。見つからなければ null（呼び出し側がフォールバックする）。
export function getListObserveTarget(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.listRoot)
}
```

- [ ] **Step 5: `main.ts` の observer 監視対象を差し替える**

`src/content/main.ts` の import 文（`selectors` からの import）に `getListObserveTarget` を追加する。1〜7 行目の import リストに含める:

```ts
  getAudioGenerationCard, SOURCE_TEXT, isDeletableRow, getListObserveTarget,
```

`init()` 内の observer 監視対象決定（現在の 91-98 行）を、以下に置き換える:

```ts
  // 一覧が再描画されたらチェックボックスを注入し直す。
  // アクションバー/進捗表示は document.body 側にあるため、再スキャン対象は
  // 一覧ページのルートに絞り、setProgress 等のテキスト更新で無駄な再スキャンが
  // 走らないようにする。監視対象は安定祖先 welcome-page にする —— 表示モード切替
  // （カード⇄一覧）で NotebookLM は .all-projects-container を新ノードに丸ごと置換
  // するため、置換されるコンテナ自体を掴むと以後の再描画で observer が発火せず
  // チェックボックスが再注入されない（2026-07-05 実機確認）。welcome-page は切替を
  // 生き延びる。welcome-page が無い環境（テスト等）は .all-projects-container →
  // body/root にフォールバックする。
  const observer = new MutationObserver(() => injectRowCheckboxes(store, root))
  const observeTarget =
    getListObserveTarget(root) ??
    root.querySelector('.all-projects-container') ??
    (root instanceof Document ? root.body : (root as Element)) ??
    document.body
  const container = observeTarget
  observer.observe(container, LIST_OBSERVE_OPTIONS)
```

（`container` 変数名は削除完了後 `finally` の再接続 `observer.observe(container, …)` が参照するため維持する。）

- [ ] **Step 6: テストを実行して通過を確認する**

Run: `npx vitest run tests/main-wiring.test.ts tests/selectors.test.ts`
Expected: PASS（新規4テスト含む全通過）。

- [ ] **Step 7: 全テストと typecheck を実行する**

Run: `npm test && npm run typecheck`
Expected: 全テスト PASS、typecheck エラー無し。

- [ ] **Step 8: コミットする**

```bash
git add src/content/selectors.ts src/content/main.ts tests/main-wiring.test.ts tests/selectors.test.ts
git commit -m "fix: 表示モード切替後にチェックボックスを再注入する

observer の監視対象を、切替で置換される .all-projects-container から
生存する安定祖先 welcome-page に変更。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: カード表示未対応を issue 化する（コード変更なし）

**Files:** なし（GitHub issue 起票のみ）

- [ ] **Step 1: issue を作成する**

カード表示（`project-button` 構造）ではチェックボックスが一切注入されない（現行セレクタがテーブル前提）ことを enhancement として起票する。

```bash
gh issue create \
  --title "カード表示（グリッド）でも削除チェックボックスを注入する" \
  --label "enhancement,priority: medium" \
  --body "一覧ページのカード表示（project-button 構造: span.project-button-title / project-action-button button.project-button-more）は現行のテーブル前提セレクタに一切マッチせず、フレッシュロードでもチェックボックスが 0 個になる。一覧表示のみ対応の現状を、カード表示でも一括選択・削除できるよう拡張する。実 DOM 調査済み（2026-07-05 / docs/superpowers/specs/2026-07-05-view-switch-checkbox-reinject-design.md 参照）。"
```

ラベルが存在しない場合は先に作成する（`gh label create "priority: medium" --color FBCA04` 等）。

---

## Self-Review

**1. Spec coverage:**
- 根本原因（observer が置換コンテナを掴む）→ Task 1 Step 5 で監視対象を `welcome-page` に変更。✓
- `selectors.ts` に `listRoot` / `getListObserveTarget` 追加 → Task 1 Step 4。✓
- フォールバック（welcome-page 無し→.all-projects-container→body）→ Task 1 Step 5。✓
- テスト（再注入・選択状態維持・単体）→ Task 1 Step 1-2。✓
- 既存テスト（welcome-page 無し LIST）がフォールバックで通過 → Task 1 Step 7 の `npm test` で担保。✓
- `detectPage` 不変 → 変更対象に含めない（触らない）。✓
- カード表示 issue 化 → Task 2。✓
- 実機 E2E → spec に記載（手動確認手順）。計画では自動テストで担保し、E2E は spec 参照。✓

**2. Placeholder scan:** TBD/TODO/「適切に」等なし。全ステップに実コード・実コマンド・期待出力を記載。✓

**3. Type consistency:** `getListObserveTarget(root): HTMLElement | null` は Task 1 全体で一貫。`SELECTORS.listRoot` 参照も一致。`container` 変数名を維持し finally の再接続と整合。✓
