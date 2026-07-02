# runDelete 再入場ガード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/content/main.ts` の `runDelete` に再入場ガードを追加し、確認ダイアログ表示中の削除ボタン二度押しによる並走を防止する。

**Architecture:** `init()` クロージャ内に `let deleting = false` を追加し、`runDelete` を二重の try/finally 構造にする。外側の try/finally が `deleting` フラグ（confirm await の前に立てる）を管理し、内側の try/finally は既存の `setBusy` / observer 再接続をそのまま維持する。

**Tech Stack:** TypeScript（strict）、Vitest（jsdom）、Vite。

## Global Constraints

- 権限最小化: `host_permissions` は `notebooklm.google.com` のみ。外部ネットワーク送信ゼロ / トラッカー無し。
- 日英 i18n を維持。
- 静的チェックのゲートは `npm run typecheck`（strict、未使用ローカル変数 / 引数はエラー）。
- DI ＋純粋ロジックでテスト可能に。ロジックモジュールは `document` を直接触らず `root: ParentNode` 引数を取る。
- 注入する DOM には `data-nlk` 属性を付ける。

---

### Task 1: runDelete に再入場ガードを追加

**Files:**
- Modify: `src/content/main.ts:54-101`（`runDelete` 関数、および `init` クロージャ内の状態変数）
- Test: `tests/main-wiring.test.ts`（`runDelete` 系の describe に追加）

**Interfaces:**
- Consumes: 既存の `init(root)`、`confirmDeletion`、`deleteNotebooks`（`tests/main-wiring.test.ts` で `vi.mock` 済み）、`CHECKBOX_ATTR`、`SelectionStore`。
- Produces: 外部シグネチャの変更なし。`init` の戻り値・`runDelete` の呼び出し方は不変。ガードは内部状態（`deleting` フラグ）のみで実現する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/main-wiring.test.ts` の `describe('runDelete error recovery', ...)` の中（既存の 2 テストと同じ階層）に次のテストを追加する。既存テストと同じく detached root を使い、stale な MutationObserver との競合を避ける。

```ts
  it('ignores a re-entrant delete click while the confirm dialog is open', async () => {
    // deleteNotebooks は呼ばれない想定だが、呼ばれても発散しないよう解決させておく
    vi.mocked(deleteNotebooks).mockResolvedValue({
      succeeded: [],
      failed: [],
      aborted: false,
    })

    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')

    // 1 回目: 確認ダイアログが開く
    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)

    // 確認ダイアログ表示中（await confirmDeletion の最中）に 2 回目を押す
    deleteBtn!.click()

    // 再入場ガードにより 2 つ目の runDelete は無視され、ダイアログは 1 つのまま
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)
  })
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run -t "ignores a re-entrant delete click"`
Expected: FAIL（ガード未実装のため確認ダイアログが 2 つ生成され、`expect(...).toBe(1)` が `2` で落ちる）

- [ ] **Step 3: 再入場ガードを実装**

`src/content/main.ts` の `init` クロージャ内、`currentAbort` 宣言の近く（29 行目付近）に `deleting` フラグを追加する。

```ts
  let currentAbort: AbortController | null = null
  let deleting = false
```

`runDelete` 全体を、外側 try/finally（`deleting` 管理）で包む形に書き換える。内側の try/catch/finally（`setBusy` / observer 再接続）は既存のまま残す。置き換え後の `runDelete` は次の通り:

```ts
  async function runDelete(): Promise<void> {
    if (deleting) return
    deleting = true
    try {
      const targets = buildTargets(store, root)
      if (targets.length === 0) return
      const totalRows = getNotebookRows(root).length
      const isSelectAll = targets.length === totalRows
      const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
      if (!ok) return

      const ac = new AbortController()
      currentAbort = ac
      // 削除中は自分たちで行を書き換える（＝一覧を大量に mutate する）ため、
      // 再スキャン observer を止めて O(n^2) の無駄な再注入を避ける。
      observer.disconnect()
      bar.setBusy(true)
      try {
        const deps: DeleterDeps = {
          findRow: (tgt) => findRowByIdentity(tgt, root),
          getMoreButton,
          getDeleteMenuItem: () => getDeleteMenuItem(),
          getConfirmDialog: () => getConfirmDialog(),
          getConfirmDeleteButton,
          click: (el) => { safeClick(el) },
          waitFor,
        }
        const result = await deleteNotebooks(targets, deps, {
          signal: ac.signal,
          onProgress: (p) => bar.setProgress(t('progress', { done: p.completed, total: p.total })),
        })
        if (result.aborted) {
          const rest = targets.length - result.succeeded.length - result.failed.length
          bar.setProgress(t('abortedSummary', { ok: result.succeeded.length, rest }))
        } else {
          bar.setProgress(t('doneSummary', { ok: result.succeeded.length, ng: result.failed.length }))
        }
        // 成功分のみ選択解除
        for (const key of result.succeeded) store.set(key, false)
        syncCheckboxes(store, root)
      } catch {
        console.error('notebooklmkit: unexpected error during delete')
        bar.setProgress(t('domError'))
      } finally {
        bar.setBusy(false)
        currentAbort = null
        // 再スキャンを再開し、削除実行中に変化した行を一度だけ同期し直す。
        observer.observe(container, { childList: true, subtree: true })
        injectRowCheckboxes(store, root)
      }
    } finally {
      deleting = false
    }
  }
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: PASS（新規テストを含む全テスト）

- [ ] **Step 5: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: いずれも成功（strict 型チェック通過、全テスト green）

- [ ] **Step 6: Commit**

```bash
git add src/content/main.ts tests/main-wiring.test.ts
git commit -m "fix: runDelete に再入場ガードを追加 (#2)"
```

---

## Self-Review

**1. Spec coverage:**
- 再入場ガード（confirm await の前にフラグを立てる）→ Task 1 Step 3。
- 早期 return でもフラグをリセット → 外側 try/finally で担保（Task 1 Step 3）。
- テスト（確認ダイアログが 1 つだけ）→ Task 1 Step 1。
- スコープ外（削除ボタン disabled 化しない）→ 実装に含めない（遵守）。
- ギャップ無し。

**2. Placeholder scan:** プレースホルダ無し。全ステップに実コード / 実コマンドあり。

**3. Type consistency:** `deleting: boolean`、`confirmDeletion` の戻り値（`Promise<boolean>`）、`deleteNotebooks` の解決型（`{ succeeded, failed, aborted }`）は既存コード・既存テストと一致。外部シグネチャ変更なし。
