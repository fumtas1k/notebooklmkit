# Phase 1: ノートブック一括削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NotebookLM ダッシュボードに複数選択と一括削除（上部スティッキーバー + 行チェックボックス）を DOM 自動化で追加する。

**Architecture:** content script 中心の MV3 拡張。DOM 依存を `selectors.ts` に集約し、`dom-utils` / `selection` / `deleter` / `confirm-dialog` を依存注入で純粋寄りに保ち jsdom で単体テストする。削除は「対象を先に確定 → 1件ずつ メニュー→削除→確認Delete を逐次実行」。

**Tech Stack:** TypeScript, Vite + `@crxjs/vite-plugin`, Vitest + jsdom。

## Global Constraints

- 対象URL / 権限: `host_permissions` は `https://notebooklm.google.com/*` のみ。`permissions` は空（Phase 1 は content script 完結）。
- 外部ネットワーク送信ゼロ。分析トラッカー等を入れない。
- DOM セレクタは `src/content/selectors.ts` の1ファイルにのみ書く。他モジュールは selectors 経由か、DOM ノード/関数を引数で受け取る。
- 破壊的操作（削除）は必ず件数確認を挟む。選択件数が 10 件以上、または全選択のときは「件数タイプ確認」。
- i18n: ja / en の2言語。ハードコードした日本語文言を UI に直接書かない（`i18n.ts` 経由）。
- 内部ID（`jslog`）はログ出力しない（機密扱い）。
- TypeScript strict。テストは Vitest + jsdom。各タスク末尾でコミット。

---

## File Structure

- `package.json`, `tsconfig.json`, `vite.config.ts`, `manifest.config.ts` — ツール/ビルド/マニフェスト
- `src/types.ts` — 共有型
- `src/content/selectors.ts` — DOM セレクタ集約（§8.5）
- `src/content/dom-utils.ts` — `waitFor` / `safeClick` / `delay`
- `src/content/selection.ts` — 選択状態ストア
- `src/content/i18n.ts` — ja/en 文言
- `src/content/confirm-dialog.ts` — 閾値判定 + 件数タイプ確認ダイアログ
- `src/content/deleter.ts` — 削除オーケストレータ（依存注入）
- `src/content/ui/row-checkbox.ts` — 行へのチェックボックス注入
- `src/content/ui/action-bar.ts` — 上部スティッキーバー
- `src/content/main.ts` — エントリ（検知・注入・配線・MutationObserver）
- `tests/**` — 各モジュールの Vitest
- `docs/e2e-checklist-phase1.md` — 手動E2Eチェックリスト

---

### Task 1: プロジェクト雛形とツールチェーン

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `manifest.config.ts`, `src/content/main.ts`, `tests/smoke.test.ts`, `.gitignore`(既存に追記不要ならそのまま)

**Interfaces:**
- Produces: 動作するビルド（`npm run build` が `dist/manifest.json` を生成）とテスト基盤（`npm test`）。

- [ ] **Step 1: `package.json` を作成**

```json
{
  "name": "notebooklmkit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.23",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "lib": ["ES2021", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "tests", "manifest.config.ts", "vite.config.ts"]
}
```

（`@types/chrome` を devDependencies に追加してよい。型が無ければ `types` から `chrome` を外す。）

- [ ] **Step 3: `manifest.config.ts` を作成**

```ts
import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'notebooklmkit',
  version: '0.1.0',
  description: 'Bulk multi-select delete for NotebookLM notebooks.',
  host_permissions: ['https://notebooklm.google.com/*'],
  content_scripts: [
    {
      matches: ['https://notebooklm.google.com/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})
```

- [ ] **Step 4: `vite.config.ts` を作成**

```ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [crx({ manifest })],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 5: 最小 `src/content/main.ts` を作成**

```ts
// Phase 1 entry point. Wiring is added in later tasks.
export const VERSION = '0.1.0'
```

- [ ] **Step 6: スモークテスト `tests/smoke.test.ts` を作成**

```ts
import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/content/main'

describe('smoke', () => {
  it('exposes version and has a DOM (jsdom)', () => {
    expect(VERSION).toBe('0.1.0')
    document.body.innerHTML = '<div id="x"></div>'
    expect(document.getElementById('x')).not.toBeNull()
  })
})
```

- [ ] **Step 7: 依存インストールとテスト実行**

Run: `npm install && npm test`
Expected: 1 test file, 1 passed。

- [ ] **Step 8: ビルド確認**

Run: `npm run build`
Expected: `dist/manifest.json` が生成され、`host_permissions` に notebooklm のみが含まれる。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold MV3 extension with Vite/CRXJS and Vitest"
```

---

### Task 2: 共有型 (`types.ts`)

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces:
  - `RowIdentity = { title: string; jslog: string | null }`
  - `NotebookTarget = RowIdentity & { key: string }`
  - `DeleteProgress = { total: number; completed: number; failed: number; currentTitle?: string }`
  - `DeleteResult = { succeeded: string[]; failed: { key: string; reason: string }[]; aborted: boolean }`

- [ ] **Step 1: 失敗するテストを書く `tests/types.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'

describe('makeTarget', () => {
  it('uses jslog as key when present', () => {
    expect(makeTarget({ title: 'A', jslog: 'id-1' }).key).toBe('id-1')
  })
  it('falls back to title when jslog is null', () => {
    expect(makeTarget({ title: 'A', jslog: null }).key).toBe('title:A')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL（`makeTarget` 未定義）。

- [ ] **Step 3: `src/types.ts` を実装**

```ts
export interface RowIdentity {
  title: string
  jslog: string | null
}

export interface NotebookTarget extends RowIdentity {
  key: string
}

export interface DeleteProgress {
  total: number
  completed: number
  failed: number
  currentTitle?: string
}

export interface DeleteResult {
  succeeded: string[]
  failed: { key: string; reason: string }[]
  aborted: boolean
}

export function makeTarget(id: RowIdentity): NotebookTarget {
  const key = id.jslog ?? `title:${id.title}`
  return { ...id, key }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared types and target key derivation"
```

---

### Task 3: DOM セレクタ集約 (`selectors.ts`)

**Files:**
- Create: `src/content/selectors.ts`
- Test: `tests/selectors.test.ts`

**Interfaces:**
- Consumes: `RowIdentity` from `src/types.ts`.
- Produces:
  - `getNotebookRows(root?: ParentNode): HTMLElement[]`
  - `getRowIdentity(row: HTMLElement): RowIdentity`
  - `findRowByIdentity(id: RowIdentity, root?: ParentNode): HTMLElement | null`
  - `getMoreButton(row: HTMLElement): HTMLElement | null`
  - `getDeleteMenuItem(root?: ParentNode): HTMLElement | null`
  - `getConfirmDialog(root?: ParentNode): HTMLElement | null`
  - `getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null`

- [ ] **Step 1: フィクスチャ付きの失敗テストを書く `tests/selectors.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
} from '../src/content/selectors'

const LIST_HTML = `
<div class="all-projects-container"><div class="my-projects-container">
  <project-table><table class="project-table"><tbody>
    <tr mat-row role="row" jslog="12345;track:xyz">
      <td class="title-column"><span class="project-table-emoji">📘</span><span class="project-table-title">Alpha</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more" aria-label="プロジェクトの操作メニュー"></button></project-action-button></td>
    </tr>
    <tr mat-row role="row">
      <td class="title-column"><span class="project-table-title">Beta</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td>
    </tr>
  </tbody></table></project-table>
</div></div>`

const MENU_HTML = `
<div class="cdk-overlay-container">
  <button class="mat-mdc-menu-item delete-button">削除</button>
</div>`

const DIALOG_HTML = `
<mat-dialog-container>
  <button class="primary-button">Delete</button>
  <button class="tertiary-button">キャンセル</button>
</mat-dialog-container>`

describe('selectors', () => {
  beforeEach(() => { document.body.innerHTML = LIST_HTML })

  it('lists all notebook rows', () => {
    expect(getNotebookRows().length).toBe(2)
  })

  it('reads identity with jslog and title', () => {
    const [row] = getNotebookRows()
    expect(getRowIdentity(row)).toEqual({ title: 'Alpha', jslog: '12345;track:xyz' })
  })

  it('reads identity with null jslog', () => {
    const row = getNotebookRows()[1]
    expect(getRowIdentity(row)).toEqual({ title: 'Beta', jslog: null })
  })

  it('finds a row by identity (jslog preferred)', () => {
    const found = findRowByIdentity({ title: 'Alpha', jslog: '12345;track:xyz' })
    expect(found).not.toBeNull()
    expect(getRowIdentity(found!).title).toBe('Alpha')
  })

  it('finds a row by title when jslog is null', () => {
    const found = findRowByIdentity({ title: 'Beta', jslog: null })
    expect(getRowIdentity(found!).title).toBe('Beta')
  })

  it('returns null when the row is gone', () => {
    expect(findRowByIdentity({ title: 'Ghost', jslog: null })).toBeNull()
  })

  it('gets the more button of a row', () => {
    const [row] = getNotebookRows()
    expect(getMoreButton(row)?.classList.contains('project-button-more')).toBe(true)
  })

  it('gets delete menu item, confirm dialog and delete button', () => {
    document.body.innerHTML = MENU_HTML
    expect(getDeleteMenuItem()?.textContent).toBe('削除')
    document.body.innerHTML = DIALOG_HTML
    const dialog = getConfirmDialog()!
    expect(dialog).not.toBeNull()
    expect(getConfirmDeleteButton(dialog)?.textContent).toBe('Delete')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/selectors.test.ts`
Expected: FAIL（モジュール未実装）。

- [ ] **Step 3: `src/content/selectors.ts` を実装**

```ts
import type { RowIdentity } from '../types'

// §8.5 の実 DOM 調査に基づくセレクタ。UI 変更時はこのファイルのみ修正する。
export const SELECTORS = {
  row: 'project-table table.project-table tbody tr[mat-row][role="row"]',
  title: 'span.project-table-title',
  moreButton: 'project-action-button button.project-button-more',
  deleteMenuItem: '.cdk-overlay-container button.mat-mdc-menu-item.delete-button',
  confirmDialog: 'mat-dialog-container',
  confirmDeleteButton: 'button.primary-button',
  cancelButton: 'button.tertiary-button',
} as const

export function getNotebookRows(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTORS.row))
}

export function getRowIdentity(row: HTMLElement): RowIdentity {
  const title = row.querySelector(SELECTORS.title)?.textContent?.trim() ?? ''
  const jslog = row.getAttribute('jslog')
  return { title, jslog: jslog && jslog.length > 0 ? jslog : null }
}

export function findRowByIdentity(id: RowIdentity, root: ParentNode = document): HTMLElement | null {
  const rows = getNotebookRows(root)
  if (id.jslog) {
    const byJslog = rows.find((r) => r.getAttribute('jslog') === id.jslog)
    if (byJslog) return byJslog
  }
  return rows.find((r) => getRowIdentity(r).title === id.title) ?? null
}

export function getMoreButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.moreButton)
}

export function getDeleteMenuItem(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.deleteMenuItem)
}

export function getConfirmDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.confirmDialog)
}

export function getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(SELECTORS.confirmDeleteButton)
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/selectors.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 5: Commit**

```bash
git add src/content/selectors.ts tests/selectors.test.ts
git commit -m "feat: add DOM selectors module for NotebookLM list"
```

---

### Task 4: DOM ユーティリティ (`dom-utils.ts`)

**Files:**
- Create: `src/content/dom-utils.ts`
- Test: `tests/dom-utils.test.ts`

**Interfaces:**
- Produces:
  - `waitFor<T>(fn: () => T | null | undefined, opts?: { timeout?: number; interval?: number; signal?: AbortSignal }): Promise<T>`
  - `safeClick(el: HTMLElement | null | undefined): boolean`
  - `delay(ms: number, signal?: AbortSignal): Promise<void>`
  - `class AbortError extends Error` / `class TimeoutError extends Error`

- [ ] **Step 1: 失敗テストを書く `tests/dom-utils.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitFor, safeClick, delay, TimeoutError, AbortError } from '../src/content/dom-utils'

afterEach(() => vi.useRealTimers())

describe('waitFor', () => {
  it('resolves as soon as fn returns truthy', async () => {
    let n = 0
    const v = await waitFor(() => (++n >= 3 ? 'ok' : null), { interval: 1, timeout: 1000 })
    expect(v).toBe('ok')
  })

  it('rejects with TimeoutError when never truthy', async () => {
    await expect(waitFor(() => null, { interval: 1, timeout: 20 })).rejects.toBeInstanceOf(TimeoutError)
  })

  it('rejects with AbortError when signal aborts', async () => {
    const ac = new AbortController()
    const p = waitFor(() => null, { interval: 5, timeout: 1000, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AbortError)
  })
})

describe('safeClick', () => {
  it('clicks and returns true for an element', () => {
    const btn = document.createElement('button')
    const spy = vi.fn()
    btn.addEventListener('click', spy)
    expect(safeClick(btn)).toBe(true)
    expect(spy).toHaveBeenCalledOnce()
  })
  it('returns false for null', () => {
    expect(safeClick(null)).toBe(false)
  })
})

describe('delay', () => {
  it('rejects immediately if already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(delay(10, ac.signal)).rejects.toBeInstanceOf(AbortError)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/dom-utils.test.ts`
Expected: FAIL（モジュール未実装）。

- [ ] **Step 3: `src/content/dom-utils.ts` を実装**

```ts
export class TimeoutError extends Error {
  constructor(message = 'waitFor timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export function waitFor<T>(
  fn: () => T | null | undefined,
  opts: { timeout?: number; interval?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { timeout = 5000, interval = 100, signal } = opts
  return new Promise<T>((resolve, reject) => {
    const start = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortError())
    }
    if (signal?.aborted) return reject(new AbortError())
    signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      if (signal?.aborted) return
      let value: T | null | undefined
      try {
        value = fn()
      } catch (err) {
        signal?.removeEventListener('abort', onAbort)
        return reject(err)
      }
      if (value) {
        signal?.removeEventListener('abort', onAbort)
        return resolve(value)
      }
      if (Date.now() - start >= timeout) {
        signal?.removeEventListener('abort', onAbort)
        return reject(new TimeoutError())
      }
      timer = setTimeout(tick, interval)
    }
    tick()
  })
}

export function safeClick(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  el.click()
  return true
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/dom-utils.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/content/dom-utils.ts tests/dom-utils.test.ts
git commit -m "feat: add DOM utilities (waitFor/safeClick/delay)"
```

---

### Task 5: 選択状態ストア (`selection.ts`)

**Files:**
- Create: `src/content/selection.ts`
- Test: `tests/selection.test.ts`

**Interfaces:**
- Produces: `class SelectionStore` with
  - `toggle(key: string): void`
  - `set(key: string, on: boolean): void`
  - `has(key: string): boolean`
  - `replaceAll(keys: string[]): void`
  - `clear(): void`
  - `get size(): number`
  - `keys(): string[]`
  - `onChange(cb: (size: number) => void): () => void`  // returns unsubscribe

- [ ] **Step 1: 失敗テストを書く `tests/selection.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { SelectionStore } from '../src/content/selection'

describe('SelectionStore', () => {
  it('toggles and reports membership and size', () => {
    const s = new SelectionStore()
    s.toggle('a'); s.toggle('b'); s.toggle('a')
    expect(s.has('a')).toBe(false)
    expect(s.has('b')).toBe(true)
    expect(s.size).toBe(1)
    expect(s.keys()).toEqual(['b'])
  })

  it('set on/off explicitly', () => {
    const s = new SelectionStore()
    s.set('a', true); s.set('a', true); s.set('b', false)
    expect(s.size).toBe(1)
    s.set('a', false)
    expect(s.size).toBe(0)
  })

  it('replaceAll replaces the selection (select-all)', () => {
    const s = new SelectionStore()
    s.toggle('x')
    s.replaceAll(['a', 'b', 'c'])
    expect(s.size).toBe(3)
    expect(s.has('x')).toBe(false)
  })

  it('clear empties selection', () => {
    const s = new SelectionStore()
    s.replaceAll(['a', 'b'])
    s.clear()
    expect(s.size).toBe(0)
  })

  it('notifies subscribers with new size and can unsubscribe', () => {
    const s = new SelectionStore()
    const cb = vi.fn()
    const off = s.onChange(cb)
    s.toggle('a')
    expect(cb).toHaveBeenLastCalledWith(1)
    off()
    s.toggle('b')
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/selection.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/selection.ts` を実装**

```ts
export class SelectionStore {
  private selected = new Set<string>()
  private listeners = new Set<(size: number) => void>()

  toggle(key: string): void {
    if (this.selected.has(key)) this.selected.delete(key)
    else this.selected.add(key)
    this.emit()
  }

  set(key: string, on: boolean): void {
    const before = this.selected.size
    if (on) this.selected.add(key)
    else this.selected.delete(key)
    if (this.selected.size !== before) this.emit()
  }

  has(key: string): boolean {
    return this.selected.has(key)
  }

  replaceAll(keys: string[]): void {
    this.selected = new Set(keys)
    this.emit()
  }

  clear(): void {
    if (this.selected.size === 0) return
    this.selected.clear()
    this.emit()
  }

  get size(): number {
    return this.selected.size
  }

  keys(): string[] {
    return Array.from(this.selected)
  }

  onChange(cb: (size: number) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.selected.size)
  }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/selection.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/content/selection.ts tests/selection.test.ts
git commit -m "feat: add selection store"
```

---

### Task 6: i18n 文言 (`i18n.ts`)

**Files:**
- Create: `src/content/i18n.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = 'ja' | 'en'`
  - `type MsgKey`（下記キー）
  - `detectLang(nav?: { language: string }): Lang`
  - `createT(lang: Lang): (key: MsgKey, vars?: Record<string, string | number>) => string`

- [ ] **Step 1: 失敗テストを書く `tests/i18n.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { detectLang, createT } from '../src/content/i18n'

describe('i18n', () => {
  it('detects ja and en, defaults to en', () => {
    expect(detectLang({ language: 'ja-JP' })).toBe('ja')
    expect(detectLang({ language: 'en-US' })).toBe('en')
    expect(detectLang({ language: 'fr-FR' })).toBe('en')
  })

  it('interpolates variables', () => {
    const t = createT('ja')
    expect(t('deleteSelected', { count: 3 })).toContain('3')
    const te = createT('en')
    expect(te('deleteSelected', { count: 3 })).toContain('3')
  })

  it('falls back to the key when missing (never throws)', () => {
    const t = createT('en')
    // @ts-expect-error unknown key
    expect(t('nope')).toBe('nope')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/i18n.ts` を実装**

```ts
export type Lang = 'ja' | 'en'

const MESSAGES = {
  ja: {
    selectAll: 'すべて選択',
    deselectAll: 'すべて解除',
    selectedCount: '{count}件選択中',
    deleteSelected: '選択した{count}件を削除',
    confirmTitle: '{count}件のノートブックを削除します',
    confirmBody: 'この操作は取り消せません。',
    confirmType: '確認のため {count} と入力してください',
    cancel: 'キャンセル',
    deleteNow: '削除',
    progress: '{done} / {total} 削除中…',
    doneSummary: '完了: 成功 {ok}件 / 失敗 {ng}件',
    abort: '中断',
    domError: 'NotebookLM の画面構造が想定と異なるため中断しました',
  },
  en: {
    selectAll: 'Select all',
    deselectAll: 'Clear all',
    selectedCount: '{count} selected',
    deleteSelected: 'Delete {count} selected',
    confirmTitle: 'Delete {count} notebook(s)',
    confirmBody: 'This action cannot be undone.',
    confirmType: 'Type {count} to confirm',
    cancel: 'Cancel',
    deleteNow: 'Delete',
    progress: 'Deleting {done} / {total}…',
    doneSummary: 'Done: {ok} succeeded / {ng} failed',
    abort: 'Stop',
    domError: 'Stopped: NotebookLM UI structure did not match expectations',
  },
} as const

export type MsgKey = keyof (typeof MESSAGES)['en']

export function detectLang(nav: { language: string } = navigator): Lang {
  return nav.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function createT(lang: Lang) {
  return (key: MsgKey, vars: Record<string, string | number> = {}): string => {
    const table = MESSAGES[lang] as Record<string, string>
    const template = table[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_m, name) =>
      name in vars ? String(vars[name]) : `{${name}}`,
    )
  }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/content/i18n.ts tests/i18n.test.ts
git commit -m "feat: add ja/en i18n messages"
```

---

### Task 7: 確認ロジック + ダイアログ (`confirm-dialog.ts`)

**Files:**
- Create: `src/content/confirm-dialog.ts`
- Test: `tests/confirm-dialog.test.ts`

**Interfaces:**
- Consumes: `createT` from `i18n.ts`.
- Produces:
  - `STRONG_CONFIRM_THRESHOLD = 10`
  - `needsStrongConfirm(count: number, isSelectAll: boolean): boolean`
  - `isConfirmInputValid(input: string, count: number): boolean`
  - `confirmDeletion(opts: { count: number; isSelectAll: boolean; t: ReturnType<typeof createT>; root?: HTMLElement }): Promise<boolean>`

- [ ] **Step 1: 失敗テストを書く `tests/confirm-dialog.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  needsStrongConfirm, isConfirmInputValid, confirmDeletion, STRONG_CONFIRM_THRESHOLD,
} from '../src/content/confirm-dialog'
import { createT } from '../src/content/i18n'

const t = createT('en')

describe('confirm logic', () => {
  it('threshold is 10', () => {
    expect(STRONG_CONFIRM_THRESHOLD).toBe(10)
  })
  it('requires strong confirm for >=10 or select-all', () => {
    expect(needsStrongConfirm(9, false)).toBe(false)
    expect(needsStrongConfirm(10, false)).toBe(true)
    expect(needsStrongConfirm(2, true)).toBe(true)
  })
  it('validates typed count', () => {
    expect(isConfirmInputValid('47', 47)).toBe(true)
    expect(isConfirmInputValid(' 47 ', 47)).toBe(true)
    expect(isConfirmInputValid('46', 47)).toBe(false)
    expect(isConfirmInputValid('', 47)).toBe(false)
  })
})

describe('confirmDeletion (normal, small count)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('resolves true when confirm clicked', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const btn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    expect(btn.disabled).toBe(false) // small count: enabled immediately
    btn.click()
    expect(await p).toBe(true)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull() // cleaned up
  })

  it('resolves false when cancel clicked', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })
})

describe('confirmDeletion (strong, type-to-confirm)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps confirm disabled until typed count matches', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!
    expect(ok.disabled).toBe(true)
    input.value = '11'; input.dispatchEvent(new Event('input'))
    expect(ok.disabled).toBe(true)
    input.value = '12'; input.dispatchEvent(new Event('input'))
    expect(ok.disabled).toBe(false)
    ok.click()
    expect(await p).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/confirm-dialog.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/confirm-dialog.ts` を実装**

```ts
import type { createT } from './i18n'

export const STRONG_CONFIRM_THRESHOLD = 10

export function needsStrongConfirm(count: number, isSelectAll: boolean): boolean {
  return isSelectAll || count >= STRONG_CONFIRM_THRESHOLD
}

export function isConfirmInputValid(input: string, count: number): boolean {
  return input.trim() === String(count)
}

export function confirmDeletion(opts: {
  count: number
  isSelectAll: boolean
  t: ReturnType<typeof createT>
  root?: HTMLElement
}): Promise<boolean> {
  const { count, isSelectAll, t, root = document.body } = opts
  const strong = needsStrongConfirm(count, isSelectAll)

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-nlk', 'confirm-dialog')
    overlay.className = 'nlk-overlay'

    const box = document.createElement('div')
    box.className = 'nlk-dialog'

    const title = document.createElement('h2')
    title.textContent = t('confirmTitle', { count })

    const body = document.createElement('p')
    body.textContent = t('confirmBody')

    box.append(title, body)

    let input: HTMLInputElement | null = null
    const ok = document.createElement('button')
    ok.setAttribute('data-nlk', 'confirm-ok')
    ok.textContent = t('deleteNow')

    if (strong) {
      const label = document.createElement('label')
      label.textContent = t('confirmType', { count })
      input = document.createElement('input')
      input.setAttribute('data-nlk', 'confirm-input')
      input.type = 'text'
      ok.disabled = true
      input.addEventListener('input', () => {
        ok.disabled = !isConfirmInputValid(input!.value, count)
      })
      label.appendChild(input)
      box.appendChild(label)
    }

    const cancel = document.createElement('button')
    cancel.setAttribute('data-nlk', 'confirm-cancel')
    cancel.textContent = t('cancel')

    const cleanup = (result: boolean) => {
      overlay.remove()
      resolve(result)
    }
    ok.addEventListener('click', () => cleanup(true))
    cancel.addEventListener('click', () => cleanup(false))

    box.append(cancel, ok)
    overlay.appendChild(box)
    root.appendChild(overlay)
    input?.focus()
  })
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/confirm-dialog.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/content/confirm-dialog.ts tests/confirm-dialog.test.ts
git commit -m "feat: add confirm dialog with type-to-confirm for bulk delete"
```

---

### Task 8: 削除オーケストレータ (`deleter.ts`)

**Files:**
- Create: `src/content/deleter.ts`
- Test: `tests/deleter.test.ts`

**Interfaces:**
- Consumes: `NotebookTarget`, `DeleteProgress`, `DeleteResult` from `types.ts`; `waitFor` from `dom-utils.ts`.
- Produces:
  - `interface DeleterDeps { findRow(t: NotebookTarget): HTMLElement | null; getMoreButton(row: HTMLElement): HTMLElement | null; getDeleteMenuItem(): HTMLElement | null; getConfirmDialog(): HTMLElement | null; getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null; click(el: HTMLElement): void; waitFor: typeof import('./dom-utils').waitFor; timeout?: number }`
  - `deleteNotebooks(targets: NotebookTarget[], deps: DeleterDeps, opts?: { onProgress?: (p: DeleteProgress) => void; signal?: AbortSignal }): Promise<DeleteResult>`

- [ ] **Step 1: 失敗テストを書く `tests/deleter.test.ts`**

このテストは実 DOM を使わず、依存注入したモックで「対象を先に確定 → 1件ずつ削除 → 行が消える」を模擬する。`waitFor` は本物（`interval` を小さく）を渡す。

```ts
import { describe, it, expect, vi } from 'vitest'
import { deleteNotebooks, type DeleterDeps } from '../src/content/deleter'
import { waitFor } from '../src/content/dom-utils'
import { makeTarget, type NotebookTarget } from '../src/types'

// 削除対象の世界を配列で表現するフェイク DOM。
function makeWorld(titles: string[]) {
  const present = new Set(titles)
  const el = (name: string) => {
    const e = document.createElement('div'); e.dataset.name = name; return e
  }
  let menuOpenFor: string | null = null
  let dialogOpenFor: string | null = null

  const deps: DeleterDeps = {
    findRow: (t) => (present.has(t.title) ? el(t.title) : null),
    getMoreButton: (row) => {
      const b = el('more'); b.dataset.for = row.dataset.name!; return b
    },
    getDeleteMenuItem: () => (menuOpenFor ? el('delete') : null),
    getConfirmDialog: () => (dialogOpenFor ? el('dialog') : null),
    getConfirmDeleteButton: () => el('confirm'),
    click: (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpenFor = e.dataset.for ?? null
      else if (name === 'delete') { dialogOpenFor = menuOpenFor; menuOpenFor = null }
      else if (name === 'confirm') {
        if (dialogOpenFor) present.delete(dialogOpenFor)
        dialogOpenFor = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, present }
}

const targets = (...names: string[]): NotebookTarget[] =>
  names.map((n) => makeTarget({ title: n, jslog: null }))

describe('deleteNotebooks', () => {
  it('deletes all targets sequentially and reports progress', async () => {
    const { deps, present } = makeWorld(['A', 'B', 'C'])
    const progress = vi.fn()
    const res = await deleteNotebooks(targets('A', 'B', 'C'), deps, { onProgress: progress })
    expect(res.succeeded.length).toBe(3)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(present.size).toBe(0)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 3, completed: 3, failed: 0 }),
    )
  })

  it('records a failure when a row never disappears, and stops', async () => {
    const { deps } = makeWorld(['A', 'B'])
    // confirm click は行を消さないよう差し替え → 消滅待ちがタイムアウト
    deps.click = (e) => { if (e.dataset.name === 'more') {/* open menu */} }
    // getDeleteMenuItem を常に返し、confirm も返すが、行は残り続ける
    deps.getDeleteMenuItem = () => document.createElement('div')
    deps.getConfirmDialog = () => document.createElement('div')
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(res.succeeded.length).toBe(0)
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].key).toBe('title:A')
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld(['A', 'B', 'C'])
    const ac = new AbortController()
    let count = 0
    const wrapped = { ...deps, click: (e: HTMLElement) => {
      deps.click(e)
      if (e.dataset.name === 'confirm') { count++; if (count === 1) ac.abort() }
    } }
    const res = await deleteNotebooks(targets('A', 'B', 'C'), wrapped, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded.length).toBe(1) // 1件完了後に中断
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/deleter.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/deleter.ts` を実装**

```ts
import type { DeleteProgress, DeleteResult, NotebookTarget } from '../types'
import type { waitFor as WaitFor } from './dom-utils'

export interface DeleterDeps {
  findRow(t: NotebookTarget): HTMLElement | null
  getMoreButton(row: HTMLElement): HTMLElement | null
  getDeleteMenuItem(): HTMLElement | null
  getConfirmDialog(): HTMLElement | null
  getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// 1件の削除は最後まで完了させる（中断は「処理中の1件完了後」に効かせる方針のため、
// ここでは signal を渡さない。要素待ちは timeout で守る）。
async function deleteOne(target: NotebookTarget, deps: DeleterDeps): Promise<void> {
  const timeout = deps.timeout ?? 5000
  const w = deps.waitFor

  // ① 対象行を（再描画後も）確定
  const row = await w(() => deps.findRow(target), { timeout })
  // ② 操作メニューを開く
  const more = deps.getMoreButton(row)
  if (!more) throw new Error('more button not found')
  deps.click(more)
  // ③ メニューの「削除」
  const del = await w(() => deps.getDeleteMenuItem(), { timeout })
  deps.click(del)
  // ④ 確認ダイアログの Delete
  const dialog = await w(() => deps.getConfirmDialog(), { timeout })
  const confirm = deps.getConfirmDeleteButton(dialog)
  if (!confirm) throw new Error('confirm delete button not found')
  deps.click(confirm)
  // ⑤ 行が DOM から消えるまで待つ
  await w(() => (deps.findRow(target) ? null : true), { timeout })
}

export async function deleteNotebooks(
  targets: NotebookTarget[],
  deps: DeleterDeps,
  opts: { onProgress?: (p: DeleteProgress) => void; signal?: AbortSignal } = {},
): Promise<DeleteResult> {
  const { onProgress, signal } = opts
  const result: DeleteResult = { succeeded: [], failed: [], aborted: false }
  const total = targets.length
  const report = (currentTitle?: string) =>
    onProgress?.({ total, completed: result.succeeded.length, failed: result.failed.length, currentTitle })

  for (const target of targets) {
    // 中断は各アイテムの境界でのみ判定（処理中の1件は完了させる）
    if (signal?.aborted) {
      result.aborted = true
      break
    }
    report(target.title)
    try {
      await deleteOne(target, deps)
      result.succeeded.push(target.key)
    } catch (err) {
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ key: target.key, reason: (err as Error).message })
      break
    }
  }
  report()
  return result
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/deleter.test.ts`
Expected: PASS（3ケース）。

- [ ] **Step 5: 全テスト＋型チェック**

Run: `npm run typecheck && npm test`
Expected: 型エラー無し、全テスト PASS。

- [ ] **Step 6: Commit**

```bash
git add src/content/deleter.ts tests/deleter.test.ts
git commit -m "feat: add sequential delete orchestrator with progress/abort"
```

---

### Task 9: 行チェックボックス注入 (`ui/row-checkbox.ts`)

**Files:**
- Create: `src/content/ui/row-checkbox.ts`
- Test: `tests/row-checkbox.test.ts`

**Interfaces:**
- Consumes: `getNotebookRows`, `getRowIdentity` from `selectors.ts`; `makeTarget` from `types.ts`; `SelectionStore` from `selection.ts`.
- Produces:
  - `injectRowCheckboxes(store: SelectionStore, root?: ParentNode): void`（各行に1個のみ注入。冪等）
  - `CHECKBOX_ATTR = 'data-nlk-checkbox'`

- [ ] **Step 1: 失敗テストを書く `tests/row-checkbox.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { injectRowCheckboxes, CHECKBOX_ATTR } from '../src/content/ui/row-checkbox'
import { SelectionStore } from '../src/content/selection'

const LIST = `
<project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td></tr>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td></tr>
</tbody></table></project-table>`

describe('injectRowCheckboxes', () => {
  beforeEach(() => { document.body.innerHTML = LIST })

  it('injects exactly one checkbox per row and is idempotent', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    injectRowCheckboxes(store)
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
  })

  it('checking a box updates the selection store', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const first = document.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    first.checked = true
    first.dispatchEvent(new Event('change'))
    expect(store.size).toBe(1)
    expect(store.has('title:A')).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/ui/row-checkbox.ts` を実装**

```ts
import { getNotebookRows, getRowIdentity } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    if (row.querySelector(`[${CHECKBOX_ATTR}]`)) continue // 冪等
    const id = getRowIdentity(row)
    const target = makeTarget(id)

    const cell = document.createElement('td')
    cell.className = 'nlk-checkbox-cell'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    box.checked = store.has(target.key)
    box.addEventListener('change', () => store.set(target.key, box.checked))
    cell.appendChild(box)
    row.insertBefore(cell, row.firstChild)
  }
}
```

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/content/ui/row-checkbox.ts tests/row-checkbox.test.ts
git commit -m "feat: inject per-row selection checkboxes"
```

---

### Task 10: 上部スティッキー アクションバー (`ui/action-bar.ts`)

**Files:**
- Create: `src/content/ui/action-bar.ts`, `src/content/ui/action-bar.css`
- Test: `tests/action-bar.test.ts`

**Interfaces:**
- Consumes: `SelectionStore`, `createT`.
- Produces:
  - `interface ActionBarHandlers { onSelectAll(): void; onClearAll(): void; onDelete(): void; onStop(): void }`
  - `mountActionBar(opts: { store: SelectionStore; t: ReturnType<typeof createT>; handlers: ActionBarHandlers; root?: HTMLElement }): { setProgress(text: string | null): void; setBusy(busy: boolean): void; destroy(): void }`
  - バーは `position: sticky; top: 0`。ボタン: `[data-nlk="bar-select-all"]`, `[data-nlk="bar-clear-all"]`, `[data-nlk="bar-delete"]`, `[data-nlk="bar-stop"]`（busy 時のみ表示）。件数: `[data-nlk="bar-count"]`。進捗: `[data-nlk="bar-progress"]`。

- [ ] **Step 1: 失敗テストを書く `tests/action-bar.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountActionBar } from '../src/content/ui/action-bar'
import { SelectionStore } from '../src/content/selection'
import { createT } from '../src/content/i18n'

const t = createT('en')

describe('action bar', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const noop = { onSelectAll(){}, onClearAll(){}, onDelete(){}, onStop(){} }

  it('renders and reflects selection count, disables delete at 0', () => {
    const store = new SelectionStore()
    mountActionBar({ store, t, handlers: noop })
    const del = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!
    expect(del.disabled).toBe(true)
    store.replaceAll(['a', 'b'])
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('2')
    expect(del.disabled).toBe(false)
  })

  it('wires button handlers', () => {
    const store = new SelectionStore()
    const handlers = { onSelectAll: vi.fn(), onClearAll: vi.fn(), onDelete: vi.fn(), onStop: vi.fn() }
    store.replaceAll(['a'])
    mountActionBar({ store, t, handlers })
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-clear-all"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    expect(handlers.onSelectAll).toHaveBeenCalledOnce()
    expect(handlers.onClearAll).toHaveBeenCalledOnce()
    expect(handlers.onDelete).toHaveBeenCalledOnce()
  })

  it('shows the stop button only when busy and wires onStop', () => {
    const store = new SelectionStore()
    const handlers = { onSelectAll: vi.fn(), onClearAll: vi.fn(), onDelete: vi.fn(), onStop: vi.fn() }
    const bar = mountActionBar({ store, t, handlers })
    const stop = document.querySelector<HTMLButtonElement>('[data-nlk="bar-stop"]')!
    expect(stop.hidden).toBe(true)
    bar.setBusy(true)
    expect(stop.hidden).toBe(false)
    stop.click()
    expect(handlers.onStop).toHaveBeenCalledOnce()
    bar.setBusy(false)
    expect(stop.hidden).toBe(true)
  })

  it('setProgress and setBusy update the bar', () => {
    const store = new SelectionStore()
    const bar = mountActionBar({ store, t, handlers: noop })
    bar.setProgress('Deleting 1 / 3…')
    expect(document.querySelector('[data-nlk="bar-progress"]')!.textContent).toBe('Deleting 1 / 3…')
    bar.setBusy(true)
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.disabled).toBe(true)
    bar.destroy()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/action-bar.test.ts`
Expected: FAIL。

- [ ] **Step 3: `src/content/ui/action-bar.css` を作成**

```css
.nlk-action-bar {
  position: sticky;
  top: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #1a73e8;
  color: #fff;
  font: 14px/1.4 system-ui, sans-serif;
}
.nlk-action-bar button { cursor: pointer; }
.nlk-action-bar button[disabled] { opacity: 0.5; cursor: default; }
.nlk-action-bar .nlk-spacer { flex: 1; }
```

- [ ] **Step 4: `src/content/ui/action-bar.ts` を実装**

```ts
import type { SelectionStore } from '../selection'
import type { createT } from '../i18n'
import './action-bar.css'

export interface ActionBarHandlers {
  onSelectAll(): void
  onClearAll(): void
  onDelete(): void
  onStop(): void
}

export function mountActionBar(opts: {
  store: SelectionStore
  t: ReturnType<typeof createT>
  handlers: ActionBarHandlers
  root?: HTMLElement
}) {
  const { store, t, handlers, root = document.body } = opts

  const bar = document.createElement('div')
  bar.className = 'nlk-action-bar'
  bar.setAttribute('data-nlk', 'action-bar')

  const mkBtn = (nlk: string, label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.setAttribute('data-nlk', nlk)
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  const selectAll = mkBtn('bar-select-all', t('selectAll'), handlers.onSelectAll)
  const clearAll = mkBtn('bar-clear-all', t('deselectAll'), handlers.onClearAll)
  const count = document.createElement('span')
  count.setAttribute('data-nlk', 'bar-count')
  const progress = document.createElement('span')
  progress.setAttribute('data-nlk', 'bar-progress')
  const spacer = document.createElement('span')
  spacer.className = 'nlk-spacer'
  const del = mkBtn('bar-delete', '', handlers.onDelete)
  const stop = mkBtn('bar-stop', t('abort'), handlers.onStop)
  stop.hidden = true

  bar.append(selectAll, clearAll, count, progress, spacer, del, stop)
  root.insertBefore(bar, root.firstChild)

  let busy = false
  const render = (size: number) => {
    count.textContent = t('selectedCount', { count: size })
    del.textContent = t('deleteSelected', { count: size })
    del.disabled = busy || size === 0
    del.hidden = busy
    stop.hidden = !busy
  }
  const unsub = store.onChange(render)
  render(store.size)

  return {
    setProgress(text: string | null) { progress.textContent = text ?? '' },
    setBusy(b: boolean) { busy = b; render(store.size) },
    destroy() { unsub(); bar.remove() },
  }
}
```

- [ ] **Step 5: パス確認**

Run: `npx vitest run tests/action-bar.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/content/ui/action-bar.ts src/content/ui/action-bar.css tests/action-bar.test.ts
git commit -m "feat: add sticky top action bar"
```

---

### Task 11: 配線とエントリ (`main.ts`)

**Files:**
- Modify: `src/content/main.ts`
- Test: `tests/main-wiring.test.ts`

**Interfaces:**
- Consumes: すべての前タスクのエクスポート。
- Produces:
  - `runDelete(deps): Promise<void>` を内部に持つが、テスト可能な純粋部分として
    `buildTargets(store: SelectionStore, root?: ParentNode): NotebookTarget[]` をエクスポート。
  - `init(root?: ParentNode): void`（一覧検知 → 注入 → MutationObserver 再注入）。

- [ ] **Step 1: 失敗テストを書く `tests/main-wiring.test.ts`**

`init` の統合的挙動のうち jsdom で検証できる部分（チェックボックス注入・バー生成・全選択でストアに全キーが入る）を確認する。実削除は Task 8 で検証済みのためここでは配線のみ。

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { init, buildTargets } from '../src/content/main'
import { SelectionStore } from '../src/content/selection'
import { CHECKBOX_ATTR } from '../src/content/ui/row-checkbox'

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row" jslog="j1"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

describe('buildTargets', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('returns targets for currently selected keys only', () => {
    const store = new SelectionStore()
    store.set('j1', true)
    const targets = buildTargets(store)
    expect(targets.map((t) => t.title)).toEqual(['A'])
    expect(targets[0].jslog).toBe('j1')
  })
})

describe('init', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('injects checkboxes and the action bar', () => {
    init()
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: FAIL（`init` / `buildTargets` 未実装 or 旧 main）。

- [ ] **Step 3: `src/content/main.ts` を実装**

```ts
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
} from './selectors'
import { makeTarget, type NotebookTarget } from '../types'
import { SelectionStore } from './selection'
import { detectLang, createT } from './i18n'
import { injectRowCheckboxes } from './ui/row-checkbox'
import { mountActionBar } from './ui/action-bar'
import { confirmDeletion } from './confirm-dialog'
import { deleteNotebooks, type DeleterDeps } from './deleter'
import { waitFor, safeClick } from './dom-utils'

export const VERSION = '0.1.0'

export function buildTargets(store: SelectionStore, root: ParentNode = document): NotebookTarget[] {
  const selected = new Set(store.keys())
  return getNotebookRows(root)
    .map((row) => makeTarget(getRowIdentity(row)))
    .filter((tgt) => selected.has(tgt.key))
}

export function init(root: ParentNode = document): void {
  const store = new SelectionStore()
  const t = createT(detectLang())

  injectRowCheckboxes(store, root)

  let currentAbort: AbortController | null = null

  const bar = mountActionBar({
    store,
    t,
    handlers: {
      onSelectAll: () => {
        store.replaceAll(getNotebookRows(root).map((r) => makeTarget(getRowIdentity(r)).key))
        syncCheckboxes(store, root)
      },
      onClearAll: () => { store.clear(); syncCheckboxes(store, root) },
      onDelete: () => { void runDelete() },
      onStop: () => { currentAbort?.abort() },
    },
  })

  async function runDelete(): Promise<void> {
    const targets = buildTargets(store, root)
    if (targets.length === 0) return
    const totalRows = getNotebookRows(root).length
    const isSelectAll = targets.length === totalRows
    const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
    if (!ok) return

    const ac = new AbortController()
    currentAbort = ac
    bar.setBusy(true)
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
    bar.setBusy(false)
    currentAbort = null
    if (result.failed.length > 0) bar.setProgress(t('domError'))
    else bar.setProgress(t('doneSummary', { ok: result.succeeded.length, ng: result.failed.length }))
    // 成功分のみ選択解除
    for (const key of result.succeeded) store.set(key, false)
    syncCheckboxes(store, root)
  }

  // 一覧が再描画されたらチェックボックスを注入し直す
  const observer = new MutationObserver(() => injectRowCheckboxes(store, root))
  const container = (root instanceof Document ? root.body : (root as Element)) ?? document.body
  observer.observe(container, { childList: true, subtree: true })
}

function syncCheckboxes(store: SelectionStore, root: ParentNode): void {
  for (const row of getNotebookRows(root)) {
    const key = makeTarget(getRowIdentity(row)).key
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (box) box.checked = store.has(key)
  }
}

// content script として読み込まれたときだけ自動起動（テスト時は import のみで副作用なし）
if (typeof document !== 'undefined' && document.querySelector('.all-projects-container')) {
  init()
}
```

注: 自動起動ガードは `.all-projects-container` の存在で判定。テストでは `init()` を明示的に呼ぶためトップレベル副作用は最小。

- [ ] **Step 4: パス確認**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: PASS。

- [ ] **Step 5: 全テスト + 型 + ビルド**

Run: `npm run typecheck && npm test && npm run build`
Expected: すべて成功。`dist/manifest.json` 生成。

- [ ] **Step 6: Commit**

```bash
git add src/content/main.ts tests/main-wiring.test.ts
git commit -m "feat: wire content script (inject, select-all, bulk delete flow)"
```

---

### Task 12: 手動E2Eチェックリスト

**Files:**
- Create: `docs/e2e-checklist-phase1.md`

**Interfaces:**
- Produces: 実 NotebookLM での確認手順（自動テスト外）。

- [ ] **Step 1: `docs/e2e-checklist-phase1.md` を作成**

```markdown
# Phase 1 手動E2Eチェックリスト

前提: `npm run build` → `chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択。
テスト用に**削除してよいノートブック**を複数用意すること（削除は取り消し不可）。

## 表示・注入
- [ ] `https://notebooklm.google.com/` を開くと各行の先頭にチェックボックスが出る。
- [ ] 上部にスティッキーのアクションバーが出て、スクロールしても追従する。
- [ ] 一覧を再読込/フィルタ切替しても、チェックボックスが二重注入されない。

## 選択
- [ ] 個別チェックで「N件選択中」が更新される。
- [ ] 「すべて選択」で全行が選択され、件数が全件になる。
- [ ] 「すべて解除」で 0 件になり、削除ボタンが無効化される。

## 削除（少数）
- [ ] 2〜3件選択 → 「選択したN件を削除」→ 通常確認が出る。
- [ ] 確認 → 1件ずつ削除され、進捗が更新され、対象行が消える。

## 削除（大量 / 全選択）
- [ ] 10件以上 or 全選択で「件数タイプ確認」が出る。
- [ ] 誤った件数を入力すると [削除] が無効のまま。
- [ ] 正しい件数入力で [削除] が有効化 → 削除実行。

## 異常系
- [ ] 削除中にネットワーク/DOM が想定外でも拡張がクラッシュせず、エラー表示で停止する。
- [ ] 失敗が出た場合、成功分のみ選択解除され、失敗が分かる。

## 権限・プライバシー
- [ ] 拡張の権限が notebooklm.google.com のみ。
- [ ] DevTools Network で第三者への送信が無い。
```

- [ ] **Step 2: Commit**

```bash
git add docs/e2e-checklist-phase1.md
git commit -m "docs: add Phase 1 manual E2E checklist"
```

---

## 完了条件（Plan 全体）

- [ ] `npm run typecheck` 型エラー無し。
- [ ] `npm test` 全テスト緑（types / selectors / dom-utils / selection / i18n / confirm-dialog / deleter / row-checkbox / action-bar / main-wiring / smoke）。
- [ ] `npm run build` が `dist/manifest.json`（host_permissions は notebooklm のみ）を生成。
- [ ] 手動E2Eチェックリストが用意されている。
- [ ] 受け入れ基準（spec §10）を各タスクがカバー。
