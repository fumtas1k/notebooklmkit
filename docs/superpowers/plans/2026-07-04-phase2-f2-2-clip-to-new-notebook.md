# F2-2 現ページから新規ノートブック作成（issue #36・改訂）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意の Web ページでツールバーアイコンをクリックすると、その現ページを唯一のソースとする新規 NotebookLM ノートブックをフォアグラウンドで作成する（MVP = 現在タブ1つ）。

**Architecture:** `chrome.action.onClicked`（popup なし）を background で受け、現ページ URL を `storage.local` の `pendingCreate` に置いて NotebookLM ホームをフォアグラウンド新規タブで開く。content script はブート時に `pendingCreate` を拾い、`create-new-button` をクリック → 自動で開くソース追加ダイアログ（#37 で調査済み）に URL を挿入して新規ノートブックを作る。NotebookLM は SPA なので content script は作成遷移を跨いで生き続け、1回の処理で通す。

**Tech Stack:** TypeScript（strict）、Vitest + jsdom、Manifest V3、chrome.action / storage / tabs / runtime messaging。

## Global Constraints

- 追加権限は **`storage`** のみ。`tabs` は既存流用。`host_permissions` は `https://notebooklm.google.com/*` のみ維持。
- `chrome.action` は manifest に `action: {}` を追加し **`default_popup` を置かない**（onClicked を発火させる）。
- 外部ネットワーク送信ゼロ。`pendingCreate` は端末内 storage.local のみ。`{ urls, ts }`。実行後クリア＋`ts` 古さガード既定 **60000ms**（`PENDING_TTL_MS`）。
- DOM セレクタは `src/content/selectors.ts` に集約。`mdc-*`/`mat-*` は比較的安定、`ng-tns-*`/`_ngcontent-*` に依存しない。
- 注入 DOM の除外は `data-nlk` 属性で行う（getter は `data-nlk` 配下を対象外）。
- DI ＋純ロジックでテスト可能に（`document`/実 chrome を直接触らず注入）。既存 `init()`/`initImport()`/`nlk:list-tabs` は不変。
- 静的ゲート: `npm run typecheck`。テスト: `npm test`。

---

## File Structure

- Modify: `src/types.ts` — `PendingCreate` 型、`CREATE_RESULT_MESSAGE`、`PENDING_TTL_MS`。
- Modify: `manifest.config.ts` — `permissions` に `'storage'`、`action: {}`。
- Modify: `src/content/selectors.ts` — `SOURCE_TEXT.createNew` と `getCreateNewButton`。
- Create: `src/content/notebook-creator.ts` — `createNotebookWithUrls`（DI）。
- Modify: `src/background/main.ts` — `handleClipClick` / `handleCreateResult` ＋配線。
- Modify: `src/content/main.ts` — `handlePendingCreate` ＋ `start()` ブート時配線。
- Modify: `docs/e2e-checklist-phase2.md` — F2-2 節を改訂。
- Create tests: `notebook-creator` / `selectors`(create-new 追加) / `background-clip` / `create-wiring`。

---

### Task 1: 共有型・定数と manifest 権限

**Files:**
- Modify: `src/types.ts`（末尾に追記）
- Modify: `manifest.config.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces:
  - `interface PendingCreate { urls: string[]; ts: number }`
  - `const CREATE_RESULT_MESSAGE = 'nlk:create-result'`
  - `const PENDING_TTL_MS = 60000`

- [ ] **Step 1: 失敗するテストを書く**

`tests/types.test.ts` に追記（既存 import 行に足す）:

```ts
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS } from '../src/types'

describe('f2-2 clip constants', () => {
  it('defines the create-result message type and ttl', () => {
    expect(CREATE_RESULT_MESSAGE).toBe('nlk:create-result')
    expect(PENDING_TTL_MS).toBe(60000)
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL（未 export）

- [ ] **Step 3: 実装**

`src/types.ts` 末尾に追記:

```ts
// F2-2（現ページから新規ノートブック作成）: 実行待ちの URL 群（storage.local）。
// 実行後クリア＋ts 古さガードで残留を無視する。
export interface PendingCreate {
  urls: string[]
  ts: number
}

// content → background: 新規ノートブック作成の結果（バッジ更新用）。
export const CREATE_RESULT_MESSAGE = 'nlk:create-result'
// pendingCreate の有効期限（ms）。超過分は実行せず掃除する。
export const PENDING_TTL_MS = 60000
```

`manifest.config.ts` を変更:

```ts
// Before
  permissions: ['tabs'],
  background: {
// After
  permissions: ['tabs', 'storage'],
  // ツールバーアイコンからの新規ノートブック作成（F2-2）。default_popup を置かず onClicked を使う。
  action: {},
  background: {
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run tests/types.test.ts && npm run typecheck`
Expected: PASS ／ 型エラーなし

- [ ] **Step 5: ビルドで manifest 確認しコミット**

Run: `npm run build && node -e "const m=require('./dist/manifest.json'); if(!m.permissions.includes('storage')||!m.action) throw new Error('manifest'); console.log('ok', JSON.stringify(m.permissions), JSON.stringify(m.action))"`
Expected: `ok ["tabs","storage"] {}`

```bash
git add src/types.ts manifest.config.ts tests/types.test.ts
git commit -m "feat(#36): 新規作成クリップ用の型/定数と storage・action 権限を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `getCreateNewButton` セレクタ

**Files:**
- Modify: `src/content/selectors.ts:63-68`（`SOURCE_TEXT`）, 末尾に getter 追加
- Test: `tests/selectors-source.test.ts`

**Interfaces:**
- Consumes: 既存 `SOURCE_TEXT`
- Produces: `getCreateNewButton(root?: ParentNode): HTMLElement | null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/selectors-source.test.ts` に `getCreateNewButton` の import を足し、末尾 `describe` 内に追加:

```ts
  it('getCreateNewButton finds the stable create-new-button class', () => {
    document.body.innerHTML = `
      <button>別ボタン</button>
      <button class="create-new-button" aria-label="ノートブックを新規作成"><span>add 新規作成</span></button>`
    expect(getCreateNewButton()?.classList.contains('create-new-button')).toBe(true)
  })

  it('getCreateNewButton falls back to aria-label / text', () => {
    document.body.innerHTML = `<button aria-label="ノートブックを新規作成">作成</button>`
    expect(getCreateNewButton()?.getAttribute('aria-label')).toBe('ノートブックを新規作成')
  })

  it('getCreateNewButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `<div data-nlk="x"><button class="create-new-button">新規作成</button></div>`
    expect(getCreateNewButton()).toBeNull()
  })
```

（import 行を `getAddSourceButton, ... , getCreateNewButton` に更新すること。）

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: FAIL（`getCreateNewButton` 未定義）

- [ ] **Step 3: 実装**

`src/content/selectors.ts` の `SOURCE_TEXT` に1行追加:

```ts
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i,
} as const
```

`getAddSourceButton` の直後に追加（同じ「安定クラス優先＋aria/テキスト フォールバック」方針）:

```ts
// ホーム/一覧の「新規作成」ボタン。自拡張が注入した UI（data-nlk 配下）は除外する。
// 実 DOM: button.create-new-button（aria-label="ノートブックを新規作成"）。2026-07-04 実機確認。
export function getCreateNewButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => b.classList.contains('create-new-button')) ??
    buttons.find((b) => SOURCE_TEXT.createNew.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.createNew.test(b.textContent ?? '')) ??
    null
  )
}
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "feat(#36): getCreateNewButton（新規作成ボタン）を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `notebook-creator.ts`（作成オーケストレータ）

**Files:**
- Create: `src/content/notebook-creator.ts`
- Test: `tests/notebook-creator.test.ts`

**Interfaces:**
- Consumes: `waitFor` / `AbortError`（`./dom-utils`）
- Produces:
  - `interface CreatorDeps { getCreateNewButton(): HTMLElement | null; getSourceDialog(): HTMLElement | null; getWebsiteChip(dialog: HTMLElement): HTMLElement | null; getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null; getSubmitButton(dialog: HTMLElement): HTMLElement | null; setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void; click(el: HTMLElement): void; waitFor: typeof waitFor; timeout?: number }`
  - `createNotebookWithUrls(urls: string[], deps: CreatorDeps, opts?: { signal?: AbortSignal }): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/notebook-creator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createNotebookWithUrls, type CreatorDeps } from '../src/content/notebook-creator'

// waitFor の代役: fn() が truthy ならそれを返し、falsy なら「タイムアウト」で投げる。
const fakeWaitFor = (async (fn: () => unknown) => {
  const v = fn()
  if (v) return v
  throw new Error('timeout')
}) as unknown as CreatorDeps['waitFor']

function makeDeps(over: Partial<CreatorDeps> = {}): CreatorDeps & {
  clicks: HTMLElement[]; inputs: [unknown, string][]
} {
  const createBtn = { name: 'create' } as unknown as HTMLElement
  // 完了判定 ⑤ は dialog.isConnected===false を待つので、テストでは最初から false にして即完了させる。
  const dialog = { isConnected: false } as unknown as HTMLElement
  const chip = { name: 'chip' } as unknown as HTMLElement
  const input = {} as HTMLInputElement
  const submit = { disabled: false } as unknown as HTMLElement
  const clicks: HTMLElement[] = []
  const inputs: [unknown, string][] = []
  return {
    clicks, inputs,
    getCreateNewButton: () => createBtn,
    getSourceDialog: () => dialog,
    getWebsiteChip: () => chip,
    getUrlInput: () => input,
    getSubmitButton: () => submit,
    setInputValue: (el, v) => { inputs.push([el, v]) },
    click: (el) => { clicks.push(el) },
    waitFor: fakeWaitFor,
    ...over,
  }
}

describe('createNotebookWithUrls', () => {
  it('clicks create-new → website → submit in order and inserts the joined urls', async () => {
    const d = makeDeps()
    const ok = await createNotebookWithUrls(['https://a/', 'https://b/'], d)
    expect(ok).toBe(true)
    // クリック順: 新規作成ボタン, ウェブサイトチップ, 挿入ボタン
    expect(d.clicks.map((c) => (c as unknown as { name?: string }).name)).toEqual(['create', 'chip', undefined])
    // URL は改行連結で1回入力
    expect(d.inputs).toEqual([[expect.anything(), 'https://a/\nhttps://b/']])
  })

  it('returns false without inserting when urls is empty', async () => {
    const d = makeDeps()
    const ok = await createNotebookWithUrls([], d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
  })

  it('returns false when the create-new button never appears', async () => {
    const d = makeDeps({ getCreateNewButton: () => null })
    const ok = await createNotebookWithUrls(['https://a/'], d)
    expect(ok).toBe(false)
  })

  it('waits for the submit button to become enabled', async () => {
    const disabled = { disabled: true } as unknown as HTMLElement
    const d = makeDeps({ getSubmitButton: () => disabled })
    const ok = await createNotebookWithUrls(['https://a/'], d)
    // disabled のままなら submit 待ちがタイムアウト → false
    expect(ok).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/notebook-creator.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

Create `src/content/notebook-creator.ts`:

```ts
import type { waitFor as WaitFor } from './dom-utils'
import { AbortError } from './dom-utils'

export interface CreatorDeps {
  getCreateNewButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// 「新規作成 → ウェブサイト → URL 挿入」で新規ノートブックを1つ作る。
// 複数 URL は改行連結で1回挿入（NotebookLM の URL 入力欄は複数 URL を1回受付）。
// 失敗（要素不在 / タイムアウト / 中断）は false を返す（呼び出し側が badge '!'）。
export async function createNotebookWithUrls(
  urls: string[],
  deps: CreatorDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  if (urls.length === 0) return false
  const { signal } = opts
  const timeout = deps.timeout ?? 15000
  const w = deps.waitFor
  try {
    // ① 新規作成ボタン出現待ち → クリック（新規作成 → ?addSource=true に遷移しダイアログ自動オープン）
    const createBtn = await w(() => deps.getCreateNewButton(), { timeout, signal })
    deps.click(createBtn)
    // ② ソース追加ダイアログ + 「ウェブサイト」チップ出現待ち → クリック
    const opened = await w(() => {
      const dialog = deps.getSourceDialog()
      const chip = dialog ? deps.getWebsiteChip(dialog) : null
      return dialog && chip ? { dialog, chip } : null
    }, { timeout, signal })
    deps.click(opened.chip)
    // ③ URL 入力欄出現待ち → 改行連結で設定（Angular に届くよう input イベント発火込み）
    const input = await w(() => deps.getUrlInput(opened.dialog), { timeout, signal })
    deps.setInputValue(input, urls.join('\n'))
    // ④ 挿入ボタンが「存在して有効」になるまで待つ → クリック
    const submit = await w(() => {
      const btn = deps.getSubmitButton(opened.dialog)
      if (!btn) return null
      return (btn as HTMLButtonElement).disabled ? null : btn
    }, { timeout, signal })
    deps.click(submit)
    // ⑤ 掴んだダイアログが DOM から外れる = 完了
    await w(() => (opened.dialog.isConnected ? null : true), { timeout })
    return true
  } catch (err) {
    // タイムアウト / 中断 / 想定外 → 失敗（安全側）
    void (err instanceof AbortError)
    return false
  }
}
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run tests/notebook-creator.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/content/notebook-creator.ts tests/notebook-creator.test.ts
git commit -m "feat(#36): notebook-creator（新規作成→ソース挿入）を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: background の `action.onClicked`（クリップ起動）

**Files:**
- Modify: `src/background/main.ts`
- Test: `tests/background-clip.test.ts`

**Interfaces:**
- Consumes: `CREATE_RESULT_MESSAGE`, `PendingCreate`（Task 1）
- Produces:
  - `const NOTEBOOK_HOME = 'https://notebooklm.google.com/'`
  - `interface ClipDeps { storageSet(items: Record<string, unknown>): Promise<void>; createTab(props: { url: string; active: boolean }): Promise<unknown>; setBadge(text: string): void; now(): number }`
  - `handleClipClick(clickedUrl: string | undefined, d: ClipDeps): Promise<void>`
  - `handleCreateResult(ok: boolean, d: Pick<ClipDeps, 'setBadge'>): void`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/background-clip.test.ts`:

```ts
import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleClipClick, handleCreateResult, type ClipDeps } from '../src/background/main'

function makeDeps(): ClipDeps & { set: Mock<[Record<string, unknown>], Promise<void>>; created: unknown[]; badges: string[] } {
  const created: unknown[] = []
  const badges: string[] = []
  const set = vi.fn(async (_i: Record<string, unknown>) => {})
  return {
    created, badges, set,
    storageSet: set,
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    setBadge: (t: string) => { badges.push(t) },
    now: () => 1000,
  }
}

describe('handleClipClick', () => {
  it('badges "!" and does nothing for a non-http url', async () => {
    const d = makeDeps()
    await handleClipClick('chrome://extensions/', d)
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('stores pendingCreate and opens NotebookLM home in the foreground', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: true }])
    expect(d.badges).toContain('…')
  })

  it('falls back to "!" without throwing when storageSet rejects', async () => {
    const d = makeDeps()
    d.storageSet = vi.fn(async () => { throw new Error('storage unavailable') })
    await expect(handleClipClick('https://x.example/', d)).resolves.toBeUndefined()
    expect(d.badges).toContain('!')
  })

  it('falls back to "!" without throwing when createTab rejects', async () => {
    const d = makeDeps()
    d.createTab = vi.fn(async () => { throw new Error('no tab') })
    await expect(handleClipClick('https://x.example/', d)).resolves.toBeUndefined()
    expect(d.badges).toContain('!')
  })
})

describe('handleCreateResult', () => {
  it('badges check on success and bang on failure', () => {
    const ok: string[] = []
    handleCreateResult(true, { setBadge: (t) => ok.push(t) })
    handleCreateResult(false, { setBadge: (t) => ok.push(t) })
    expect(ok).toEqual(['✓', '!'])
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/background-clip.test.ts`
Expected: FAIL（関数未 export）

- [ ] **Step 3: 実装**

`src/background/main.ts` の import を変更:

```ts
// Before
import { LIST_TABS_MESSAGE, type TabInfo } from '../types'
// After
import {
  LIST_TABS_MESSAGE, CREATE_RESULT_MESSAGE, type TabInfo, type PendingCreate,
} from '../types'
```

既存 `toImportableTabs` と `nlk:list-tabs` リスナー（現行のまま）は**変更しない**。ファイル末尾に追記:

```ts
export const NOTEBOOK_HOME = 'https://notebooklm.google.com/'

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ClipDeps {
  storageSet(items: Record<string, unknown>): Promise<void>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  setBadge(text: string): void
  now(): number
}

// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームをフォアグラウンドで開く（content script が新規作成を実行）。
export async function handleClipClick(clickedUrl: string | undefined, d: ClipDeps): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!')
    return
  }
  // storage/tabs は reject し得る。失敗しても badge '!' に帰着させ '…' 固着を防ぐ。
  try {
    const pending: PendingCreate = { urls: [clickedUrl], ts: d.now() }
    await d.storageSet({ pendingCreate: pending })
    d.setBadge('…')
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
  } catch {
    d.setBadge('!')
  }
}

// content からの作成結果でバッジを更新する。
export function handleCreateResult(ok: boolean, d: Pick<ClipDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!')
}

// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境では登録しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const clearLater = (t: string) => {
    if (t === '✓' || t === '!') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
  }
  const deps: ClipDeps = {
    storageSet: (i) => chrome.storage.local.set(i),
    createTab: (p) => chrome.tabs.create(p),
    setBadge: (text) => { void chrome.action.setBadgeText({ text }); clearLater(text) },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { url?: string }) => { void handleClipClick(tab?.url, deps) })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean } | null
    if (m?.type === CREATE_RESULT_MESSAGE) handleCreateResult(!!m.ok, deps)
  })
}
```

注記: `chrome` は `@types/chrome` のグローバル型を使う（既存 `nlk:list-tabs` ブロックと同じ）。`declare const chrome` は追加しない。onClicked / onMessage のコールバック引数で暗黙 any が出たら上記のように明示注釈で解消する。既存 `background.test.ts` は `chrome.action` を stub しないため配線ブロックはスキップされ無影響。

- [ ] **Step 4: 通過確認**

Run: `npx vitest run tests/background-clip.test.ts tests/background.test.ts && npm run typecheck`
Expected: 両ファイル PASS ／ 型エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/background/main.ts tests/background-clip.test.ts
git commit -m "feat(#36): background の action.onClicked（新規作成クリップ起動）を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: content の `handlePendingCreate` と `start()` 配線

**Files:**
- Modify: `src/content/main.ts`（import 群、`start()`、末尾に env/runner）
- Test: `tests/create-wiring.test.ts`

**Interfaces:**
- Consumes: `createNotebookWithUrls`（Task 3）、`getCreateNewButton` ほか selectors、`CREATE_RESULT_MESSAGE` / `PENDING_TTL_MS` / `PendingCreate`（Task 1）
- Produces:
  - `interface CreateEnv { storageGet(key: string): Promise<Record<string, unknown>>; storageRemove(key: string): Promise<void>; now(): number; sendMessage(message: unknown): void }`
  - `handlePendingCreate(env: CreateEnv, run: (urls: string[]) => Promise<boolean>): Promise<void>`
  - `start()` に第3引数 `env`、第4引数 `run` を追加（既定は実 chrome 配線）

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/create-wiring.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { handlePendingCreate, type CreateEnv } from '../src/content/main'
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS } from '../src/types'

function makeEnv(pending: unknown, now = 1000): CreateEnv & { removed: string[]; sent: unknown[] } {
  const removed: string[] = []
  const sent: unknown[] = []
  return {
    removed, sent,
    storageGet: vi.fn(async () => (pending === undefined ? {} : { pendingCreate: pending })),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
    now: () => now,
    sendMessage: (m: unknown) => { sent.push(m) },
  }
}

describe('handlePendingCreate', () => {
  it('does nothing when there is no pendingCreate', async () => {
    const env = makeEnv(undefined)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([])
  })

  it('runs a fresh pendingCreate, clears it first, and reports the result', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.removed).toEqual(['pendingCreate']) // 実行前クリア
    expect(run).toHaveBeenCalledWith(['https://a/'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true }])
  })

  it('reports failure when run returns false', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => false)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false }])
  })

  it('cleans up a stale pendingCreate without running', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 0 }, PENDING_TTL_MS + 1)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run tests/create-wiring.test.ts`
Expected: FAIL（`handlePendingCreate` 未 export）

- [ ] **Step 3: 実装**

`src/content/main.ts` の import 群に追記:

```ts
import { getCreateNewButton } from './selectors'
import { createNotebookWithUrls } from './notebook-creator'
```

`../types` からの import に `CREATE_RESULT_MESSAGE, PENDING_TTL_MS, type PendingCreate` を追加（既存の `makeTarget, type NotebookTarget` 行に足す）。

`start()` の直前に `CreateEnv` / `handlePendingCreate` / 実 chrome 既定を追加:

```ts
export interface CreateEnv {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  now(): number
  sendMessage(message: unknown): void
}

// pendingCreate を評価し、TTL 内なら storage から消して run(urls) を実行、結果を
// CREATE_RESULT_MESSAGE で background に返す。実行前クリアで二重実行を防ぐ。
export async function handlePendingCreate(
  env: CreateEnv,
  run: (urls: string[]) => Promise<boolean>,
): Promise<void> {
  const got = await env.storageGet('pendingCreate')
  const pending = got.pendingCreate as PendingCreate | undefined
  if (!pending) return
  if (env.now() - pending.ts > PENDING_TTL_MS) {
    await env.storageRemove('pendingCreate')
    return
  }
  await env.storageRemove('pendingCreate')
  const ok = await run(pending.urls)
  env.sendMessage({ type: CREATE_RESULT_MESSAGE, ok })
}

// 実 chrome / storage への既定配線。chrome が無い環境（jsdom）でも安全に no-op になる。
function defaultCreateEnv(): CreateEnv {
  const c = (globalThis as { chrome?: any }).chrome
  return {
    storageGet: (k) => c?.storage?.local?.get(k) ?? Promise.resolve({}),
    storageRemove: (k) => c?.storage?.local?.remove(k) ?? Promise.resolve(),
    now: () => Date.now(),
    sendMessage: (m) => { void c?.runtime?.sendMessage?.(m) },
  }
}

function defaultCreateRunner(root: ParentNode): (urls: string[]) => Promise<boolean> {
  return (urls) =>
    createNotebookWithUrls(urls, {
      getCreateNewButton: () => getCreateNewButton(root),
      getSourceDialog: () => getSourceDialog(),
      getWebsiteChip,
      getUrlInput: getSourceUrlInput,
      getSubmitButton: getSourceSubmitButton,
      setInputValue,
      click: (el) => { safeClick(el) },
      waitFor,
    })
}
```

`start()` のシグネチャと本体に配線を追加（既存の routing はそのまま）:

```ts
export function start(
  root: ParentNode = document,
  getPath: () => string = () => location.pathname,
  env: CreateEnv = defaultCreateEnv(),
  run: (urls: string[]) => Promise<boolean> = defaultCreateRunner(root),
): () => void {
  // …（既存の current/dispose/lastPath, apply の定義はそのまま）…

  apply()
  // F2-2: ツールバー起動でセットされた pendingCreate を、この content script ロード時に一度だけ実行。
  void handlePendingCreate(env, run)
  // …（既存の router 生成・observe・return はそのまま）…
}
```

（`apply()` 呼び出しの直後にこの1行を足すだけ。router 生成・`return` 部は無変更。）

- [ ] **Step 4: 通過確認**

Run: `npx vitest run tests/create-wiring.test.ts tests/main-routing.test.ts tests/main-wiring.test.ts && npm run typecheck`
Expected: すべて PASS（既存 routing / wiring が `start()` の新既定引数で壊れないこと）／型エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/content/main.ts tests/create-wiring.test.ts
git commit -m "feat(#36): handlePendingCreate と start() へのクリップ配線を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: E2E チェックリストの F2-2 節を改訂

**Files:**
- Modify: `docs/e2e-checklist-phase2.md`

- [ ] **Step 1: F2-2 節を追加**

`docs/e2e-checklist-phase2.md` の「## 3. 中断・エラー」の直前に挿入:

```markdown
## 2.5 F2-2: 現在ページから新規ノートブック作成（ツールバー）

準備: 任意の http(s) ページ（記事等）を開く。

- [ ] 記事タブでツールバーアイコンをクリックすると、NotebookLM が新しいタブ（フォアグラウンド）で開き、
      その記事を唯一のソースとする**新規ノートブック**が自動作成される
- [ ] 作成中〜完了でバッジが「…」→「✓」になる（数秒後に消える）
- [ ] `chrome://` などの非 http(s) ページでは何も作られず、バッジ「!」になる
- [ ] （擬似障害）作成フローが途中で失敗するとバッジ「!」になり、クラッシュしない
- [ ] 権限が「notebooklm.google.com のデータの読み取りと変更」+「タブ」+「ストレージ」相当のみ

既知の制限:
- 失敗時、空のノートブックだけが残ることがある（手動削除で対応。拡張は追加操作しない）。
- 複数タブ選択からの新規作成は未実装（別 issue）。
```

- [ ] **Step 2: コミット**

```bash
git add docs/e2e-checklist-phase2.md
git commit -m "docs(#36): E2E チェックリストに F2-2（新規作成）節を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック** — Run: `npm run typecheck` / Expected: エラー0
- [ ] **Step 2: 全テスト** — Run: `npm test` / Expected: 全 PASS
- [ ] **Step 3: ビルド確認** — Run: `npm run build && node -e "const m=require('./dist/manifest.json'); console.log(JSON.stringify(m.permissions), JSON.stringify(m.action), JSON.stringify(m.host_permissions))"` / Expected: `["tabs","storage"] {} ["https://notebooklm.google.com/*"]`

---

## Self-Review

**Spec coverage（spec §10 受け入れ基準）:**
- http/https クリック → 現ページを種に新規ノートブック作成 → Task 4（handleClipClick）＋ Task 5（handlePendingCreate）＋ Task 3（createNotebookWithUrls）＋ Task 2（getCreateNewButton）✅
- 非 http(s) は badge '!' → Task 4 ✅
- 想定外 DOM で安全停止（badge '!'）→ Task 3（false 返し）＋ Task 5（結果送信）＋ Task 4（handleCreateResult）✅
- 成功/失敗が badge で分かる → Task 4 ✅
- 追加権限 storage のみ・host 据え置き → Task 1 ＋ Task 7 Step 3 ✅
- typecheck/test 緑 → Task 7 ✅

**Placeholder scan:** TBD/TODO なし。各コード step に実コードあり。

**Type consistency:**
- `PendingCreate { urls, ts }` は Task 1 定義、Task 4（保存）/ Task 5（読み取り）で同一。
- `CREATE_RESULT_MESSAGE` は Task 1 定義、Task 4（受信→badge）/ Task 5（送信）で参照。
- `createNotebookWithUrls(urls, deps, opts?)` は Task 3 定義、Task 5 の `defaultCreateRunner` で使用（CreatorDeps を selectors から構築）。
- `getCreateNewButton(root?)` は Task 2 定義、Task 5 の runner で使用。
- `handleClipClick` / `handleCreateResult` / `ClipDeps` は Task 4 内で完結（配線から使用）。
- `handlePendingCreate(env, run)` は Task 5 定義・同 Task で start() が使用。
