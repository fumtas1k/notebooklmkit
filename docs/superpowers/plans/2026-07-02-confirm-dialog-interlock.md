# 確認ダイアログのフォーカストラップと confirm 後の targets 再検証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確認ダイアログ表示中の割り込み（Tab/Space で背後の選択を変更）によって古い `targets` スナップショットが削除される問題（issue #13）を、フォーカストラップと confirm 後の再検証の二層で塞ぐ。

**Architecture:** `confirm-dialog.ts` の既存 document キャプチャ keydown に Tab 処理を追加してフォーカスをダイアログ内に閉じ込める。`main.ts` の `runDelete` は confirm 通過後に `buildTargets` を再計算し、スナップショットとキー多重集合が一致しなければ削除せず中止する。スペック: `docs/superpowers/specs/2026-07-02-confirm-dialog-interlock-design.md`

**Tech Stack:** TypeScript (strict) / Vitest (jsdom)。新規依存なし。

## Global Constraints

- `npm run typecheck` は strict + `noUnusedLocals` / `noUnusedParameters`。未使用変数はエラーになる。
- ロジックは DOM 非依存 or `root` 引数で jsdom テスト可能にする（CLAUDE.md 規約）。
- 注入 DOM の識別は既存の `data-nlk` 属性を使う（新規注入要素は無し）。
- コードコメントは日本語（既存ファイルの流儀に合わせる）。
- テスト実行: `npx vitest run tests/<file>.test.ts`、全体は `npm test`。

---

### Task 1: 確認ダイアログのフォーカストラップ

**Files:**
- Modify: `src/content/confirm-dialog.ts:78-96`（`onKeydown` に Tab 処理を追加）
- Test: `tests/confirm-dialog.test.ts`（describe ブロックを末尾に追加）

**Interfaces:**
- Consumes: 既存の `confirmDeletion(opts)`（シグネチャ変更なし）
- Produces: 挙動のみ（ダイアログ表示中、Tab / Shift+Tab のフォーカス移動が `.nlk-dialog` 内の `button:not([disabled]), input` で循環する）

- [ ] **Step 1: 失敗するテストを書く**

`tests/confirm-dialog.test.ts` の末尾に追加:

```ts
describe('confirmDeletion (focus trap: Tab stays inside the dialog)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const tab = (shift = false) =>
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true,
    }))

  it('cycles Tab through cancel -> ok -> cancel in a normal dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    expect(document.activeElement).toBe(cancel) // 初期フォーカス
    tab(); expect(document.activeElement).toBe(ok)
    tab(); expect(document.activeElement).toBe(cancel) // 末尾から先頭へ循環
    cancel.click()
    expect(await p).toBe(false)
  })

  it('cycles Shift+Tab backwards (wraps from first to last)', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    tab(true); expect(document.activeElement).toBe(ok) // cancel（先頭）から逆方向 → 末尾へ
    tab(true); expect(document.activeElement).toBe(cancel)
    cancel.click()
    expect(await p).toBe(false)
  })

  it('skips the disabled confirm button in a strong dialog, includes it once input is valid', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    // DOM 順のフォーカス候補は input, cancel, ok（ok は disabled の間は候補外）
    expect(document.activeElement).toBe(input) // strong は input が初期フォーカス
    tab(); expect(document.activeElement).toBe(cancel)
    tab(); expect(document.activeElement).toBe(input) // ok は disabled → スキップして循環
    input.value = '12'
    input.dispatchEvent(new Event('input')) // ok が有効になる
    tab(); expect(document.activeElement).toBe(cancel)
    tab(); expect(document.activeElement).toBe(ok) // 有効化後は循環に含まれる
    cancel.click()
    expect(await p).toBe(false)
  })

  it('pulls focus back into the dialog when focus escaped outside', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    outside.focus() // フォーカスがダイアログ外へ逃げた状態を再現
    expect(document.activeElement).toBe(outside)
    tab()
    expect(document.activeElement)
      .toBe(document.querySelector('[data-nlk="confirm-cancel"]')) // 先頭へ引き戻す
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })

  it('stops Tab from bubbling past the dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const box = document.querySelector<HTMLElement>('.nlk-dialog')!
    let bodyHeard = false
    document.body.addEventListener('keydown', () => { bodyHeard = true })
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(bodyHeard).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/confirm-dialog.test.ts`
Expected: 追加した 5 テストが FAIL（Tab を横取りしていないため `document.activeElement` が動かない）。既存テストは PASS のまま。

- [ ] **Step 3: 最小実装**

`src/content/confirm-dialog.ts` の `onKeydown` に、`Escape` 処理と `Enter` 処理の間に Tab 処理を追加:

```ts
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        cleanup(false)
        return
      }
      if (ev.key === 'Tab') {
        // フォーカストラップ: aria-modal だけでは Tab は塞げないため、
        // ダイアログ内のフォーカス可能要素の間で手動循環させる。背後の
        // チェックボックス等へ到達して選択を変更されるのを防ぐ（issue #13）。
        ev.preventDefault()
        ev.stopPropagation()
        const els = Array.from(
          box.querySelectorAll<HTMLElement>('button:not([disabled]), input'),
        )
        if (els.length === 0) return
        const idx = els.indexOf(document.activeElement as HTMLElement)
        // idx === -1（フォーカスがダイアログ外）は先頭 / 末尾へ引き戻す
        const next = ev.shiftKey
          ? els[(idx <= 0 ? els.length : idx) - 1]
          : els[(idx + 1) % els.length]
        next.focus()
        return
      }
      if (ev.key === 'Enter') {
        // Swallow Enter unconditionally while the dialog is open, even when
        // the strong-confirm validation guard blocks the actual confirm, so
        // the keystroke never leaks through to NotebookLM's page behind the
        // modal.
        ev.preventDefault()
        ev.stopPropagation()
        if (strong && !isConfirmInputValid(input!.value, count)) return
        cleanup(true)
      }
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/confirm-dialog.test.ts`
Expected: 全テスト PASS。

- [ ] **Step 5: 全テスト + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全テスト PASS、typecheck エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/content/confirm-dialog.ts tests/confirm-dialog.test.ts
git commit -m "feat: 確認ダイアログにフォーカストラップを追加 (#13)"
```

---

### Task 2: `sameTargetKeys` 純関数と i18n キーの追加

**Files:**
- Modify: `src/content/main.ts`（export 関数を追加。`buildTargets` の直後あたり）
- Modify: `src/content/i18n.ts`（`EN` と `ja` に `selectionChanged` を追加）
- Test: `tests/main-wiring.test.ts`（describe ブロックを追加）

**Interfaces:**
- Consumes: `NotebookTarget`（`src/types.ts`: `{ title: string; key: string }`）、`makeTarget({ title })`
- Produces: `export function sameTargetKeys(a: NotebookTarget[], b: NotebookTarget[]): boolean`（`main.ts` から export。Task 3 が `runDelete` 内で使う）、i18n キー `selectionChanged`（Task 3 が `t('selectionChanged')` で使う）

- [ ] **Step 1: 失敗するテストを書く**

`tests/main-wiring.test.ts` — import に `sameTargetKeys` と `makeTarget` を追加:

```ts
import { init, start, buildTargets, sameTargetKeys } from '../src/content/main'
import { makeTarget } from '../src/types'
```

`buildTargets` の describe の後に追加:

```ts
describe('sameTargetKeys', () => {
  const tgt = (title: string) => makeTarget({ title })

  it('returns true for the same key set regardless of order', () => {
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('B'), tgt('A')])).toBe(true)
  })
  it('returns false when lengths differ', () => {
    expect(sameTargetKeys([tgt('A')], [tgt('A'), tgt('B')])).toBe(false)
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A')])).toBe(false)
  })
  it('returns false when contents differ', () => {
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A'), tgt('C')])).toBe(false)
  })
  it('compares duplicate keys as a multiset (same-title edge case)', () => {
    // 同名タイトルはキーが重複する（docs/requirements.md §8.5 の既知エッジケース）。
    // 単純な Set 比較だと [A,A] と [A,B] を区別できないため多重集合で比較する。
    expect(sameTargetKeys([tgt('A'), tgt('A')], [tgt('A'), tgt('A')])).toBe(true)
    expect(sameTargetKeys([tgt('A'), tgt('A')], [tgt('A'), tgt('B')])).toBe(false)
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A'), tgt('A')])).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: FAIL（`sameTargetKeys` が export されていないため import エラー、または undefined 呼び出し）。

- [ ] **Step 3: 最小実装**

`src/content/main.ts` の `buildTargets` の直後に追加:

```ts
// confirm 表示中に選択・一覧が変化していないかの検証に使う（issue #13）。
// キーはタイトル由来で重複し得る（同名ノートブック）ため、多重集合として比較する。
// 順序は比較しない（削除順が変わるだけで対象集合は同じ）。
export function sameTargetKeys(a: NotebookTarget[], b: NotebookTarget[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const t of a) counts.set(t.key, (counts.get(t.key) ?? 0) + 1)
  for (const t of b) {
    const n = counts.get(t.key)
    if (!n) return false
    counts.set(t.key, n - 1)
  }
  return true
}
```

`src/content/i18n.ts` — `EN` の `domError` の後に追加:

```ts
  selectionChanged: 'Cancelled: the selection changed while the confirmation dialog was open',
```

`ja` の `domError` の後に追加:

```ts
    selectionChanged: '確認ダイアログ表示中に選択が変更されたため中止しました',
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main-wiring.test.ts && npx vitest run tests/i18n.test.ts`
Expected: 全テスト PASS（`MsgKey` は `EN` から導出され、`MESSAGES` の型が ja 側の同キー定義を強制するため typecheck でも守られる）。

- [ ] **Step 5: 全テスト + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全テスト PASS、typecheck エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/content/main.ts src/content/i18n.ts tests/main-wiring.test.ts
git commit -m "feat: targets 比較の sameTargetKeys と selectionChanged 文言を追加 (#13)"
```

---

### Task 3: `runDelete` へ confirm 後の再検証を配線

**Files:**
- Modify: `src/content/main.ts:63-64`（`runDelete` 内、`confirmDeletion` の直後）
- Test: `tests/main-wiring.test.ts`（`runDelete error recovery` の describe 内に追加）

**Interfaces:**
- Consumes: Task 2 の `sameTargetKeys(a, b)` と i18n キー `selectionChanged`、既存の `buildTargets(store, root)` / `bar.setProgress(text)`
- Produces: 挙動のみ（confirm 中に選択が変わった場合、削除せず progress に中止メッセージを表示）

- [ ] **Step 1: 失敗するテストを書く**

`tests/main-wiring.test.ts` の `describe('runDelete error recovery', ...)` 内の末尾に追加:

```ts
  it('aborts without deleting when the selection changed while the confirm dialog was open', async () => {
    // Detached root: 同 describe 内の他テストと同じ理由（古い MutationObserver との競合回避）。
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const boxes = root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(boxes.length).toBe(2)
    boxes[0].checked = true
    boxes[0].dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()

    // 確認ダイアログ表示中に背後の選択を変更する（issue #13 の割り込み経路を再現）
    boxes[1].checked = true
    boxes[1].dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 古いスナップショットのまま削除に進んではならない
    expect(deleteNotebooks).not.toHaveBeenCalled()
    const progress = document.querySelector('[data-nlk="bar-progress"]')
    expect(progress!.textContent).toMatch(/選択が変更された|selection changed/)

    // 中止後は deleting フラグが解除され、再度削除を開始できる
    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
```

補足: 「選択を変えなければ削除に進む」側は、同 describe 内の既存テスト（abortedSummary / error recovery — confirm-ok クリック後に `deleteNotebooks` が呼ばれる）が引き続き回帰を検出する。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: 追加テストが FAIL（再検証が無いため `deleteNotebooks` が呼ばれてしまう。beforeEach の `mockReset` により resolve せず progress も一致しない）。既存テストは PASS のまま。

- [ ] **Step 3: 最小実装**

`src/content/main.ts` の `runDelete` 内、`if (!ok) return` の直後に追加:

```ts
      const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
      if (!ok) return
      // confirm 表示中に選択・一覧が変化していれば中止する（issue #13）。
      // 削除は取り消し不可のため、古いスナップショットのまま進めない。
      // フォーカストラップ（confirm-dialog.ts）が主経路を塞ぎ、これは最終安全網。
      const recheck = buildTargets(store, root)
      if (!sameTargetKeys(targets, recheck)) {
        bar.setProgress(t('selectionChanged'))
        return
      }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: 全テスト PASS。

- [ ] **Step 5: 全テスト + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全テスト PASS、typecheck エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/content/main.ts tests/main-wiring.test.ts
git commit -m "fix: confirm 後に targets を再検証し選択変更時は削除を中止 (#13)"
```
