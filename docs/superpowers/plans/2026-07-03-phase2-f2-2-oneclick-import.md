# F2-2 現在ページのワンクリックインポート（issue #36）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意の Web ページでツールバーアイコンをクリックすると、最後に開いた NotebookLM ノートブックにその URL をワンクリックでソース追加する。

**Architecture:** `chrome.action.onClicked`（popup なし）を background で受け、現在タブ URL と `storage.local` の `lastNotebook` から対象を決めて `pendingImport` を storage に置く。対象ノートブックの既存タブがあれば `nlk:run-pending` メッセージで、無ければバックグラウンド新規タブで、content script（`initImport`）が `pendingImport` を拾って既存 `importUrls` を1件実行し、結果を background に返してバッジ表示する。

**Tech Stack:** TypeScript（strict）、Vitest + jsdom、Manifest V3（`@crxjs/vite-plugin`）、chrome.action / chrome.storage / chrome.tabs / chrome.runtime.messaging。

## Global Constraints

- 追加権限は **`storage`** のみ。`tabs` は既存流用。`host_permissions` は `https://notebooklm.google.com/*` のみ維持。
- `chrome.action` は manifest に `action: {}` を追加し **`default_popup` を置かない**（onClicked を発火させる）。
- 外部ネットワーク送信ゼロを維持。`lastNotebook` / `pendingImport` は端末内 storage のみ。
- `pendingImport` は `storage.local`（`session` は content script から読めない）。`{ notebookId, url, ts }`。実行後に必ずクリア、`ts` 古さガード既定 **60000ms**（`PENDING_TTL_MS`）。
- DI ＋純関数でテスト可能に。ロジックは `document` / 実 `chrome` を直接触らず、注入された協力オブジェクトを使う（`tabs-bridge.ts` / `deleter.ts` と同じ流儀）。
- 既存 getter のシグネチャ・既存 `init()`（一覧ページ配線）・既存 `nlk:list-tabs` リスナーは変更しない。
- 静的ゲート: `npm run typecheck`（strict, noUnusedLocals/Parameters）。テスト: `npm test`。

---

## File Structure

- Create: `src/content/notebook-id.ts` — `/notebook/<id>` の pathname から id を取り出す純関数と、`document.title` からノートブック名を取り出す純関数。
- Create: `src/content/pending-import.ts` — `pendingImport` を評価して実行判定する純関数 `handlePending`（storage / runner / reporter を注入）。
- Modify: `src/types.ts` — `LastNotebook` / `PendingImport` 型、`RUN_PENDING_MESSAGE` / `IMPORT_RESULT_MESSAGE` / `PENDING_TTL_MS` 定数。
- Modify: `manifest.config.ts` — `permissions` に `'storage'`、`action: {}` 追加。
- Modify: `src/background/main.ts` — `handleActionClick` / `handleImportResult`（chrome 注入・純度高め）＋実 chrome への配線。
- Modify: `src/content/main.ts` — `initImport` を拡張（`lastNotebook` 保存 / `handlePending` を mount 時と `run-pending` 受信時に呼ぶ / `runImport` が `ImportResult` を返す）。
- Modify: `docs/e2e-checklist-phase2.md` — F2-2 節を追加。
- Create: `tests/notebook-id.test.ts` / `tests/pending-import.test.ts` / `tests/background-action.test.ts` / （`tests/main-wiring.test.ts` か新規 `tests/import-wiring.test.ts` に initImport 拡張分）。

---

### Task 1: `notebook-id.ts`（純関数）

`/notebook/<id>` から id を取り出す関数と、ページタイトルからノートブック名を取り出す関数。どちらも DOM / chrome に依存しない純関数。

**Files:**
- Create: `src/content/notebook-id.ts`
- Test: `tests/notebook-id.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `parseNotebookId(pathname: string): string | null`
  - `parseNotebookTitle(docTitle: string): string`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/notebook-id.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseNotebookId, parseNotebookTitle } from '../src/content/notebook-id'

describe('parseNotebookId', () => {
  it('extracts the id from a /notebook/<id> path', () => {
    expect(parseNotebookId('/notebook/abc-123')).toBe('abc-123')
  })
  it('extracts the id when trailing segments/query exist', () => {
    expect(parseNotebookId('/notebook/abc-123/foo')).toBe('abc-123')
  })
  it('returns null for non-notebook paths', () => {
    expect(parseNotebookId('/')).toBeNull()
    expect(parseNotebookId('/notebook')).toBeNull()
    expect(parseNotebookId('/notebook/')).toBeNull()
    expect(parseNotebookId('/projects/abc')).toBeNull()
  })
})

describe('parseNotebookTitle', () => {
  it('strips the " - NotebookLM" suffix', () => {
    expect(parseNotebookTitle('Web標準動向 2026年6月版 - NotebookLM')).toBe('Web標準動向 2026年6月版')
  })
  it('returns the trimmed title when no suffix', () => {
    expect(parseNotebookTitle('  My Notebook  ')).toBe('My Notebook')
  })
  it('returns empty string for empty title', () => {
    expect(parseNotebookTitle('')).toBe('')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/notebook-id.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

Create `src/content/notebook-id.ts`:

```ts
// /notebook/<id> の pathname から notebook id を取り出す。該当しなければ null。
// main.ts の isNotebookPath（真偽のみ）とは役割が異なるため別関数として並存させる。
export function parseNotebookId(pathname: string): string | null {
  const m = pathname.match(/^\/notebook\/([^/?#]+)/)
  return m ? m[1] : null
}

// document.title（例: "タイトル - NotebookLM"）から末尾の " - NotebookLM" を除いてノートブック名を得る。
export function parseNotebookTitle(docTitle: string): string {
  return docTitle.replace(/\s*[-–—]\s*NotebookLM\s*$/i, '').trim()
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/notebook-id.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add src/content/notebook-id.ts tests/notebook-id.test.ts
git commit -m "feat(#36): notebook id / タイトル抽出の純関数を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 共有型・定数と manifest 権限

background / content 双方が使う型と定数を `types.ts` に集約し、manifest に `storage` 権限と `action` を追加する。

**Files:**
- Modify: `src/types.ts`（末尾に追記）
- Modify: `manifest.config.ts`
- Test: `tests/types.test.ts`（定数の存在を軽く固定）

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface LastNotebook { id: string; title: string }`
  - `interface PendingImport { notebookId: string; url: string; ts: number }`
  - `const RUN_PENDING_MESSAGE = 'nlk:run-pending'`
  - `const IMPORT_RESULT_MESSAGE = 'nlk:import-result'`
  - `const PENDING_TTL_MS = 60000`

- [ ] **Step 1: 失敗するテストを書く**

`tests/types.test.ts` に以下の `describe` を追記する（既存 import に追加）:

```ts
import {
  RUN_PENDING_MESSAGE, IMPORT_RESULT_MESSAGE, PENDING_TTL_MS,
} from '../src/types'

describe('f2-2 constants', () => {
  it('defines message types and ttl', () => {
    expect(RUN_PENDING_MESSAGE).toBe('nlk:run-pending')
    expect(IMPORT_RESULT_MESSAGE).toBe('nlk:import-result')
    expect(PENDING_TTL_MS).toBe(60000)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL（定数が未 export）

- [ ] **Step 3: 最小実装**

`src/types.ts` の末尾に追記:

```ts
// F2-2（ワンクリックインポート）: 最後に開いたノートブック（storage.local, 永続）。
export interface LastNotebook {
  id: string
  title: string
}

// F2-2: 実行待ちの1件（storage.local）。実行後クリア＋ts 古さガードで残留を無視する。
export interface PendingImport {
  notebookId: string
  url: string
  ts: number
}

// background → 対象ノートブックタブ: pendingImport を実行せよ（既存タブ経路）。
export const RUN_PENDING_MESSAGE = 'nlk:run-pending'
// content → background: インポート結果（バッジ更新用）。
export const IMPORT_RESULT_MESSAGE = 'nlk:import-result'
// pendingImport の有効期限（ms）。これを超えた残留は実行せず掃除する。
export const PENDING_TTL_MS = 60000
```

`manifest.config.ts` を変更:

```ts
// Before
  permissions: ['tabs'],
  background: {
// After
  permissions: ['tabs', 'storage'],
  // ツールバーアイコンのワンクリックインポート（F2-2）。default_popup を置かず onClicked を使う。
  action: {},
  background: {
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/types.test.ts && npm run typecheck`
Expected: PASS ／ 型エラーなし

- [ ] **Step 5: ビルドで manifest を確認しコミット**

Run: `npm run build && node -e "const m=require('./dist/manifest.json'); if(!m.permissions.includes('storage')||!m.action) throw new Error('manifest missing storage/action'); console.log('manifest ok:', JSON.stringify(m.permissions), 'action=', JSON.stringify(m.action))"`
Expected: `manifest ok: ["tabs","storage"] action= {}`

```bash
git add src/types.ts manifest.config.ts tests/types.test.ts
git commit -m "feat(#36): F2-2 用の共有型/定数と storage・action 権限を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `pending-import.ts`（実行判定の純関数）

`pendingImport` を評価し、自分のノートブック宛かつ期限内なら storage から取り出して `run(url)` を呼び、結果を `report(ok)` で返す純関数。storage・runner・reporter を注入してテストする。

**Files:**
- Create: `src/content/pending-import.ts`
- Test: `tests/pending-import.test.ts`

**Interfaces:**
- Consumes: `PendingImport`, `PENDING_TTL_MS`（Task 2）
- Produces:
  - `interface PendingEnv { storageGet(key: string): Promise<Record<string, unknown>>; storageRemove(key: string): Promise<void>; now(): number }`
  - `handlePending(notebookId: string | null, env: PendingEnv, run: (url: string) => Promise<boolean>, report: (ok: boolean) => void): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/pending-import.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { handlePending, type PendingEnv } from '../src/content/pending-import'
import { PENDING_TTL_MS } from '../src/types'

function makeEnv(pending: unknown, now = 1000): PendingEnv & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    storageGet: vi.fn(async () => (pending === undefined ? {} : { pendingImport: pending })),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
    now: () => now,
  }
}

describe('handlePending', () => {
  it('does nothing when notebookId is null', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 })
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending(null, env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('does nothing when there is no pendingImport', async () => {
    const env = makeEnv(undefined)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([])
  })

  it('ignores (and does not remove) a pendingImport for another notebook', async () => {
    const env = makeEnv({ notebookId: 'other', url: 'https://x/', ts: 1000 })
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([]) // 他タブが拾うため残す
  })

  it('cleans up a stale pendingImport without running', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 0 }, PENDING_TTL_MS + 1)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual(['pendingImport'])
    expect(report).not.toHaveBeenCalled()
  })

  it('runs a fresh matching pendingImport, clears it, and reports ok', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(env.removed).toEqual(['pendingImport']) // 実行前にクリア
    expect(run).toHaveBeenCalledWith('https://x/')
    expect(report).toHaveBeenCalledWith(true)
  })

  it('reports failure when run returns false', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 }, 1500)
    const run = vi.fn(async () => false)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(report).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/pending-import.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 最小実装**

Create `src/content/pending-import.ts`:

```ts
import { PENDING_TTL_MS, type PendingImport } from '../types'

export interface PendingEnv {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  now(): number
}

// pendingImport を評価し、自分のノートブック宛かつ期限内なら storage から取り出して
// run(url) を実行し、結果を report(ok) で返す。
// - 他ノートブック宛: 無視（別タブが拾うため storage は残す）。
// - 期限切れ: 掃除して無視。
// - 実行前にクリアして二重実行を防ぐ（mount 契機と run-pending 契機の競合対策）。
export async function handlePending(
  notebookId: string | null,
  env: PendingEnv,
  run: (url: string) => Promise<boolean>,
  report: (ok: boolean) => void,
): Promise<void> {
  if (!notebookId) return
  const got = await env.storageGet('pendingImport')
  const pending = got.pendingImport as PendingImport | undefined
  if (!pending) return
  if (pending.notebookId !== notebookId) return
  if (env.now() - pending.ts > PENDING_TTL_MS) {
    await env.storageRemove('pendingImport')
    return
  }
  await env.storageRemove('pendingImport')
  const ok = await run(pending.url)
  report(ok)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/pending-import.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add src/content/pending-import.ts tests/pending-import.test.ts
git commit -m "feat(#36): pendingImport 実行判定の純関数 handlePending を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: background の `action.onClicked` オーケストレーション

ツールバークリックを受け、URL 検証 → `lastNotebook` 解決 → `pendingImport` 保存 → 既存タブへ `run-pending` 送信 or 新規バックグラウンドタブ作成、を行う `handleActionClick` と、結果でバッジを更新する `handleImportResult` を追加する。どちらも chrome を注入して直接テストする。実 chrome への配線は薄いグルー。

**Files:**
- Modify: `src/background/main.ts`
- Test: `tests/background-action.test.ts`

**Interfaces:**
- Consumes: `RUN_PENDING_MESSAGE`, `PendingImport`（Task 2）、`parseNotebookId`（Task 1）
- Produces:
  - `interface ActionDeps { storageGet(key: string): Promise<Record<string, unknown>>; storageSet(items: Record<string, unknown>): Promise<void>; queryTabs(query: { url: string }): Promise<{ id?: number; url?: string }[]>; createTab(props: { url: string; active: boolean }): Promise<unknown>; sendTabMessage(tabId: number, message: unknown): Promise<void>; setBadge(text: string): void; now(): number }`
  - `handleActionClick(clickedUrl: string | undefined, d: ActionDeps): Promise<void>`
  - `handleImportResult(ok: boolean, d: Pick<ActionDeps, 'setBadge'>): void`
  - 定数 `NOTEBOOK_HOME = 'https://notebooklm.google.com/'`、`notebookUrl(id: string): string`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/background-action.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleActionClick, handleImportResult, type ActionDeps } from '../src/background/main'

function makeDeps(over: Partial<ActionDeps> & { lastNotebook?: unknown } = {}): ActionDeps & {
  set: ReturnType<typeof vi.fn>; created: unknown[]; sent: { id: number; msg: unknown }[]; badges: string[]
} {
  const created: unknown[] = []
  const sent: { id: number; msg: unknown }[] = []
  const badges: string[] = []
  const set = vi.fn(async () => {})
  return {
    created, sent, badges, set,
    storageGet: vi.fn(async () => (over.lastNotebook === undefined ? {} : { lastNotebook: over.lastNotebook })),
    storageSet: set,
    queryTabs: over.queryTabs ?? vi.fn(async () => []),
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    sendTabMessage: vi.fn(async (id, msg) => { sent.push({ id, msg }) }),
    setBadge: (t: string) => { badges.push(t) },
    now: () => 1000,
  }
}

describe('handleActionClick', () => {
  it('badges "!" and does nothing for a non-http url', async () => {
    const d = makeDeps({ lastNotebook: { id: 'a', title: 'A' } })
    await handleActionClick('chrome://extensions/', d)
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('opens NotebookLM home and badges "!" when no lastNotebook', async () => {
    const d = makeDeps({ lastNotebook: undefined })
    await handleActionClick('https://x.example/', d)
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: true }])
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
  })

  it('stores pendingImport and sends run-pending to an existing notebook tab', async () => {
    const d = makeDeps({
      lastNotebook: { id: 'a', title: 'A' },
      queryTabs: vi.fn(async () => [{ id: 7, url: 'https://notebooklm.google.com/notebook/a' }]),
    })
    await handleActionClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingImport: { notebookId: 'a', url: 'https://x.example/', ts: 1000 } })
    expect(d.sent).toEqual([{ id: 7, msg: { type: 'nlk:run-pending' } }])
    expect(d.created).toEqual([])
    expect(d.badges).toContain('…')
  })

  it('opens a background notebook tab when none exists', async () => {
    const d = makeDeps({
      lastNotebook: { id: 'a', title: 'A' },
      queryTabs: vi.fn(async () => [{ id: 9, url: 'https://notebooklm.google.com/notebook/other' }]),
    })
    await handleActionClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingImport: { notebookId: 'a', url: 'https://x.example/', ts: 1000 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/notebook/a', active: false }])
    expect(d.sent).toEqual([])
  })
})

describe('handleImportResult', () => {
  it('badges check on success and bang on failure', () => {
    const ok: string[] = []
    handleImportResult(true, { setBadge: (t) => ok.push(t) })
    handleImportResult(false, { setBadge: (t) => ok.push(t) })
    expect(ok).toEqual(['✓', '!'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/background-action.test.ts`
Expected: FAIL（関数未 export）

- [ ] **Step 3: 最小実装**

`src/background/main.ts` の先頭 import を変更し、末尾に関数と配線を追記する。

import 行を変更:

```ts
// Before
import { LIST_TABS_MESSAGE, type TabInfo } from '../types'
// After
import {
  LIST_TABS_MESSAGE, RUN_PENDING_MESSAGE, IMPORT_RESULT_MESSAGE, type TabInfo, type PendingImport,
} from '../types'
import { parseNotebookId } from '../content/notebook-id'
```

`toImportableTabs` と既存 `nlk:list-tabs` リスナー（現行のまま）は**変更しない**。ファイル末尾に以下を追記:

```ts
export const NOTEBOOK_HOME = 'https://notebooklm.google.com/'
export function notebookUrl(id: string): string {
  return `${NOTEBOOK_HOME}notebook/${id}`
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ActionDeps {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageSet(items: Record<string, unknown>): Promise<void>
  queryTabs(query: { url: string }): Promise<{ id?: number; url?: string }[]>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  sendTabMessage(tabId: number, message: unknown): Promise<void>
  setBadge(text: string): void
  now(): number
}

// ツールバーアイコンのクリック本体。現在ページ URL を、最後に開いたノートブックへ
// ソース追加するためのオーケストレーション（storage / tabs / messaging）を行う。
export async function handleActionClick(clickedUrl: string | undefined, d: ActionDeps): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!')
    return
  }
  const got = await d.storageGet('lastNotebook')
  const last = got.lastNotebook as { id: string; title: string } | undefined
  if (!last) {
    // 対象が無い: NotebookLM を開いて「先に開いて」を促す
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
    d.setBadge('!')
    return
  }
  const id = last.id
  const pending: PendingImport = { notebookId: id, url: clickedUrl, ts: d.now() }
  await d.storageSet({ pendingImport: pending })
  d.setBadge('…')

  const tabs = await d.queryTabs({ url: `${NOTEBOOK_HOME}*` })
  const existing = tabs.find((t) => {
    if (t.id === undefined || !t.url) return false
    try {
      return parseNotebookId(new URL(t.url).pathname) === id
    } catch {
      return false
    }
  })
  if (existing?.id !== undefined) {
    await d.sendTabMessage(existing.id, { type: RUN_PENDING_MESSAGE })
  } else {
    await d.createTab({ url: notebookUrl(id), active: false })
  }
}

// content からのインポート結果でバッジを更新する。
export function handleImportResult(ok: boolean, d: Pick<ActionDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!')
}

// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境（テスト/一部 SW）では登録しない。
// chrome は @types/chrome のグローバル型を使う（既存 nlk:list-tabs ブロックと同じ）。declare は追加しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const clearLater = (t: string) => {
    if (t === '✓' || t === '!') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
  }
  const deps: ActionDeps = {
    storageGet: (k) => chrome.storage.local.get(k),
    storageSet: (i) => chrome.storage.local.set(i),
    queryTabs: (q) => chrome.tabs.query(q),
    createTab: (p) => chrome.tabs.create(p),
    sendTabMessage: (id, m) => chrome.tabs.sendMessage(id, m),
    setBadge: (text) => { void chrome.action.setBadgeText({ text }); clearLater(text) },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { url?: string }) => { void handleActionClick(tab?.url, deps) })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean } | null
    if (m?.type === IMPORT_RESULT_MESSAGE) handleImportResult(!!m.ok, deps)
  })
}
```

注記: 配線ブロック内で `chrome.action.onClicked.addListener` のコールバック引数 `tab` と onMessage の `sender` は、`@types/chrome` の型が付く。もし strict の `noImplicitAny` で暗黙 any になる箇所があれば、上記コードのように明示注釈（`(tab: { url?: string })` 等）で解消する。`declare const chrome` は追加しない（既存グローバル型と衝突するため）。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/background-action.test.ts tests/background.test.ts && npm run typecheck`
Expected: 両テストファイル PASS（既存 `background.test.ts` は `chrome.action` を stub していないため配線ブロックはスキップされ無影響）／型エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/background/main.ts tests/background-action.test.ts
git commit -m "feat(#36): background に action.onClicked オーケストレーションを追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: content 側 `initImport` 拡張（lastNotebook 保存・pending 実行・結果返信）

ノートブックページの `initImport` を拡張する: mount 時に `lastNotebook` を保存し、`handlePending` を mount 契機と `nlk:run-pending` 受信契機で呼ぶ。実行は既存 `runImport` を1件で再利用し、結果を background に返す。chrome / location / document への依存は `ImportEnv` として注入可能にする。

**Files:**
- Modify: `src/content/main.ts`（`initImport` と import 群）
- Test: `tests/import-wiring.test.ts`（新規）

**Interfaces:**
- Consumes: `parseNotebookId` / `parseNotebookTitle`（Task 1）、`handlePending` / `PendingEnv`（Task 3）、`RUN_PENDING_MESSAGE` / `IMPORT_RESULT_MESSAGE` / `ImportResult`（Task 2 / 既存 types）
- Produces:
  - `interface ImportEnv extends PendingEnv { getPathname(): string; getTitle(): string; storageSet(items: Record<string, unknown>): Promise<void>; addMessageListener(handler: (msg: unknown) => void): () => void; sendMessage(message: unknown): void }`
  - 変更後シグネチャ `initImport(root?: ParentNode, env?: ImportEnv): () => void`
  - `runImport` の戻り値を `Promise<ImportResult | null>` に変更

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/import-wiring.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initImport, type ImportEnv } from '../src/content/main'

function makeEnv(pathname: string, over: Partial<ImportEnv> = {}): ImportEnv & {
  set: ReturnType<typeof vi.fn>; listeners: ((msg: unknown) => void)[]; unsub: ReturnType<typeof vi.fn>
} {
  const listeners: ((msg: unknown) => void)[] = []
  const unsub = vi.fn()
  const set = vi.fn(async () => {})
  return {
    set, listeners, unsub,
    getPathname: () => pathname,
    getTitle: () => 'マイノート - NotebookLM',
    storageGet: vi.fn(async () => ({})),
    storageSet: set,
    storageRemove: vi.fn(async () => {}),
    now: () => 1000,
    addMessageListener: (h) => { listeners.push(h); return unsub },
    sendMessage: vi.fn(),
    ...over,
  }
}

describe('initImport wiring (F2-2)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('saves lastNotebook on mount when on a notebook page', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.set).toHaveBeenCalledWith({ lastNotebook: { id: 'abc-1', title: 'マイノート' } })
    dispose()
  })

  it('does not save lastNotebook when pathname is not a notebook page', () => {
    const env = makeEnv('/')
    const dispose = initImport(document, env)
    expect(env.set).not.toHaveBeenCalled()
    dispose()
  })

  it('unsubscribes the message listener on dispose', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.listeners.length).toBe(1)
    dispose()
    expect(env.unsub).toHaveBeenCalled()
  })

  it('checks pendingImport on mount (calls storageGet)', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.storageGet).toHaveBeenCalledWith('pendingImport')
    dispose()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/import-wiring.test.ts`
Expected: FAIL（`initImport` は現状 `env` 引数も `ImportEnv` export も持たない）

- [ ] **Step 3: 最小実装**

`src/content/main.ts` の import 群に追記:

```ts
import { parseNotebookId, parseNotebookTitle } from './notebook-id'
import { handlePending, type PendingEnv } from './pending-import'
```

`../types` からの import に `IMPORT_RESULT_MESSAGE`, `RUN_PENDING_MESSAGE`, `type ImportResult` を追加（既存の `makeTarget, type NotebookTarget` 行に足す）:

```ts
import {
  makeTarget, type NotebookTarget,
  IMPORT_RESULT_MESSAGE, RUN_PENDING_MESSAGE, type ImportResult,
} from '../types'
```

`initImport` の直前に `ImportEnv` と `defaultImportEnv` を追加:

```ts
export interface ImportEnv extends PendingEnv {
  getPathname(): string
  getTitle(): string
  storageSet(items: Record<string, unknown>): Promise<void>
  addMessageListener(handler: (msg: unknown) => void): () => void
  sendMessage(message: unknown): void
}

// 実 chrome / location / document への既定配線。chrome が無い環境（jsdom）でも
// 安全に no-op になるようガードする（既存の routing テストを壊さないため）。
function defaultImportEnv(): ImportEnv {
  const c = (globalThis as { chrome?: any }).chrome
  return {
    getPathname: () => (typeof location !== 'undefined' ? location.pathname : ''),
    getTitle: () => (typeof document !== 'undefined' ? document.title : ''),
    storageGet: (k) => c?.storage?.local?.get(k) ?? Promise.resolve({}),
    storageSet: (i) => c?.storage?.local?.set(i) ?? Promise.resolve(),
    storageRemove: (k) => c?.storage?.local?.remove(k) ?? Promise.resolve(),
    now: () => Date.now(),
    addMessageListener: (h) => {
      const om = c?.runtime?.onMessage
      if (!om) return () => {}
      const listener = (msg: unknown) => h(msg)
      om.addListener(listener)
      return () => om.removeListener(listener)
    },
    sendMessage: (m) => { void c?.runtime?.sendMessage?.(m) },
  }
}
```

`initImport` を変更する。シグネチャに `env` を足し、`runImport` の戻り値を `ImportResult | null` にし、mount 後に lastNotebook 保存・pending 配線・disposer で unsub を行う。以下が変更後の `initImport` 全体:

```ts
export function initImport(root: ParentNode = document, env: ImportEnv = defaultImportEnv()): () => void {
  const t = createT(detectLang())
  let currentAbort: AbortController | null = null
  let importing = false

  const panel = mountImportPanel({
    t,
    handlers: {
      onLoadTabs: () => listOpenTabs(),
      onStop: () => { currentAbort?.abort() },
      onImport: (urls) => { void runImport(urls) },
    },
  })

  async function runImport(urls: string[]): Promise<ImportResult | null> {
    if (importing || urls.length === 0) return null
    importing = true
    const ac = new AbortController()
    currentAbort = ac
    panel.setBusy(true)
    let result: ImportResult | null = null
    try {
      const deps: ImporterDeps = {
        getAddSourceButton: () => getAddSourceButton(root),
        getSourceDialog: () => getSourceDialog(),
        getWebsiteChip,
        getUrlInput: getSourceUrlInput,
        getSubmitButton: getSourceSubmitButton,
        setInputValue,
        click: (el) => { safeClick(el) },
        waitFor,
      }
      result = await importUrls(urls, deps, {
        signal: ac.signal,
        onProgress: (p) => panel.setProgress(t('importProgress', { done: p.completed, total: p.total })),
      })
      const rest = urls.length - result.succeeded.length - result.failed.length
      if (result.aborted) {
        panel.setProgress(t('importAborted', { ok: result.succeeded.length, rest }))
      } else if (result.failed.length > 0) {
        panel.setProgress(
          t('importFailedSummary', { ok: result.succeeded.length, ng: result.failed.length, rest }),
        )
      } else {
        panel.setProgress(t('importDone', { ok: result.succeeded.length, ng: 0 }))
      }
      panel.removeUrls(result.succeeded)
    } catch (err) {
      console.error('notebooklmkit: unexpected error during import', err)
      panel.setProgress(t('domError'))
    } finally {
      panel.setBusy(false)
      currentAbort = null
      importing = false
    }
    return result
  }

  // F2-2: 現在のノートブック id を storage に記録（ツールバーインポートの対象特定に使う）。
  const notebookId = parseNotebookId(env.getPathname())
  if (notebookId) {
    void env.storageSet({ lastNotebook: { id: notebookId, title: parseNotebookTitle(env.getTitle()) } })
  }

  // F2-2: pendingImport を1件インポートし、結果を background に返す。
  const runPending = () =>
    handlePending(
      notebookId,
      env,
      async (url) => {
        const r = await runImport([url])
        return !!r && r.failed.length === 0 && !r.aborted
      },
      (ok) => env.sendMessage({ type: IMPORT_RESULT_MESSAGE, ok }),
    )

  void runPending() // 新規タブ mount 経路
  const unsub = env.addMessageListener((msg) => {
    if ((msg as { type?: string } | null)?.type === RUN_PENDING_MESSAGE) void runPending() // 既存タブ経路
  })

  return () => {
    // SPA 遷移等で teardown されたら進行中のインポートも止める（issue #16 と同じ規約）
    currentAbort?.abort()
    unsub()
    panel.destroy()
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/import-wiring.test.ts tests/main-routing.test.ts tests/main-wiring.test.ts && npm run typecheck`
Expected: すべて PASS（既存 routing / wiring テストが `initImport` の default env で壊れないこと）／型エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/content/main.ts tests/import-wiring.test.ts
git commit -m "feat(#36): initImport に lastNotebook 保存と pending 実行を配線

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: E2E チェックリストに F2-2 節を追加

**Files:**
- Modify: `docs/e2e-checklist-phase2.md`

- [ ] **Step 1: F2-2 節を追加**

`docs/e2e-checklist-phase2.md` の「## 3. 中断・エラー」の直前に以下を挿入する:

```markdown
## 2.5 F2-2: 現在ページのワンクリックインポート

準備: ノートブックを1つ開いておく（= lastNotebook に記録される）。別タブで任意の http(s) ページを開く。

- [ ] http(s) ページでツールバーアイコンをクリックすると、最後に開いたノートブックにその URL がソース追加される
- [ ] クリック後もフォーカスは元の記事タブに留まる（対象ノートブックはバックグラウンドで処理）
- [ ] 対象ノートブックのタブが既に開いていればそれが使われ、無ければバックグラウンドで開かれる
- [ ] 成功でバッジが「✓」、失敗/想定外 DOM でバッジが「!」になる（数秒後に消える）
- [ ] ノートブックを一度も開いていない状態でクリックすると NotebookLM ホームが開き、バッジ「!」になる
- [ ] `chrome://` などの非 http(s) ページでは何も追加されず、バッジ「!」になる
- [ ] 権限が「notebooklm.google.com のデータの読み取りと変更」+「タブ」+「ストレージ」相当のみである

既知の制限:
- バックグラウンドタブでの DOM 自動化が不安定な場合はフォアグラウンド実行にフォールバックする（実機で要確認）。
- 同一ページを2回クリックすると2ソース追加される（重複検知なし）。
```

- [ ] **Step 2: コミット**

```bash
git add docs/e2e-checklist-phase2.md
git commit -m "docs(#36): E2E チェックリストに F2-2 節を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラー0

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: 全 PASS（新規 notebook-id / pending-import / background-action / import-wiring / types 追加分を含む）

- [ ] **Step 3: ビルド確認**

Run: `npm run build && node -e "const m=require('./dist/manifest.json'); console.log('perms', JSON.stringify(m.permissions), 'action', JSON.stringify(m.action), 'host', JSON.stringify(m.host_permissions))"`
Expected: `perms ["tabs","storage"] action {} host ["https://notebooklm.google.com/*"]`（host_permissions 据え置き）

---

## Self-Review

**Spec coverage（spec §9 受け入れ基準との対応）:**
- http/https ページでクリック→最後に開いたノートブックへ追加 → Task 4（handleActionClick）＋ Task 5（pending 実行）✅
- 記事タブにフォーカスが留まる（バックグラウンド）→ Task 4（`createTab active:false` / 既存タブへメッセージ）✅
- lastNotebook 未設定時ホームを開きバッジ → Task 4（no-lastNotebook 分岐）✅
- 非 http(s) は no-op＋バッジ → Task 4（isHttpUrl 分岐）✅
- 成功/失敗がバッジで分かる → Task 4（handleImportResult）＋ Task 5（結果返信）✅
- 追加権限 storage のみ・host 据え置き → Task 2 ＋ Task 7 Step 3 で検証 ✅
- typecheck / test 緑 → Task 7 ✅
- lastNotebook 保存（spec §4.2）→ Task 5 ✅
- pendingImport local＋ts 古さガード（spec §4.4）→ Task 3（handlePending）＋ Task 2（定数）✅
- notebook id 抽出（spec §4.1）→ Task 1 ✅
- E2E F2-2 節（spec §8）→ Task 6 ✅

**Placeholder scan:** TBD / TODO なし。各コード step に実コードあり。

**Type consistency:**
- `PendingImport { notebookId, url, ts }` は Task 2 定義、Task 3（handlePending）/ Task 4（handleActionClick）で同一に使用。
- `lastNotebook { id, title }` は Task 4（読み取り）/ Task 5（書き込み）で同形。
- メッセージ種別 `RUN_PENDING_MESSAGE` / `IMPORT_RESULT_MESSAGE` は Task 2 定義、Task 4 / Task 5 で参照。
- `handlePending(notebookId, env: PendingEnv, run, report)` のシグネチャは Task 3 定義、Task 5 で `ImportEnv extends PendingEnv` を渡して使用（型互換）。
- `runImport` 戻り値変更 `Promise<ImportResult | null>` は Task 5 内で完結（`onImport` は戻り値を無視、`runPending` の runner が使用）。
- `parseNotebookId(pathname): string | null` は Task 1 定義、Task 4（タブ照合）/ Task 5（現在ページ）で使用。
