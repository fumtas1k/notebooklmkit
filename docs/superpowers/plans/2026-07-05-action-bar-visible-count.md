# アクションバー件数を「選択済み×可視」に一致させる Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アクションバーの件数表示を `store.size` から「選択済みかつ現在可視」（`buildTargets` 相当）に変更し、幽霊選択（残留キー）による表示ズレを解消する。

**Architecture:** `ui/action-bar.ts` に件数算出コールバック `count?: () => number` を DI で注入し、`main.ts` が `() => buildTargets(store, root).length` を渡す。UI モジュールは DOM セレクタに依存しない。一覧再描画 observer 経由で `bar.refresh()` を呼び、可視件数を再同期する。

**Tech Stack:** TypeScript（strict）、Vite、Vitest（jsdom）。Chrome 拡張 MV3 content script。

## Global Constraints

- `npm run typecheck`（strict、`noUnusedLocals`/`noUnusedParameters`）が通ること。未使用のローカル変数/引数はエラー。
- ロジックモジュールは `document` を直接触らない。協力オブジェクト注入または `root: ParentNode` 引数（既定 `document`）を取る。UI モジュール（`ui/action-bar.ts`）は `selectors.ts` に依存させない。
- 注入 DOM には `data-nlk` 属性を付ける。
- 外部ネットワーク送信ゼロ。権限最小化。日英 i18n を維持。
- 後方互換: `count` 未指定時は `store.size` にフォールバックし、既存テストを壊さない。

---

### Task 1: action-bar に件数算出コールバック（DI）と refresh を追加

**Files:**
- Modify: `src/content/ui/action-bar.ts`
- Test: `tests/action-bar.test.ts`

**Interfaces:**
- Consumes: `SelectionStore`（`.size`、`.onChange(cb)`）、`createT`
- Produces: `mountActionBar(opts: { store, t, handlers, root?, count?: () => number })` の戻り値に `refresh(): void` を追加。`count` 未指定時は `store.size` にフォールバック。件数表示（`bar-count`）・削除ボタンラベル（`bar-delete`）・N=0 無効化はすべて `count?.() ?? store.size` の値を使う。

- [ ] **Step 1: 失敗するテストを書く（count コールバックと refresh）**

`tests/action-bar.test.ts` の `describe('action bar', ...)` 内の末尾（最後の `it` の後、閉じ括弧の前）に追加:

```typescript
  it('uses the injected count callback instead of store.size', () => {
    const store = new SelectionStore()
    store.replaceAll(['a', 'b', 'c']) // store.size = 3
    let visible = 1
    mountActionBar({ store, t, handlers: noop, count: () => visible })
    // 件数表示・削除ボタンラベルは count() の値（1）を反映する（store.size=3 ではない）
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('1')
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).not.toContain('3')
    const del = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!
    expect(del.textContent).toContain('1')
    expect(del.disabled).toBe(false)
  })

  it('refresh() re-evaluates the count callback', () => {
    const store = new SelectionStore()
    store.replaceAll(['a', 'b'])
    let visible = 2
    const bar = mountActionBar({ store, t, handlers: noop, count: () => visible })
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('2')
    // 可視行が変化（例: リネームで幽霊化）→ store 変化なしに件数だけ再計算される
    visible = 0
    bar.refresh()
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('0')
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.disabled).toBe(true)
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/action-bar.test.ts -t "injected count callback"`
Expected: FAIL（`count` オプション未対応。件数が 3 のまま / `refresh` 未定義）。

- [ ] **Step 3: action-bar.ts に count と refresh を実装**

`src/content/ui/action-bar.ts` を以下のように変更する。

`mountActionBar` のシグネチャに `count?: () => number` を追加し、分割代入に加える:

```typescript
export function mountActionBar(opts: {
  store: SelectionStore
  t: ReturnType<typeof createT>
  handlers: ActionBarHandlers
  root?: HTMLElement
  count?: () => number
}) {
  const { store, t, handlers, root = document.body, count } = opts
```

`render` を `store.size` 引数ベースから、件数を都度算出する形に変更する。既存の
`const render = (size: number) => { ... }` ブロックと、その直後の
`const unsub = store.onChange(render)` / `render(store.size)` を、次で置き換える:

```typescript
  let busy = false
  const currentCount = () => count?.() ?? store.size
  const render = () => {
    const size = currentCount()
    count.textContent = t('selectedCount', { count: size })
    del.textContent = t('deleteSelected', { count: size })
    del.disabled = busy || size === 0
    del.hidden = busy
    stop.hidden = !busy
  }
  const unsub = store.onChange(() => render())
  render()
```

注意: 上記の `count.textContent` の `count` は span 要素（`data-nlk="bar-count"`）を指す
既存のローカル変数。オプションの件数コールバックとは別物。**命名衝突を避けるため、オプションの
コールバック変数名を `count` から `countFn` に変更する**。分割代入とシグネチャの両方を修正:

```typescript
  count?: () => number
}) {
  const { store, t, handlers, root = document.body, count: countFn } = opts
```

```typescript
  const currentCount = () => countFn?.() ?? store.size
```

戻り値に `refresh` を追加する。既存の `return { ... }` を次で置き換える:

```typescript
  return {
    setProgress(text: string | null) { progress.textContent = text ?? '' },
    setBusy(b: boolean) { busy = b; render() },
    refresh() { render() },
    destroy() { unsub(); bar.remove() },
  }
```

- [ ] **Step 4: 新規テストが通ることを確認**

Run: `npx vitest run tests/action-bar.test.ts`
Expected: PASS（新規2件＋既存4件すべて）。既存4件は `count` 未指定なので `store.size` フォールバックで従来どおり通る。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/content/ui/action-bar.ts tests/action-bar.test.ts
git commit -m "feat(#31): action-bar に件数算出コールバック(DI)と refresh を追加"
```

---

### Task 2: main.ts で可視件数を注入し observer で refresh する

**Files:**
- Modify: `src/content/main.ts:76-109`
- Test: `tests/main-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 の `mountActionBar({ ..., count })` と戻り値 `bar.refresh()`、既存の `buildTargets(store, root)`、`injectRowCheckboxes(store, root)`。テストは既存の `LIST` 定数（A/B の2行を持つ `.all-projects-container`。`tests/main-wiring.test.ts:12-18`）と `init()`（root 既定 = `document`。内部で `SelectionStore` を生成）を流用。
- Produces: `init(root)` 実行後、アクションバー件数が `buildTargets(store, root).length`（選択×可視）を反映。observer tick 経由でも更新される。

**設計メモ:** `init()` は `SelectionStore` を**内部生成**するため外部から幽霊キーを直接注入できない。
幽霊選択は「すべて選択（A,B）→ B の行を DOM から削除」で自然に作る（B のキーは store に残るが
一覧では不可視）。この1シナリオが「可視件数への切替」「幽霊選択の除外」「observer 経由の再同期」を
同時に検証する。既存 `onSelectAll` テスト（`tests/main-wiring.test.ts:49-`）と同じ `init()`＋
`bar-select-all` クリックのパターンを踏襲する。

- [ ] **Step 1: 失敗するテストを書く（幽霊選択が件数に出ない＋observer 更新）**

`tests/main-wiring.test.ts` の `describe('onSelectAll', ...)` ブロックの**閉じ括弧の後**に、
新しい describe を追加する（`LIST` 定数はファイル先頭で定義済み。そのまま参照できる）:

```typescript
describe('action bar count = visible selection (issue #31)', () => {
  beforeEach(() => { document.body.innerHTML = LIST })

  it('counts only visible selection and updates on list mutation (ghost excluded)', async () => {
    const dispose = init()
    // すべて選択（A, B）→ 件数2
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    const count = document.querySelector('[data-nlk="bar-count"]')!
    expect(count.textContent).toContain('2')

    // B の行を DOM から削除（NotebookLM 側削除／リネーム消失を模擬）。
    // 選択キー title:B は store に残る（幽霊選択）が、可視行は A のみ。
    const rows = document.querySelectorAll('tr[mat-row]')
    rows[1].remove()

    // 一覧再描画 observer（マイクロタスク）発火を待つ → bar.refresh() で再計算。
    await new Promise((r) => setTimeout(r, 0))

    // 件数は可視選択（A の1件）のみ。幽霊 title:B は数えない。
    expect(count.textContent).toContain('1')
    expect(count.textContent).not.toContain('2')
    // 削除ボタンのラベルも可視件数（1件）に統一されている。
    expect(document.querySelector('[data-nlk="bar-delete"]')!.textContent).toContain('1')
    dispose()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/main-wiring.test.ts -t "counts only visible selection"`
Expected: FAIL（`main.ts` がまだ `count` を渡していないため、B 削除後も件数が `store.size`=2 のまま）。

- [ ] **Step 3: main.ts で count を注入し observer で refresh する**

`src/content/main.ts` の `mountActionBar({ ... })` 呼び出し（`src/content/main.ts:76`）に
`count` を追加する。`store,` `t,` の並びに続けて:

```typescript
  const bar = mountActionBar({
    store,
    t,
    count: () => buildTargets(store, root).length,
    handlers: {
```

observer のコールバック（`src/content/main.ts:102`）を、`injectRowCheckboxes` 後に
`bar.refresh()` を呼ぶよう変更する。既存の
`const observer = new MutationObserver(() => injectRowCheckboxes(store, root))` を置き換える:

```typescript
  const observer = new MutationObserver(() => {
    injectRowCheckboxes(store, root)
    bar.refresh()
  })
```

`bar` は `mountActionBar` の戻り値で observer 定義より前に生成済みのため参照可能。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: PASS（新規＋既存すべて）。

- [ ] **Step 5: typecheck ＋ 全テスト**

Run: `npm run typecheck && npm test`
Expected: エラーなし、全テスト PASS。

- [ ] **Step 6: コミット**

```bash
git add src/content/main.ts tests/main-wiring.test.ts
git commit -m "feat(#31): アクションバー件数に可視選択(buildTargets)を注入し observer で再同期"
```

---

## Self-Review

**1. Spec coverage:**
- 「N 件選択中」「削除ボタンラベル」「N=0 無効化」を可視件数に統一 → Task 1（render が全件数を `currentCount()` で算出）✓
- `main.ts` で `count: () => buildTargets(store, root).length` を注入 → Task 2 ✓
- observer tick 経由の再同期 → Task 2（配線＋統合テストで検証）✓
- 後方互換フォールバック（`count` 未指定 → `store.size`）→ Task 1（`countFn?.() ?? store.size`、既存4テストで検証）✓
- prune しない（残留キー方針維持）→ 変更なし（`store` に触れない）✓
- テスト計画（action-bar 新規2件、main-wiring 幽霊選択＋observer 統合1件）→ Task 1/2 ✓

**2. Placeholder scan:** 具体的なテストコードとアサーションをすべて明記済み（Task 2 は既存 `LIST` 定数と
`init()` を流用し、幽霊選択を「select-all → 行削除」で作る。曖昧な `/* ... */` プレースホルダは排除済み）。

**3. Type consistency:**
- `mountActionBar` の新オプション名: `count`（外部 API）→ 内部で `countFn` に束縛（span 変数 `count` との衝突回避）。Task 1 で一貫。
- 戻り値 `refresh(): void` → Task 1 で定義、Task 2 で `bar.refresh()` として使用。一致 ✓
- `buildTargets(store, root)` の既存シグネチャを Task 2 で使用。一致 ✓
