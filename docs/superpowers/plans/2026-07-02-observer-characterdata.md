# MutationObserver characterData 監視追加（issue #28）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リネーム等でタイトルテキストがその場（characterData）で書き換わったときも、注入済みチェックボックスのキー / aria-label / checked が現在の行 identity に追従するようにする。

**Architecture:** `src/content/main.ts` の一覧再スキャン observer の `observe` オプション（init 時・削除後 finally の再接続の2箇所）へ `characterData: true` を追加し、共有定数に集約する。あわせて `src/content/ui/row-checkbox.ts` にタイトル未充填行のスキップガードを追加し、空キー `title:` / `aria-label=""` の書き込みを防ぐ。churn 増は PR #27 導入済みの「キー変化時のみ属性書き込み」ガードが吸収する。

**Tech Stack:** TypeScript (strict) / Vite / Vitest (jsdom) / Chrome 拡張 Manifest V3 content script

**Spec:** `docs/superpowers/specs/2026-07-02-observer-characterdata-design.md`

## Global Constraints

- コードコメントは日本語（プロジェクト規約）。
- `npm run typecheck` は strict / noUnusedLocals / noUnusedParameters でエラーゼロであること。
- ロジックは DI / `root: ParentNode` 引数パターンを維持し、jsdom テスト可能に保つ。
- `start()` の bootstrapObserver（`.all-projects-container` 出現待ち）は変更しない。
- 注入 DOM の `data-nlk` / `CHECKBOX_ATTR` 規約を維持する。
- SelectionStore の prune は行わない（既知の title 識別トレードオフ。挙動を変えない）。

---

### Task 1: row-checkbox.ts の空タイトルガード

**Files:**
- Modify: `src/content/ui/row-checkbox.ts`（`injectRowCheckboxes` のループ先頭にガード追加）
- Test: `tests/row-checkbox.test.ts`（describe `injectRowCheckboxes` 内にテスト2件追加）

**Interfaces:**
- Consumes: `getRowIdentity(row): { title: string }`（`src/content/selectors.ts`）、`makeTarget(id): NotebookTarget`（`src/types.ts`）
- Produces: `injectRowCheckboxes(store, root)` の挙動変更のみ（シグネチャ不変）。タイトルが空文字の行は注入・同期ともにスキップされる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/row-checkbox.test.ts` の describe `injectRowCheckboxes` 末尾（`keeps display and store count consistent across a shift (S2)` テストの後）に追加:

```ts
  // issue #28 補足: 行挿入とタイトル span 充填の間に observer が発火すると
  // identity が空文字になり、空キー `title:` / aria-label="" が書き込まれてしまう。
  // タイトル未充填の行は注入自体をスキップする（充填時の mutation で再発火して注入される）。
  it('does not inject a checkbox into a row whose title is still empty (issue #28)', () => {
    const store = new SelectionStore()
    document.body.innerHTML = `
    <project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title"></span></td></tr>
    </tbody></table></project-table>`
    injectRowCheckboxes(store)
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(0)

    // タイトル充填後の再実行（observer 再発火のシミュレート）で通常どおり注入される
    document.querySelector('span.project-table-title')!.textContent = 'A'
    injectRowCheckboxes(store)
    const box = document.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A')
    expect(box.getAttribute('aria-label')).toBe('A')
  })

  // issue #28 補足: 既存チェックボックスのある行のタイトルが一時的に空になっても、
  // 空キー `title:` / aria-label="" で上書きしない（同期もスキップ）。
  it('does not stamp an empty key onto an existing checkbox while the title is transiently empty (issue #28)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))

    row.querySelector('span.project-table-title')!.textContent = ''
    injectRowCheckboxes(store)
    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A')
    expect(box.getAttribute('aria-label')).toBe('A')
    expect(box.checked).toBe(true)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: 上記2件が FAIL（1件目は length 1 !== 0、2件目は `title:` / `""` が書き込まれる）。既存テストは PASS のまま。

- [ ] **Step 3: 最小実装を書く**

`src/content/ui/row-checkbox.ts` の `injectRowCheckboxes` のループ先頭を変更する。現在:

```ts
  for (const row of getNotebookRows(root)) {
    const target = makeTarget(getRowIdentity(row))
```

を次に変更:

```ts
  for (const row of getNotebookRows(root)) {
    const identity = getRowIdentity(row)
    // 行挿入直後でタイトル span が未充填の行はスキップする。空キー `title:` /
    // aria-label="" を書き込まないため（issue #28 補足）。スキップしても、
    // タイトル充填時の characterData / childList 変化で observer が再発火し、
    // そこで注入・同期される。
    if (!identity.title) continue
    const target = makeTarget(identity)
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: 全件 PASS。

- [ ] **Step 5: コミット**

```bash
git add src/content/ui/row-checkbox.ts tests/row-checkbox.test.ts
git commit -m "fix: タイトル未充填行への空キー書き込みを防ぐガードを追加（issue #28 補足）"
```

---

### Task 2: main.ts の observer に characterData 監視を追加

**Files:**
- Modify: `src/content/main.ts`（observe オプションを共有定数化し `characterData: true` を追加。対象は `init()` 内の2箇所のみ）
- Test: `tests/main-wiring.test.ts`（テスト2件追加）

**Interfaces:**
- Consumes: Task 1 のガード（空タイトル行スキップ）。`injectRowCheckboxes(store, root)`、`CHECKBOX_ATTR`（`'data-nlk-checkbox'`）。
- Produces: `init()` の observer が characterData 変化でも `injectRowCheckboxes` を再実行する。公開 API の変更なし。

- [ ] **Step 1: 失敗するテストを書く**

`tests/main-wiring.test.ts` の末尾（describe `runDelete error recovery` の閉じ括弧の後）に追加:

```ts
// issue #28: Angular のインターポレーション更新（{{title}}）は既存テキストノードの
// nodeValue を書き換えるだけで childList レコードを出さない。characterData を
// 監視しないと、リネームフロー（メニュー/ダイアログは監視対象コンテナ外の
// .cdk-overlay-container に出る）でチェックボックスのキー / aria-label / checked が
// stale なまま残る。
describe('observer characterData tracking (issue #28)', () => {
  beforeEach(() => {
    vi.mocked(deleteNotebooks).mockReset()
  })

  it('re-syncs checkbox key / aria-label / checked when a title text node is rewritten in place', async () => {
    // Detached root: 同ファイル内の他テストと同じ理由（古い MutationObserver との競合回避）。
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)

    const row = root.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))

    // リネームをシミュレート: 既存テキストノードの nodeValue のみを書き換える
    // （span.textContent への代入はテキストノード置換＝ childList レコードに
    // なってしまうため、ここでは使わない）。
    const textNode = row.querySelector('span.project-table-title')!.firstChild as Text
    textNode.nodeValue = 'A-renamed'
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A-renamed')
    expect(box.getAttribute('aria-label')).toBe('A-renamed')
    // 新タイトルのキーは未選択のため checked も追従して外れる
    // （旧キー title:A はストアに残留する。既知の title 識別トレードオフ）。
    expect(box.checked).toBe(false)

    dispose()
  })

  it('re-observes with characterData after a delete completes (finally path)', async () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: ['title:A'], failed: [], aborted: false })

    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)
    const observeCallsAfterInit = observeSpy.mock.calls.length

    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 削除完了後の finally で1回だけ再接続され、init 時と同じオプション
    // （characterData 込み）で observe されること。
    expect(observeSpy.mock.calls.length).toBe(observeCallsAfterInit + 1)
    const [, options] = observeSpy.mock.calls.at(-1)!
    expect(options).toMatchObject({ childList: true, subtree: true, characterData: true })

    dispose()
    observeSpy.mockRestore()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: 追加した2件が FAIL（1件目: characterData 非監視のため `title:A` のまま。2件目: options に `characterData` が無い）。既存テストは PASS のまま。

- [ ] **Step 3: 最小実装を書く**

`src/content/main.ts` に共有定数を追加し、`init()` 内の2箇所の `observe` 呼び出しを差し替える。

`export const VERSION = '0.1.0'` の直後に追加:

```ts
// 一覧再スキャン observer の監視オプション（init 時と削除完了後 finally の
// 再接続で共用。2箇所のオプションが乖離しないよう1箇所に集約する）。
// characterData は Angular のインターポレーション更新（{{title}} は既存テキスト
// ノードの nodeValue を書き換えるだけで childList レコードを出さない）に
// リネームフロー等で追従するため（issue #28）。churn 増は row-checkbox.ts の
// 「キー変化時のみ属性書き込み」ガード（PR #27）が吸収する。
const LIST_OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}
```

`init()` 内の初期接続（現在 `observer.observe(container, { childList: true, subtree: true })`）を:

```ts
  observer.observe(container, LIST_OBSERVE_OPTIONS)
```

`runDelete` の finally 内（現在 `observer.observe(container, { childList: true, subtree: true })`）を:

```ts
          observer.observe(container, LIST_OBSERVE_OPTIONS)
```

`start()` の bootstrapObserver（`{ childList: true, subtree: true }`）は**変更しない**。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: 全件 PASS。

- [ ] **Step 5: 全テスト・typecheck を確認してコミット**

Run: `npm test && npm run typecheck`
Expected: 全件 PASS / エラーゼロ。

```bash
git add src/content/main.ts tests/main-wiring.test.ts
git commit -m "fix: 一覧再スキャン observer に characterData 監視を追加（issue #28）"
```

---

### Task 3: e2e チェックリストへの手動確認項目追加と最終検証

**Files:**
- Modify: `docs/e2e-checklist-phase1.md`（「表示・注入」セクションに1項目追加）

**Interfaces:**
- Consumes: Task 1 / Task 2 の挙動（リネーム追従）。
- Produces: 実機確認項目（issue #28 の「発火条件は実機 DOM / e2e チェックリストで確認する」に対応）。

- [ ] **Step 1: チェックリスト項目を追加する**

`docs/e2e-checklist-phase1.md` の「## 表示・注入」セクション末尾（「一覧を再読込/フィルタ切替しても、チェックボックスが二重注入されない。」の行の後）に追加:

```markdown
- [ ] ノートブックをリネームすると、その行のチェックボックスの `aria-label` と選択キー（`data-nlk-checkbox` 属性）が新タイトルに追従する（リネームは監視対象コンテナ内ではタイトルテキストのみの characterData 変化になり得るため、issue #28 の発火条件の実機確認を兼ねる）。リネーム前に付けていたチェックは外れる（旧タイトルのキーは選択件数に残留し得る。「すべて解除」で復旧。既知の title 識別トレードオフ）。
```

- [ ] **Step 2: 最終検証（全テスト・typecheck・build）**

Run: `npm test && npm run typecheck && npm run build`
Expected: テスト全件 PASS / typecheck エラーゼロ / build 成功（`dist/` 生成）。

- [ ] **Step 3: コミット**

```bash
git add docs/e2e-checklist-phase1.md
git commit -m "docs: リネーム追従の実機確認項目を e2e チェックリストへ追加（issue #28）"
```
