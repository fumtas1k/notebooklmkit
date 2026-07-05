# タブ一括インポートの UX 改善 + バッチ投入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** インポートパネルのタブ一覧を見やすくし（件数ヘッダー＋スクロール改善）、全選択/全解除トグルを足し、複数 URL を1ダイアログで一括投入（失敗時は1件ずつフォールバック）する。

**Architecture:** 既存の DI ＋純粋ロジック分離を踏襲。`importer.ts` は「コミット境界」を明示し、2件以上なら `importOne(urls.join('\n'))` を1回試み、コミット前失敗のみ既存の逐次ループへフォールバック、コミット後失敗は重複回避のため全件失敗記録で停止。UI は `import-panel.ts` にタブ件数ヘッダーとトグルを追加し、CSS でスクロール領域と行間隔を整える。

**Tech Stack:** TypeScript (strict) / Vite / Vitest (jsdom)。Chrome MV3 content script。外部ネットワーク送信ゼロ。

## Global Constraints

- 静的ゲートは `npm run typecheck`（strict、`noUnusedLocals` / `noUnusedParameters` はエラー）。Linter 無し。
- テストは `npm test`（vitest run、jsdom）。ロジックは `document` 直参照せず DI / `root` 引数でテスト可能に。
- 注入 DOM には `data-nlk` 属性を付ける。
- i18n は日英必須（`src/content/i18n.ts` の `EN` / `ja` 両方にキーを追加。テンプレートは `{name}` 形式）。
- 外部ネットワーク送信ゼロ / 権限追加なし（manifest 不変）。セレクタ（`selectors.ts`）変更不要。
- 実 DOM 前提は変えない（NotebookLM のウェブサイトソース追加ダイアログは改行区切り複数 URL を1回受付＝`docs/requirements.md` §8.6 line 166）。

---

### Task 1: importer.ts をバッチ投入対応にする（コミット境界の明示）

**Files:**
- Modify: `src/types.ts`（`ImportProgress` に `batch?: boolean`）
- Modify: `src/content/importer.ts`（`importOne` に `onCommit`、`importUrls` にバッチ分岐）
- Test: `tests/importer.test.ts`（フェイク world 更新 + バッチ系テスト追加）

**Interfaces:**
- Consumes: `ImporterDeps`（既存）, `waitFor` / `AbortError`（`dom-utils`）。
- Produces:
  - `interface ImportProgress { total: number; completed: number; failed: number; currentUrl?: string; batch?: boolean }`
  - `importUrls(urls: string[], deps: ImporterDeps, opts?: { onProgress?: (p: ImportProgress) => void; signal?: AbortSignal }): Promise<ImportResult>`（シグネチャ不変。挙動: 2件以上は一括投入を先に試みる）

- [ ] **Step 1: `ImportProgress` に `batch?` を追加**

`src/types.ts` の `ImportProgress` を次に置き換える:

```ts
export interface ImportProgress {
  total: number
  completed: number
  failed: number
  currentUrl?: string
  // バッチ（全件1回投入）試行中の進捗イベントで true。UI は「N件を一括追加中」を表示する。
  batch?: boolean
}
```

- [ ] **Step 2: フェイク world を「1挿入で複数ソース追加」に合わせて更新し、失敗テストを書く**

`tests/importer.test.ts` の `makeWorld` を次のように更新する（`click(submit)` を改行分割で `added` に積む＋`addCount` を公開）:

```ts
function makeWorld() {
  document.body.innerHTML = ''
  const added: string[] = []
  let addCount = 0
  let dialog: HTMLElement | null = null
  let input: HTMLInputElement | null = null
  const el = (name: string) => {
    const e = document.createElement('button')
    e.dataset.name = name
    return e
  }

  const deps: ImporterDeps = {
    getAddSourceButton: () => el('add'),
    getSourceDialog: () => dialog,
    getWebsiteChip: () => (dialog ? el('chip') : null),
    getUrlInput: () => input,
    getSubmitButton: () => {
      if (!dialog || !input) return null
      const b = el('submit') as HTMLButtonElement
      b.disabled = input.value === '' // URL 未入力の間は無効（実機の想定挙動）
      return b
    },
    setInputValue: (e, v) => { e.value = v },
    click: (e) => {
      const name = e.dataset.name
      if (name === 'add') {
        addCount++
        dialog = document.createElement('div')
        document.body.appendChild(dialog)
        input = null
      } else if (name === 'chip') {
        input = document.createElement('input')
        dialog?.appendChild(input)
      } else if (name === 'submit') {
        // 実機は1挿入で改行区切りの複数 URL をまとめて追加する（§8.6）
        if (input) added.push(...input.value.split('\n').map((s) => s.trim()).filter(Boolean))
        dialog?.remove()
        dialog = null
        input = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, added, addCount: () => addCount, isDialogOpen: () => dialog !== null }
}
```

続けて、既存の3テストを次のバッチ前提に**置き換える**（`imports all urls sequentially...` / `records a failure and stops...` / `aborts between items...` の3つ）:

```ts
it('batches multiple urls into a single dialog submission', async () => {
  const { deps, added, addCount } = makeWorld()
  const progress = vi.fn()
  const res = await importUrls(URLS, deps, { onProgress: progress })
  expect(addCount()).toBe(1) // 1ダイアログで一括投入
  expect(added).toEqual(URLS)
  expect(res.succeeded).toEqual(URLS)
  expect(res.failed).toEqual([])
  expect(res.aborted).toBe(false)
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ batch: true }))
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ total: 2, completed: 2, failed: 0 }),
  )
})

it('falls back to per-url when the batch fails before commit', async () => {
  const { deps, added, addCount } = makeWorld()
  // 複数行入力だと挿入ボタンが有効化しない世界（コミット前失敗）を再現
  const realSubmit = deps.getSubmitButton
  deps.getSubmitButton = (d) => {
    const b = realSubmit(d) as HTMLButtonElement | null
    if (b && d.querySelector('input')) {
      const v = d.querySelector('input')!.value
      if (v.includes('\n')) b.disabled = true
    }
    return b
  }
  const res = await importUrls(URLS, deps)
  expect(addCount()).toBe(3) // バッチ1回（失敗）＋フォールバック2回
  expect(added).toEqual(URLS) // 個別投入で両方成功
  expect(res.succeeded).toEqual(URLS)
  expect(res.failed).toEqual([])
})

it('fails all urls and stops when the batch dialog never closes after commit', async () => {
  const { deps, addCount } = makeWorld()
  const realClick = deps.click
  deps.click = (e) => {
    if (e.dataset.name === 'submit') return // 挿入しても閉じない（想定外 DOM）
    realClick(e)
  }
  const res = await importUrls(URLS, deps)
  expect(addCount()).toBe(1) // コミット後失敗はフォールバックしない
  expect(res.succeeded).toEqual([])
  expect(res.failed.map((f) => f.url)).toEqual(URLS) // 全件を失敗記録して停止
})

it('aborts before commit during the batch', async () => {
  const { deps, added } = makeWorld()
  deps.getWebsiteChip = () => null // チップが出ないまま待ち続ける（コミット前）
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 50)
  const res = await importUrls(URLS, deps, { signal: ac.signal })
  expect(res.aborted).toBe(true)
  expect(res.succeeded).toEqual([])
  expect(added).toEqual([])
})
```

（`waits for the website chip...` / `resolves immediately with an empty result...` / `aborts promptly mid-item before the insert click` の3テストはそのまま残す＝いずれも 0〜1 件で逐次パスを通り不変。）

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npx vitest run tests/importer.test.ts`
Expected: FAIL（`importOne` に `onCommit` 引数無し・`importUrls` にバッチ分岐無しのため、batch/fallback/post-commit テストが落ちる）

- [ ] **Step 4: `importer.ts` を実装する**

`src/content/importer.ts` を次に置き換える:

```ts
import type { ImportProgress, ImportResult } from '../types'
import type { waitFor as WaitFor } from './dom-utils'
import { AbortError } from './dom-utils'

export interface ImporterDeps {
  getAddSourceButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// ①〜④（挿入クリック前）は signal を渡し、Stop / SPA teardown で即座に中断できる
// ようにする（インポートは非破壊のため、確定クリック前の中断は安全）。
// ⑤ の挿入クリックが「コミット点」。ここで onCommit を発火し、呼び出し側が
// 「コミット前失敗（安全にフォールバック可）」と「コミット後失敗（追加済みか不明・
// 重複回避のため停止）」を区別できるようにする。
// ⑥ の完了待ちだけは signal を渡さない: 挿入クリック後に中断すると、実際には追加
// されたソースを「未処理」と誤記録して再実行時の重複インポートを招くため、
// コミット後は完了まで見届ける（以降の中断はループの URL 境界で効く）。
// url は改行区切りで複数 URL を渡してよい（§8.6: ダイアログは1回で複数受付）。
// タイムアウト既定はページ取得を伴うため削除（5s）より長めの 10s。
async function importOne(
  url: string,
  deps: ImporterDeps,
  signal?: AbortSignal,
  onCommit?: () => void,
): Promise<void> {
  const timeout = deps.timeout ?? 10000
  const w = deps.waitFor

  // ① ソース追加ボタン（前件のダイアログが閉じた直後の再描画に備えて出現待ち）
  const add = await w(() => deps.getAddSourceButton(), { timeout, signal })
  deps.click(add)
  // ② ダイアログ内の「ウェブサイト」チップ。チップは容器より遅れて描画されるため、
  // 容器ではなくチップ自体の出現を待つ（deleter の Delete ボタン待ちと同パターン）。
  const opened = await w(() => {
    const dialog = deps.getSourceDialog()
    const chip = dialog ? deps.getWebsiteChip(dialog) : null
    return dialog && chip ? { dialog, chip } : null
  }, { timeout, signal })
  deps.click(opened.chip)
  // ③ URL 入力欄に値を設定（Angular に届くよう input イベント発火込みの setInputValue）
  const input = await w(() => deps.getUrlInput(opened.dialog), { timeout, signal })
  deps.setInputValue(input, url)
  // ④ 挿入ボタンが「存在して有効」になるまで待つ（未入力の間は disabled のため、
  // 存在だけ見て押すと no-op になる）
  const submit = await w(() => {
    const btn = deps.getSubmitButton(opened.dialog)
    if (!btn) return null
    return (btn as HTMLButtonElement).disabled ? null : btn
  }, { timeout, signal })
  // ⑤ 挿入クリック＝コミット点
  deps.click(submit)
  onCommit?.()
  // ⑥ 掴んだダイアログノード自身が DOM から外れるまで待つ = 完了。
  // 再検索すると次の件のダイアログを拾い得るため、掴んだノードを見る。
  await w(() => (opened.dialog.isConnected ? null : true), { timeout })
}

export async function importUrls(
  urls: string[],
  deps: ImporterDeps,
  opts: { onProgress?: (p: ImportProgress) => void; signal?: AbortSignal } = {},
): Promise<ImportResult> {
  const { onProgress, signal } = opts
  const result: ImportResult = { succeeded: [], failed: [], aborted: false }
  const total = urls.length
  const report = (currentUrl?: string, batch?: boolean) =>
    onProgress?.({
      total,
      completed: result.succeeded.length,
      failed: result.failed.length,
      currentUrl,
      batch,
    })

  // 2件以上は1ダイアログへ一括投入を試みる（§8.6: 改行区切りで複数 URL を1回受付）。
  if (urls.length >= 2) {
    if (signal?.aborted) {
      result.aborted = true
      report()
      return result
    }
    report(undefined, true)
    let committed = false
    try {
      await importOne(urls.join('\n'), deps, signal, () => { committed = true })
      result.succeeded.push(...urls)
      report()
      return result
    } catch (err) {
      if (err instanceof AbortError) {
        // コミット前の中断（① 〜 ④）: ソース未追加で停止
        result.aborted = true
        report()
        return result
      }
      if (committed) {
        // コミット後の失敗（⑥ タイムアウト等）: 追加済みか不明。重複回避のため
        // 全 urls を失敗記録して停止（フォールバックしない＝安全側）。
        const reason = err instanceof Error ? err.message : String(err)
        for (const url of urls) result.failed.push({ url, reason })
        report()
        return result
      }
      // コミット前の失敗: 何も追加されていない → 1件ずつフォールバックへ
    }
  }

  // 逐次フォールバック / 単一 URL パス（既存規約: 安全停止・URL 境界中断）
  for (const url of urls) {
    // 中断は各 URL の境界でのみ判定（処理中の1件は完了させる）
    if (signal?.aborted) {
      result.aborted = true
      break
    }
    report(url)
    try {
      await importOne(url, deps, signal)
      result.succeeded.push(url)
    } catch (err) {
      if (err instanceof AbortError) {
        // 挿入クリック前の中断: この URL は未処理扱いで停止（失敗には数えない）
        result.aborted = true
        break
      }
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ url, reason: err instanceof Error ? err.message : String(err) })
      break
    }
  }
  report()
  return result
}
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `npx vitest run tests/importer.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラー無し

- [ ] **Step 7: コミット**

```bash
git add src/types.ts src/content/importer.ts tests/importer.test.ts
git commit -m "importer をバッチ投入対応にする（コミット前失敗のみフォールバック）"
```

---

### Task 2: 進捗表示のバッチ文言 + main.ts 配線

**Files:**
- Modify: `src/content/i18n.ts`（`importBatchProgress` キーを EN / ja に追加）
- Modify: `src/content/main.ts:248`（`onProgress` で `p.batch` を見て文言切替）
- Test: `tests/i18n.test.ts`（新キーの存在/展開を確認）

**Interfaces:**
- Consumes: `ImportProgress.batch`（Task 1）。
- Produces: i18n キー `importBatchProgress`（`{count}` を1変数持つ）。

- [ ] **Step 1: i18n テストを追加して失敗を確認**

`tests/i18n.test.ts` を開き、`describe` 内に次を追加する（ファイル先頭の import は既存の `createT` を使う。無ければ `import { createT } from '../src/content/i18n'`）:

```ts
it('formats the batch import progress in both languages', () => {
  expect(createT('en')('importBatchProgress', { count: 5 })).toBe('Adding 5 URLs at once…')
  expect(createT('ja')('importBatchProgress', { count: 5 })).toBe('5 件を一括追加中…')
})
```

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL（キー未定義でテンプレートがキー名のまま返る）

- [ ] **Step 2: i18n キーを追加**

`src/content/i18n.ts` の `EN` オブジェクト内、`importProgress` の次の行に追加:

```ts
  importBatchProgress: 'Adding {count} URLs at once…',
```

`ja` オブジェクト内、`importProgress` の次の行に追加:

```ts
    importBatchProgress: '{count} 件を一括追加中…',
```

- [ ] **Step 3: テストを実行して通過を確認**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS

- [ ] **Step 4: main.ts の onProgress を分岐**

`src/content/main.ts` の `onProgress`（現在 248 行付近）を次に置き換える:

```ts
        onProgress: (p) =>
          panel.setProgress(
            p.batch
              ? t('importBatchProgress', { count: p.total })
              : t('importProgress', { done: p.completed, total: p.total }),
          ),
```

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add src/content/i18n.ts src/content/main.ts tests/i18n.test.ts
git commit -m "一括投入中の進捗文言を追加し main の配線を分岐"
```

---

### Task 3: タブ一覧の件数ヘッダー + 全選択/全解除トグル + スクロール改善

**Files:**
- Modify: `src/content/ui/import-panel.ts`（`loadTabsBtn` ハンドラを再構成）
- Modify: `src/content/ui/import-panel.css`（ヘッダーとスクロール領域）
- Modify: `src/content/i18n.ts`（`tabSelectionCounts` を EN / ja に追加。`selectAll` / `deselectAll` は既存）
- Test: `tests/import-panel.test.ts`（トグル/件数のテスト追加）

**Interfaces:**
- Consumes: `t('tabSelectionCounts', { selected, total })`, `t('selectAll')`, `t('deselectAll')`（既存）。
- Produces（新 `data-nlk` フック）: `import-tab-header`, `import-tab-counts`, `import-toggle-all`, `import-tab-items`。既存 `import-tab-check` / `import-tab-item` / `import-add-tabs` の意味は不変。

- [ ] **Step 1: i18n キー `tabSelectionCounts` を追加**

`src/content/i18n.ts` の `EN` に（`tabsError` の次あたりに）追加:

```ts
  tabSelectionCounts: 'Selected {selected} / {total}',
```

`ja` に追加:

```ts
    tabSelectionCounts: '選択 {selected} / 全 {total}',
```

- [ ] **Step 2: 失敗するトグル/件数テストを書く**

`tests/import-panel.test.ts` に次のテストを追加する（ファイル冒頭の `q` / `flush` / `mount` を再利用）:

```ts
it('shows selection counts and a toggle that clears/selects all tabs', async () => {
  mount({}, [
    { title: 'A', url: 'https://a.example/' },
    { title: 'B', url: 'https://b.example/' },
    { title: 'C', url: 'https://c.example/' },
  ])
  q('import-load-tabs')!.click()
  await flush()

  const counts = q('import-tab-counts')!
  const toggle = q<HTMLButtonElement>('import-toggle-all')!
  expect(counts.textContent).toBe('Selected 3 / 3')
  expect(toggle.textContent).toBe('Clear all') // 全選択時は「すべて解除」

  toggle.click() // すべて解除
  const boxes = () => document.querySelectorAll<HTMLInputElement>('[data-nlk="import-tab-check"]')
  expect(Array.from(boxes()).every((c) => !c.checked)).toBe(true)
  expect(counts.textContent).toBe('Selected 0 / 3')
  expect(toggle.textContent).toBe('Select all') // 全解除時は「すべて選択」

  toggle.click() // すべて選択
  expect(Array.from(boxes()).every((c) => c.checked)).toBe(true)
  expect(counts.textContent).toBe('Selected 3 / 3')
  expect(toggle.textContent).toBe('Clear all')
})

it('updates counts and toggle label when a single tab is unchecked', async () => {
  mount({}, [
    { title: 'A', url: 'https://a.example/' },
    { title: 'B', url: 'https://b.example/' },
  ])
  q('import-load-tabs')!.click()
  await flush()

  const box = document.querySelector<HTMLInputElement>('[data-nlk="import-tab-check"]')!
  box.checked = false
  box.dispatchEvent(new Event('change', { bubbles: true }))

  expect(q('import-tab-counts')!.textContent).toBe('Selected 1 / 2')
  expect(q<HTMLButtonElement>('import-toggle-all')!.textContent).toBe('Select all')
})

it('resets to all-selected when tabs are reloaded', async () => {
  const { handlers } = mount({}, [{ title: 'A', url: 'https://a.example/' }])
  q('import-load-tabs')!.click()
  await flush()
  q<HTMLButtonElement>('import-toggle-all')!.click() // 一旦すべて解除
  expect(q('import-tab-counts')!.textContent).toBe('Selected 0 / 1')
  q('import-load-tabs')!.click() // 再読込
  await flush()
  expect(handlers.onLoadTabs).toHaveBeenCalledTimes(2)
  expect(q('import-tab-counts')!.textContent).toBe('Selected 1 / 1') // 全選択に戻る
  expect(q<HTMLButtonElement>('import-toggle-all')!.textContent).toBe('Clear all')
})
```

Run: `npx vitest run tests/import-panel.test.ts`
Expected: FAIL（`import-tab-counts` / `import-toggle-all` が未実装で null）

- [ ] **Step 3: `import-panel.ts` の `loadTabsBtn` ハンドラを再構成**

`src/content/ui/import-panel.ts` の `loadTabsBtn.addEventListener('click', ...)` ブロック（現在 120〜151 行）を次に置き換える:

```ts
  loadTabsBtn.addEventListener('click', () => {
    void (async () => {
      tabList.hidden = false
      tabList.textContent = ''
      addTabsBtn.hidden = true
      try {
        const tabs = await handlers.onLoadTabs()
        if (tabs.length === 0) {
          tabList.textContent = t('noTabs')
          return
        }

        // 件数ヘッダー（選択 N / 全 M）＋ 全選択/全解除トグル
        const header = document.createElement('div')
        header.className = 'nlk-import-tab-header'
        header.setAttribute('data-nlk', 'import-tab-header')
        const countsSpan = document.createElement('span')
        countsSpan.setAttribute('data-nlk', 'import-tab-counts')
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.setAttribute('data-nlk', 'import-toggle-all')
        header.append(countsSpan, toggle)

        // スクロール領域（チェックボックス行）
        const items = document.createElement('div')
        items.className = 'nlk-import-tab-items'
        items.setAttribute('data-nlk', 'import-tab-items')

        const checks: HTMLInputElement[] = []
        const updateHeader = () => {
          const selected = checks.filter((c) => c.checked).length
          countsSpan.textContent = t('tabSelectionCounts', { selected, total: checks.length })
          toggle.textContent = selected === checks.length ? t('deselectAll') : t('selectAll')
        }

        for (const tab of tabs) {
          const label = document.createElement('label')
          label.setAttribute('data-nlk', 'import-tab-item')
          const check = document.createElement('input')
          check.type = 'checkbox'
          check.checked = true
          check.setAttribute('data-nlk', 'import-tab-check')
          check.dataset.url = tab.url
          check.addEventListener('change', updateHeader)
          const text = document.createElement('span')
          text.textContent = tab.title || tab.url
          text.title = tab.url
          label.append(check, text)
          items.appendChild(label)
          checks.push(check)
        }

        toggle.addEventListener('click', () => {
          const allChecked = checks.every((c) => c.checked)
          for (const c of checks) c.checked = !allChecked
          updateHeader()
        })

        updateHeader()
        tabList.append(header, items)
        addTabsBtn.hidden = false
      } catch {
        // background 不通など。パネルは壊さずメッセージだけ出す。
        tabList.textContent = t('tabsError')
      }
    })()
  })
```

（`addTabsBtn` のハンドラは変更不要 —— `tabList.querySelectorAll('[data-nlk="import-tab-check"]')` は `items` 配下のチェックも拾う。）

- [ ] **Step 4: テストを実行して通過を確認**

Run: `npx vitest run tests/import-panel.test.ts`
Expected: PASS（新テスト＋既存の「loads tabs into a checkbox list...」「no importable tabs」も緑）

- [ ] **Step 5: CSS を更新（スクロール領域と行間隔）**

`src/content/ui/import-panel.css` の `.nlk-import-tab-list` 関連ルール（現在 40〜54 行の
`.nlk-import-tab-list { ... }` と `.nlk-import-tab-list label { ... }`）を次に置き換える:

```css
.nlk-import-tab-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nlk-import-tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.nlk-import-tab-header button[data-nlk='import-toggle-all'] {
  background: none;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 2px 8px;
  color: inherit;
  font: inherit;
}
.nlk-import-tab-items {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nlk-import-tab-items label {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 2px;
  white-space: nowrap;
  overflow: hidden;
}
.nlk-import-tab-items label span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 6: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: 型エラー無し / 全テスト PASS

- [ ] **Step 7: コミット**

```bash
git add src/content/ui/import-panel.ts src/content/ui/import-panel.css src/content/i18n.ts tests/import-panel.test.ts
git commit -m "タブ一覧に件数ヘッダーと全選択/全解除トグルを追加しスクロールを改善"
```

---

### Task 4: 検索ボックスの issue 化 + ドキュメント反映

**Files:**
- Modify: `docs/requirements.md`（§8.6 の「一括投入は別 issue で検討」を実装済みに更新）
- Modify: `docs/e2e-checklist-phase2.md`（多数タブ一覧・全解除トグル・一括投入の観点を追記）
- Modify: `CLAUDE.md`（importer が「複数 URL を1ダイアログで一括投入（失敗時フォールバック）」に変わった旨を Phase 2 段落へ一言）

**Interfaces:** なし（ドキュメント/issue のみ）。

- [ ] **Step 1: 検索ボックスの issue を作成**

```bash
gh issue create \
  --title "インポートパネルのタブ一覧に絞り込み検索を追加" \
  --body "タブが非常に多い場合にタイトル/URL でインクリメンタルに絞り込める検索欄を追加する。2026-07-05 の UX 改善（件数ヘッダー・全選択/全解除トグル・スクロール改善）ではスコープ外とした。" \
  --label "priority: low" --label "enhancement"
```

（`priority: low` / `enhancement` ラベルが無ければ先に `gh label create` する。CLAUDE.md「Issue 作成」規約。）

- [ ] **Step 2: `docs/requirements.md` §8.6 を更新**

`docs/requirements.md` の §8.6 の URL 入力の行を次に更新する（「別 issue で検討」→ 実装済み）:

```md
- **URL 入力**: `textarea[formcontrolname="urls"]`（placeholder「リンクを貼り付ける」）。`input` 系は無し。
  ダイアログに「複数の URL はスペース / 改行区切りで1回受付」の記載あり。
  **importer は 2 件以上を改行連結で1回投入し、コミット前失敗のみ1件ずつフォールバックする**
  （2026-07-05 実装。設計は `docs/superpowers/specs/2026-07-05-tab-import-ux-batch-design.md`）。
```

- [ ] **Step 3: `docs/e2e-checklist-phase2.md` に観点を追記**

`docs/e2e-checklist-phase2.md` に次の観点を追記する（既存の見出し構成に合わせ、無ければ末尾に「## タブ UX / 一括投入（2026-07-05）」節を新設）:

```md
## タブ UX / 一括投入（2026-07-05）

- [ ] 多数タブを「開いているタブを読み込む」で一覧化 → 一覧がスクロールでき、行が読みやすい。
- [ ] 件数ヘッダーが「選択 N / 全 M」を表示し、チェック増減でライブ更新する。
- [ ] 全選択時トグルが「すべて解除」、押すと全 OFF・ラベルが「すべて選択」に変わる（逆も）。
- [ ] 複数 URL を「N件をインポート」→ 1つのソース追加ダイアログで一括投入され、全件がソース化される。
- [ ] 一括投入中の進捗が「N件を一括追加中…」と表示される。
- [ ] （安全側確認）挿入後にダイアログが閉じない異常時は、重複投入せず失敗として停止する。
```

- [ ] **Step 4: `CLAUDE.md` の Phase 2 段落を更新**

`CLAUDE.md` の importer を説明する段落（「Phase 2（インポート）は Phase 1 と同じ分離を踏襲。」の段）に、
1 URL ずつの記述の後へ次を追記する:

```md
2 件以上は §8.6 のとおり1ダイアログへ改行連結で**一括投入**し、コミット前失敗のみ1件ずつにフォールバックする（コミット後失敗は重複回避で停止）。
```

- [ ] **Step 5: コミット**

```bash
git add docs/requirements.md docs/e2e-checklist-phase2.md CLAUDE.md
git commit -m "一括投入の実装を requirements/e2e/CLAUDE に反映"
```

---

## Self-Review

**1. Spec coverage:**
- ① 見やすさ（件数ヘッダー＋スクロール/行間隔） → Task 3。検索ボックス issue 化 → Task 4 Step 1。✓
- ② 全選択/全解除トグル（既定全選択・再読込でリセット） → Task 3。✓
- ③ 全件1回投入＋コミット前失敗フォールバック＋コミット後停止 → Task 1。進捗 `batch` フラグ → Task 1（型）/ Task 2（文言）。✓
- テスト方針（importer 5系統・panel 3系統） → Task 1 / Task 3 に反映。✓
- i18n 追加（tabSelectionCounts, importBatchProgress、selectAll/deselectAll は既存） → Task 2 / Task 3。✓
- ドキュメント反映（requirements §8.6 / e2e / CLAUDE） → Task 4。✓

**2. Placeholder scan:** 各 step は実コードと実コマンドを含む。「適切なエラー処理」等の曖昧語なし。✓

**3. Type consistency:**
- `ImportProgress.batch?: boolean`（Task 1 定義）を Task 2 の `p.batch` で参照 —— 一致。✓
- `importOne(url, deps, signal?, onCommit?)` の `onCommit` は Task 1 内で定義・使用。外部公開なし。✓
- 新 `data-nlk`: `import-tab-header` / `import-tab-counts` / `import-toggle-all` / `import-tab-items` は Task 3 の実装とテストで綴り一致。✓
- i18n キー `importBatchProgress` / `tabSelectionCounts` は定義（Task 2/3 Step 1・2）と使用（main.ts / import-panel.ts）で一致。✓
