# Phase 2（タブ / URL 一括インポート）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ノートブックページに「URL 貼り付け / 開いているタブ選択」の一括ソース追加（F2-1 + F2-3）を追加する。

**Architecture:** Phase 1 のパターンを踏襲。DOM 非依存の `importer.ts`（DI・逐次・URL 境界中断・失敗で安全停止）+ `selectors.ts` に暫定セレクタ集約 + `document.body` 固定配置のインポートパネル。タブ列挙のためだけの最小 background service worker と `tabs` 権限を追加。`main.ts` の `start()` を「pathname でページ種別を判定する常駐ルーター」に拡張。

**Tech Stack:** TypeScript (strict, noUnusedLocals/Parameters) / Vite + @crxjs/vite-plugin / Vitest + jsdom。

**Spec:** `docs/superpowers/specs/2026-07-02-phase2-import-design.md`

## Global Constraints

- ソース追加フローの実 DOM は**未調査**。セレクタはすべて暫定とし、クラス名依存を避けテキスト / aria-label マッチング主軸で `src/content/selectors.ts` に集約する。
- 注入する DOM 要素には必ず `data-nlk` 属性を付ける。
- ロジックモジュールは `document` を直接触らない（deps 注入 or `root: ParentNode` 引数）。
- 権限は既存 `host_permissions: ['https://notebooklm.google.com/*']` + 新規 `permissions: ['tabs']` のみ。外部送信ゼロ。
- 文言は ja / en 両対応（`src/content/i18n.ts` の `{placeholder}` 方式）。
- 各タスク完了時に `npm run typecheck` と `npx vitest run <対象テスト>` が緑であること。
- コードコメントは日本語（既存規約）。
- コミットメッセージに AI モデル名や実行環境の識別子を書かない。

---

### Task 1: 型定義と URL リストのパース（url-list.ts）

**Files:**
- Modify: `src/types.ts`
- Create: `src/content/url-list.ts`
- Test: `tests/url-list.test.ts`

**Interfaces:**
- Produces: `ImportProgress { total; completed; failed; currentUrl? }`, `ImportResult { succeeded: string[]; failed: {url,reason}[]; aborted: boolean }`, `TabInfo { title; url }`, `LIST_TABS_MESSAGE`（types.ts）; `parseUrlList(text: string): { valid: string[]; invalid: string[] }`（url-list.ts）

- [ ] **Step 1: 失敗するテストを書く**

`tests/url-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseUrlList } from '../src/content/url-list'

describe('parseUrlList', () => {
  it('splits by newlines and whitespace, trimming empties', () => {
    const r = parseUrlList('https://a.example/\n  https://b.example/x \n\n https://c.example ')
    expect(r.valid).toEqual(['https://a.example/', 'https://b.example/x', 'https://c.example'])
    expect(r.invalid).toEqual([])
  })

  it('accepts only http/https URLs and routes the rest to invalid', () => {
    const r = parseUrlList('https://ok.example\nftp://ng.example\nchrome://settings\nnot-a-url')
    expect(r.valid).toEqual(['https://ok.example'])
    expect(r.invalid).toEqual(['ftp://ng.example', 'chrome://settings', 'not-a-url'])
  })

  it('dedupes valid URLs preserving first-occurrence order', () => {
    const r = parseUrlList('https://a.example\nhttps://b.example\nhttps://a.example')
    expect(r.valid).toEqual(['https://a.example', 'https://b.example'])
  })

  it('returns empty arrays for empty/whitespace-only input', () => {
    expect(parseUrlList('')).toEqual({ valid: [], invalid: [] })
    expect(parseUrlList('  \n \n')).toEqual({ valid: [], invalid: [] })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/url-list.test.ts`
Expected: FAIL（モジュール不在）

- [ ] **Step 3: 実装**

`src/types.ts` 末尾に追加:

```ts
export interface ImportProgress {
  total: number
  completed: number
  failed: number
  currentUrl?: string
}

export interface ImportResult {
  succeeded: string[]
  failed: { url: string; reason: string }[]
  aborted: boolean
}

// background の chrome.tabs.query 結果から content に渡すタブ情報。
export interface TabInfo {
  title: string
  url: string
}

// content ↔ background 間の「タブ一覧をくれ」メッセージ種別。
export const LIST_TABS_MESSAGE = 'nlk:list-tabs'
```

`src/content/url-list.ts`（新規）:

```ts
export interface ParsedUrlList {
  valid: string[]
  invalid: string[]
}

// 貼り付けテキストを URL リストに正規化する純関数。
// 改行・空白で分割し、http/https のみ valid。valid は初出順を保って重複排除。
export function parseUrlList(text: string): ParsedUrlList {
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const token of text.split(/\s+/)) {
    const s = token.trim()
    if (!s) continue
    let ok = false
    try {
      const u = new URL(s)
      ok = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      ok = false
    }
    if (!ok) {
      invalid.push(s)
    } else if (!seen.has(s)) {
      seen.add(s)
      valid.push(s)
    }
  }
  return { valid, invalid }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/url-list.test.ts` → PASS。`npm run typecheck` → エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/content/url-list.ts tests/url-list.test.ts
git commit -m "feat: URL リストのパース関数とインポート用型を追加"
```

---

### Task 2: dom-utils に setInputValue を追加

**Files:**
- Modify: `src/content/dom-utils.ts`
- Test: `tests/dom-utils.test.ts`（既存に describe 追加）

**Interfaces:**
- Produces: `setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void`

- [ ] **Step 1: 失敗するテストを書く**

`tests/dom-utils.test.ts` に追加（import に `setInputValue` を足す）:

```ts
describe('setInputValue', () => {
  it('sets the value and dispatches a bubbling input event', () => {
    const input = document.createElement('input')
    const parent = document.createElement('div')
    parent.appendChild(input)
    const seen: string[] = []
    parent.addEventListener('input', (e) => seen.push((e.target as HTMLInputElement).value))
    setInputValue(input, 'https://a.example')
    expect(input.value).toBe('https://a.example')
    expect(seen).toEqual(['https://a.example'])
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/dom-utils.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/content/dom-utils.ts` 末尾に追加:

```ts
// Angular のフォームバインディングは value 代入だけでは反応しないため、
// 代入後に bubbles する input イベントを発火して変更を通知する。
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/dom-utils.test.ts` / `npm run typecheck`

- [ ] **Step 5: コミット**

```bash
git add src/content/dom-utils.ts tests/dom-utils.test.ts
git commit -m "feat: Angular 向けに input イベントを発火する setInputValue を追加"
```

---

### Task 3: i18n にインポート文言を追加

**Files:**
- Modify: `src/content/i18n.ts`
- Test: `tests/i18n.test.ts`（既存に it 追加）

**Interfaces:**
- Produces: 新 MsgKey: `importFab / importTitle / importPlaceholder / loadTabs / addSelectedTabs / noTabs / tabsError / urlCounts / importRun / importProgress / importDone / importFailedSummary / importAborted / closePanel`（既存 `abort` / `domError` は再利用する）

- [ ] **Step 1: 失敗するテストを書く**

`tests/i18n.test.ts` に追加:

```ts
it('has import messages in both languages', () => {
  const ja = createT('ja')
  const en = createT('en')
  expect(ja('importRun', { count: 3 })).toContain('3')
  expect(en('importRun', { count: 3 })).toContain('3')
  expect(ja('urlCounts', { valid: 2, invalid: 1 })).toContain('2')
  expect(en('importFailedSummary', { ok: 1, ng: 1, rest: 2 })).toContain('2')
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/i18n.test.ts` → FAIL（型エラー含む）

- [ ] **Step 3: 実装**

`src/content/i18n.ts` の `EN` に追加:

```ts
  importFab: 'Import URLs',
  importTitle: 'Bulk import URLs / tabs',
  importPlaceholder: 'Paste URLs, one per line',
  loadTabs: 'Load open tabs',
  addSelectedTabs: 'Add selected tabs',
  noTabs: 'No importable tabs',
  tabsError: 'Could not list open tabs',
  urlCounts: '{valid} valid / {invalid} invalid',
  importRun: 'Import {count}',
  importProgress: 'Importing {done} / {total}…',
  importDone: 'Done: {ok} imported / {ng} failed',
  importFailedSummary: 'Stopped: {ok} imported / {ng} failed / {rest} not processed',
  importAborted: 'Stopped: {ok} imported / {rest} not processed',
  closePanel: 'Close',
```

`ja` に追加:

```ts
    importFab: 'URLをインポート',
    importTitle: 'URL / タブの一括インポート',
    importPlaceholder: 'URL を1行に1件ずつ貼り付け',
    loadTabs: '開いているタブを読み込む',
    addSelectedTabs: '選択したタブを追加',
    noTabs: 'インポートできるタブがありません',
    tabsError: 'タブ一覧を取得できませんでした',
    urlCounts: '有効 {valid}件 / 無効 {invalid}件',
    importRun: '{count}件をインポート',
    importProgress: '{done} / {total} インポート中…',
    importDone: '完了: 成功 {ok}件 / 失敗 {ng}件',
    importFailedSummary: '中断: 成功 {ok}件 / 失敗 {ng}件 / 残り {rest}件は未処理',
    importAborted: '中断しました: 成功 {ok}件 / 残り {rest}件は未処理',
    closePanel: '閉じる',
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/i18n.test.ts` / `npm run typecheck`

- [ ] **Step 5: コミット**

```bash
git add src/content/i18n.ts tests/i18n.test.ts
git commit -m "feat: インポート機能の ja/en 文言を追加"
```

---

### Task 4: selectors.ts にソース追加フローの暫定セレクタ

**Files:**
- Modify: `src/content/selectors.ts`
- Test: `tests/selectors-source.test.ts`（新規）

**Interfaces:**
- Produces: `getAddSourceButton(root?: ParentNode): HTMLElement | null` / `getSourceDialog(root?: ParentNode): HTMLElement | null` / `getWebsiteChip(dialog: HTMLElement): HTMLElement | null` / `getSourceUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null` / `getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/selectors-source.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton,
} from '../src/content/selectors'

describe('source-flow selectors (provisional)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('getAddSourceButton finds a button by aria-label', () => {
    document.body.innerHTML = `
      <button>ノートを追加</button>
      <button aria-label="ソースを追加"><span>追加</span></button>`
    expect(getAddSourceButton()?.getAttribute('aria-label')).toBe('ソースを追加')
  })

  it('getAddSourceButton falls back to exact "+ Add"-style text', () => {
    document.body.innerHTML = `<button>Add note</button><button> + Add </button>`
    expect(getAddSourceButton()?.textContent).toContain('+ Add')
  })

  it('getAddSourceButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `
      <div data-nlk="import-host"><button aria-label="ソースを追加">追加</button></div>`
    expect(getAddSourceButton()).toBeNull()
  })

  it('getAddSourceButton does not match unrelated 追加 buttons', () => {
    document.body.innerHTML = `<button>メモを追加</button>`
    expect(getAddSourceButton()).toBeNull()
  })

  it('getSourceDialog returns the mat dialog container', () => {
    document.body.innerHTML = `<mat-dialog-container>x</mat-dialog-container>`
    expect(getSourceDialog()).not.toBeNull()
  })

  it('getWebsiteChip matches a chip by ja/en text', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `
      <mat-chip><span>YouTube</span></mat-chip>
      <mat-chip><span>ウェブサイト</span></mat-chip>`
    expect(getWebsiteChip(dialog)?.textContent).toContain('ウェブサイト')
    dialog.innerHTML = `<button role="option">Website</button>`
    expect(getWebsiteChip(dialog)?.textContent).toContain('Website')
  })

  it('getSourceUrlInput prefers url/text inputs and falls back to textarea', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<input type="checkbox"><input type="url">`
    expect((getSourceUrlInput(dialog) as HTMLInputElement).type).toBe('url')
    dialog.innerHTML = `<textarea></textarea>`
    expect(getSourceUrlInput(dialog)?.tagName).toBe('TEXTAREA')
    dialog.innerHTML = `<input type="checkbox">`
    expect(getSourceUrlInput(dialog)).toBeNull()
  })

  it('getSourceSubmitButton matches 挿入/Insert text, then submit type', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<button>キャンセル</button><button>挿入</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('挿入')
    dialog.innerHTML = `<button type="submit">Go</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('Go')
    dialog.innerHTML = `<button>キャンセル</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/selectors-source.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/content/selectors.ts` に追加。`SELECTORS` 定数には次を追加:

```ts
  // ---- 以下 Phase 2（ソース追加フロー）。実 DOM 調査は未実施の暫定セレクタ。----
  // クラス名 churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にする。
  // 実機確認は docs/e2e-checklist-phase2.md。ズレたらこのファイルだけを直す。
  sourceDialog: 'mat-dialog-container',
  sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button',
  sourceSubmit: 'button[type="submit"]',
```

ファイル内（`SELECTORS` の後）に追加:

```ts
// ソース追加フローのテキストマッチャ（ja / en）。NotebookLM の UI 言語に依らず動くよう両対応。
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
} as const

// ソースパネルの「追加」ボタン。自拡張が注入した UI（data-nlk 配下）は除外する。
export function getAddSourceButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.textContent ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonExact.test((b.textContent ?? '').trim())) ??
    null
  )
}

export function getSourceDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.sourceDialog)
}

// ダイアログ内の「ウェブサイト」チップ。querySelectorAll は document order（親→子）
// なので、テキストを含む最外のクリック可能候補が返る。
export function getWebsiteChip(dialog: HTMLElement): HTMLElement | null {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.sourceChipCandidates))
  return candidates.find((el) => SOURCE_TEXT.websiteChip.test(el.textContent ?? '')) ?? null
}

export function getSourceUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    dialog.querySelector<HTMLInputElement>('input[type="url"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="text"]') ??
    dialog.querySelector<HTMLInputElement>('input:not([type])') ??
    dialog.querySelector<HTMLTextAreaElement>('textarea')
  )
}

export function getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null {
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
  return (
    buttons.find((b) => SOURCE_TEXT.submit.test((b.textContent ?? '').trim())) ??
    dialog.querySelector<HTMLElement>(SELECTORS.sourceSubmit)
  )
}
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/selectors-source.test.ts tests/selectors.test.ts` / `npm run typecheck`

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "feat: ソース追加フローの暫定セレクタを追加（テキストマッチ主軸）"
```

---

### Task 5: インポートオーケストレータ（importer.ts）

**Files:**
- Create: `src/content/importer.ts`
- Test: `tests/importer.test.ts`

**Interfaces:**
- Consumes: `waitFor`（dom-utils）、`ImportProgress` / `ImportResult`（types）
- Produces: `ImporterDeps`（getAddSourceButton / getSourceDialog / getWebsiteChip / getUrlInput / getSubmitButton / setInputValue / click / waitFor / timeout?）、`importUrls(urls: string[], deps: ImporterDeps, opts?: { onProgress?; signal? }): Promise<ImportResult>`

- [ ] **Step 1: 失敗するテストを書く**

`tests/importer.test.ts`（deleter.test.ts のフェイク world パターンに倣う）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { importUrls, type ImporterDeps } from '../src/content/importer'
import { waitFor } from '../src/content/dom-utils'

// ソース追加フローの世界を実 DOM ノードで表現するフェイク world。
// dialog.isConnected を実際の DOM 接続状態として検証できるようにする。
function makeWorld() {
  document.body.innerHTML = ''
  const added: string[] = []
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
        dialog = document.createElement('div')
        document.body.appendChild(dialog)
        input = null
      } else if (name === 'chip') {
        input = document.createElement('input')
        dialog?.appendChild(input)
      } else if (name === 'submit') {
        if (input) added.push(input.value)
        dialog?.remove()
        dialog = null
        input = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, added, isDialogOpen: () => dialog !== null }
}

const URLS = ['https://a.example/', 'https://b.example/']

describe('importUrls', () => {
  it('imports all urls sequentially and reports progress', async () => {
    const { deps, added } = makeWorld()
    const progress = vi.fn()
    const res = await importUrls(URLS, deps, { onProgress: progress })
    expect(added).toEqual(URLS)
    expect(res.succeeded).toEqual(URLS)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 2, completed: 2, failed: 0 }),
    )
  })

  it('waits for the website chip to render after the dialog appears', async () => {
    const { deps, added } = makeWorld()
    const realChip = deps.getWebsiteChip
    let calls = 0
    deps.getWebsiteChip = (d) => {
      calls++
      return calls < 2 ? null : realChip(d)
    }
    const res = await importUrls(['https://a.example/'], deps)
    expect(res.succeeded.length).toBe(1)
    expect(added).toEqual(['https://a.example/'])
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('records a failure and stops when the dialog never closes', async () => {
    const { deps } = makeWorld()
    const realClick = deps.click
    deps.click = (e) => {
      if (e.dataset.name === 'submit') return // 挿入しても閉じない（想定外 DOM）
      realClick(e)
    }
    const res = await importUrls(URLS, deps)
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].url).toBe(URLS[0])
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld()
    const ac = new AbortController()
    const realClick = deps.click
    deps.click = (e) => {
      realClick(e)
      if (e.dataset.name === 'submit') ac.abort()
    }
    const res = await importUrls(URLS, deps, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded).toEqual([URLS[0]]) // 処理中の1件は完了させる
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/importer.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/content/importer.ts`:

```ts
import type { ImportProgress, ImportResult } from '../types'
import type { waitFor as WaitFor } from './dom-utils'

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

// 1件のインポートは最後まで完了させる（中断は URL 境界でのみ判定。deleter と同じ規約のため、
// ここでは signal を渡さない。要素待ちは timeout で守る）。
// タイムアウト既定はページ取得を伴うため削除（5s）より長めの 10s。
async function importOne(url: string, deps: ImporterDeps): Promise<void> {
  const timeout = deps.timeout ?? 10000
  const w = deps.waitFor

  // ① ソース追加ボタン（前件のダイアログが閉じた直後の再描画に備えて出現待ち）
  const add = await w(() => deps.getAddSourceButton(), { timeout })
  deps.click(add)
  // ② ダイアログ内の「ウェブサイト」チップ。チップは容器より遅れて描画されるため、
  // 容器ではなくチップ自体の出現を待つ（deleter の Delete ボタン待ちと同パターン）。
  const opened = await w(() => {
    const dialog = deps.getSourceDialog()
    const chip = dialog ? deps.getWebsiteChip(dialog) : null
    return dialog && chip ? { dialog, chip } : null
  }, { timeout })
  deps.click(opened.chip)
  // ③ URL 入力欄に値を設定（Angular に届くよう input イベント発火込みの setInputValue）
  const input = await w(() => deps.getUrlInput(opened.dialog), { timeout })
  deps.setInputValue(input, url)
  // ④ 挿入ボタンが「存在して有効」になるまで待つ（未入力の間は disabled のため、
  // 存在だけ見て押すと no-op になる）
  const submit = await w(() => {
    const btn = deps.getSubmitButton(opened.dialog)
    if (!btn) return null
    return (btn as HTMLButtonElement).disabled ? null : btn
  }, { timeout })
  deps.click(submit)
  // ⑤ 掴んだダイアログノード自身が DOM から外れるまで待つ = 1件完了。
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
  const report = (currentUrl?: string) =>
    onProgress?.({ total, completed: result.succeeded.length, failed: result.failed.length, currentUrl })

  for (const url of urls) {
    // 中断は各 URL の境界でのみ判定（処理中の1件は完了させる）
    if (signal?.aborted) {
      result.aborted = true
      break
    }
    report(url)
    try {
      await importOne(url, deps)
      result.succeeded.push(url)
    } catch (err) {
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ url, reason: (err as Error).message })
      break
    }
  }
  report()
  return result
}
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/importer.test.ts` / `npm run typecheck`

- [ ] **Step 5: コミット**

```bash
git add src/content/importer.ts tests/importer.test.ts
git commit -m "feat: URL 逐次インポートのオーケストレータを追加"
```

---

### Task 6: background service worker とタブブリッジ、manifest 更新

**Files:**
- Create: `src/background/main.ts`
- Create: `src/content/tabs-bridge.ts`
- Modify: `manifest.config.ts`
- Test: `tests/background.test.ts`, `tests/tabs-bridge.test.ts`

**Interfaces:**
- Consumes: `LIST_TABS_MESSAGE` / `TabInfo`（types）
- Produces: `toImportableTabs(tabs: { title?: string; url?: string }[]): TabInfo[]`（background）、`listOpenTabs(runtime?: RuntimeLike): Promise<TabInfo[]>` / `RuntimeLike { sendMessage(message: unknown): Promise<unknown> }`（tabs-bridge）

- [ ] **Step 1: 失敗するテストを書く**

`tests/background.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toImportableTabs } from '../src/background/main'

describe('toImportableTabs', () => {
  it('keeps only http/https tabs and drops NotebookLM itself', () => {
    const tabs = [
      { title: 'A', url: 'https://a.example/' },
      { title: 'Ext', url: 'chrome://extensions/' },
      { title: 'NLM', url: 'https://notebooklm.google.com/notebook/x' },
      { title: 'B', url: 'http://b.example/' },
      { title: 'NoUrl' },
      { title: 'Broken', url: '::::' },
    ]
    expect(toImportableTabs(tabs)).toEqual([
      { title: 'A', url: 'https://a.example/' },
      { title: 'B', url: 'http://b.example/' },
    ])
  })

  it('defaults missing titles to empty string', () => {
    expect(toImportableTabs([{ url: 'https://a.example/' }])).toEqual([
      { title: '', url: 'https://a.example/' },
    ])
  })
})
```

`tests/tabs-bridge.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { listOpenTabs } from '../src/content/tabs-bridge'
import { LIST_TABS_MESSAGE } from '../src/types'

describe('listOpenTabs', () => {
  it('sends the list-tabs message and returns tabs', async () => {
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({ tabs: [{ title: 'A', url: 'https://a.example/' }] }),
    }
    const tabs = await listOpenTabs(runtime)
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: LIST_TABS_MESSAGE })
    expect(tabs).toEqual([{ title: 'A', url: 'https://a.example/' }])
  })

  it('returns [] when the response has no tabs', async () => {
    const runtime = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    expect(await listOpenTabs(runtime)).toEqual([])
  })

  it('rejects when chrome.runtime is unavailable', async () => {
    await expect(listOpenTabs(undefined)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/background.test.ts tests/tabs-bridge.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/background/main.ts`（新規）:

```ts
import { LIST_TABS_MESSAGE, type TabInfo } from '../types'

// chrome.tabs.query の結果からインポート候補になるタブだけを残す純関数。
// http/https 以外（chrome:// 等）はソースにできず、NotebookLM 自身のタブも対象外。
export function toImportableTabs(tabs: { title?: string; url?: string }[]): TabInfo[] {
  const out: TabInfo[] = []
  for (const t of tabs) {
    if (!t.url) continue
    let u: URL
    try {
      u = new URL(t.url)
    } catch {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.hostname === 'notebooklm.google.com') continue
    out.push({ title: t.title ?? '', url: t.url })
  }
  return out
}

// service worker として読み込まれたときだけリスナー登録。
// テスト（jsdom）には chrome が無いため、import しても副作用は無い。
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse): boolean => {
    if ((message as { type?: string } | null)?.type !== LIST_TABS_MESSAGE) return false
    // 要求元（NotebookLM タブ）と同じウィンドウのタブを返す
    const windowId = sender.tab?.windowId
    const query = windowId !== undefined ? { windowId } : { currentWindow: true }
    chrome.tabs.query(query, (tabs) => sendResponse({ tabs: toImportableTabs(tabs) }))
    return true // sendResponse を非同期で呼ぶためチャネルを開いたままにする
  })
}
```

`src/content/tabs-bridge.ts`（新規）:

```ts
import { LIST_TABS_MESSAGE, type TabInfo } from '../types'

export interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>
}

function defaultRuntime(): RuntimeLike | undefined {
  return (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime
}

// background へタブ一覧を要求する（MV3 の sendMessage は Promise を返す）。
// runtime は注入可能にして jsdom でテストする。
export async function listOpenTabs(
  runtime: RuntimeLike | undefined = defaultRuntime(),
): Promise<TabInfo[]> {
  if (!runtime) throw new Error('chrome.runtime unavailable')
  const res = (await runtime.sendMessage({ type: LIST_TABS_MESSAGE })) as
    | { tabs?: TabInfo[] }
    | null
    | undefined
  return res?.tabs ?? []
}
```

`manifest.config.ts` を次のとおり変更（description 更新・permissions / background 追加）:

```ts
import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'notebooklmkit',
  version: '0.1.0',
  description: 'Bulk delete notebooks and bulk import URLs/tabs for NotebookLM.',
  host_permissions: ['https://notebooklm.google.com/*'],
  // tabs は F2-1（開いているタブの一括インポート）でタブの URL / title を読むためだけに使用。
  // 取得したデータは端末内で完結し、外部送信はしない（docs/requirements.md §3.3）。
  permissions: ['tabs'],
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://notebooklm.google.com/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/background.test.ts tests/tabs-bridge.test.ts` / `npm run typecheck` / `npm run build`（manifest が通ること）

- [ ] **Step 5: コミット**

```bash
git add src/background/main.ts src/content/tabs-bridge.ts manifest.config.ts tests/background.test.ts tests/tabs-bridge.test.ts
git commit -m "feat: タブ列挙用の最小 background と tabs 権限を追加"
```

---

### Task 7: インポートパネル UI（ui/import-panel.ts）

**Files:**
- Create: `src/content/ui/import-panel.ts`
- Create: `src/content/ui/import-panel.css`
- Test: `tests/import-panel.test.ts`

**Interfaces:**
- Consumes: `parseUrlList`（url-list）、`createT`（i18n）、`TabInfo`（types）
- Produces: `ImportPanelHandlers { onImport(urls: string[]): void; onStop(): void; onLoadTabs(): Promise<TabInfo[]> }`、`mountImportPanel(opts: { t; handlers; root?: HTMLElement }): { setBusy(b: boolean): void; setProgress(text: string | null): void; removeUrls(urls: string[]): void; destroy(): void }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/import-panel.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountImportPanel, type ImportPanelHandlers } from '../src/content/ui/import-panel'
import { createT } from '../src/content/i18n'
import type { TabInfo } from '../src/types'

const flush = () => new Promise((r) => setTimeout(r, 0))
const q = <T extends HTMLElement>(nlk: string) =>
  document.querySelector<T>(`[data-nlk="${nlk}"]`)

function mount(over: Partial<ImportPanelHandlers> = {}, tabs: TabInfo[] = []) {
  const handlers: ImportPanelHandlers = {
    onImport: vi.fn(),
    onStop: vi.fn(),
    onLoadTabs: vi.fn().mockResolvedValue(tabs),
    ...over,
  }
  const api = mountImportPanel({ t: createT('en'), handlers })
  return { api, handlers }
}

function typeUrls(text: string) {
  const ta = q<HTMLTextAreaElement>('import-urls')!
  ta.value = text
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('mountImportPanel', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('mounts a fab and a hidden panel; fab toggles the panel', () => {
    mount()
    const panel = q('import-panel')!
    expect(q('import-fab')).not.toBeNull()
    expect(panel.hidden).toBe(true)
    q('import-fab')!.click()
    expect(panel.hidden).toBe(false)
    q('import-fab')!.click()
    expect(panel.hidden).toBe(true)
  })

  it('updates counts and the run button as urls are typed', () => {
    mount()
    const run = q<HTMLButtonElement>('import-run')!
    expect(run.disabled).toBe(true)
    typeUrls('https://a.example/\nnot-a-url')
    expect(q('import-counts')!.textContent).toContain('1')
    expect(run.disabled).toBe(false)
    expect(run.textContent).toContain('1')
  })

  it('calls onImport with parsed valid urls only', () => {
    const { handlers } = mount()
    typeUrls('https://a.example/\nhttps://a.example/\nbad')
    q('import-run')!.click()
    expect(handlers.onImport).toHaveBeenCalledWith(['https://a.example/'])
  })

  it('setBusy toggles run/stop and disables inputs; stop calls onStop', () => {
    const { api, handlers } = mount()
    typeUrls('https://a.example/')
    api.setBusy(true)
    expect(q<HTMLButtonElement>('import-run')!.hidden).toBe(true)
    expect(q<HTMLButtonElement>('import-stop')!.hidden).toBe(false)
    expect(q<HTMLTextAreaElement>('import-urls')!.disabled).toBe(true)
    q('import-stop')!.click()
    expect(handlers.onStop).toHaveBeenCalled()
    api.setBusy(false)
    expect(q<HTMLButtonElement>('import-run')!.hidden).toBe(false)
  })

  it('ignores run clicks while busy or with zero valid urls', () => {
    const { api, handlers } = mount()
    q('import-run')!.click() // 0件
    api.setBusy(true)
    typeUrls('https://a.example/')
    q('import-run')!.click() // busy
    expect(handlers.onImport).not.toHaveBeenCalled()
  })

  it('loads tabs into a checkbox list and appends only checked ones', async () => {
    mount({}, [
      { title: 'A', url: 'https://a.example/' },
      { title: 'B', url: 'https://b.example/' },
    ])
    q('import-load-tabs')!.click()
    await flush()
    const boxes = document.querySelectorAll<HTMLInputElement>('[data-nlk="import-tab-check"]')
    expect(boxes.length).toBe(2)
    boxes[1].checked = false
    q('import-add-tabs')!.click()
    expect(q<HTMLTextAreaElement>('import-urls')!.value).toContain('https://a.example/')
    expect(q<HTMLTextAreaElement>('import-urls')!.value).not.toContain('https://b.example/')
  })

  it('shows a message when there are no importable tabs', async () => {
    mount({}, [])
    q('import-load-tabs')!.click()
    await flush()
    expect(q('import-tab-list')!.textContent).toContain('No importable tabs')
    expect(q<HTMLButtonElement>('import-add-tabs')!.hidden).toBe(true)
  })

  it('shows an error when onLoadTabs rejects', async () => {
    mount({ onLoadTabs: vi.fn().mockRejectedValue(new Error('nope')) })
    q('import-load-tabs')!.click()
    await flush()
    expect(q('import-tab-list')!.textContent).toContain('Could not list open tabs')
  })

  it('setProgress and removeUrls update the panel', () => {
    const { api } = mount()
    api.setProgress('Importing 1 / 2…')
    expect(q('import-progress')!.textContent).toContain('1 / 2')
    typeUrls('https://a.example/\nhttps://b.example/')
    api.removeUrls(['https://a.example/'])
    const value = q<HTMLTextAreaElement>('import-urls')!.value
    expect(value).not.toContain('https://a.example/')
    expect(value).toContain('https://b.example/')
  })

  it('destroy removes everything', () => {
    const { api } = mount()
    api.destroy()
    expect(q('import-fab')).toBeNull()
    expect(q('import-panel')).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/import-panel.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/content/ui/import-panel.ts`:

```ts
import type { createT } from '../i18n'
import type { TabInfo } from '../../types'
import { parseUrlList } from '../url-list'
import './import-panel.css'

export interface ImportPanelHandlers {
  onImport(urls: string[]): void
  onStop(): void
  onLoadTabs(): Promise<TabInfo[]>
}

// ノートブックページ右下のフローティングボタン + インポートパネル。
// ノートブックページ自体の DOM 構造には依存せず、document.body 直下に固定配置する。
export function mountImportPanel(opts: {
  t: ReturnType<typeof createT>
  handlers: ImportPanelHandlers
  root?: HTMLElement
}) {
  const { t, handlers, root = document.body } = opts

  const host = document.createElement('div')
  host.className = 'nlk-import'
  host.setAttribute('data-nlk', 'import-host')

  const fab = document.createElement('button')
  fab.className = 'nlk-import-fab'
  fab.setAttribute('data-nlk', 'import-fab')
  fab.textContent = t('importFab')

  const panel = document.createElement('div')
  panel.className = 'nlk-import-panel'
  panel.setAttribute('data-nlk', 'import-panel')
  panel.hidden = true

  const title = document.createElement('div')
  title.className = 'nlk-import-title'
  title.textContent = t('importTitle')

  const textarea = document.createElement('textarea')
  textarea.setAttribute('data-nlk', 'import-urls')
  textarea.placeholder = t('importPlaceholder')
  textarea.rows = 6

  const counts = document.createElement('div')
  counts.setAttribute('data-nlk', 'import-counts')

  const loadTabsBtn = document.createElement('button')
  loadTabsBtn.setAttribute('data-nlk', 'import-load-tabs')
  loadTabsBtn.textContent = t('loadTabs')

  const tabList = document.createElement('div')
  tabList.className = 'nlk-import-tab-list'
  tabList.setAttribute('data-nlk', 'import-tab-list')
  tabList.hidden = true

  const addTabsBtn = document.createElement('button')
  addTabsBtn.setAttribute('data-nlk', 'import-add-tabs')
  addTabsBtn.textContent = t('addSelectedTabs')
  addTabsBtn.hidden = true

  const progress = document.createElement('div')
  progress.setAttribute('data-nlk', 'import-progress')

  const runBtn = document.createElement('button')
  runBtn.setAttribute('data-nlk', 'import-run')

  const stopBtn = document.createElement('button')
  stopBtn.setAttribute('data-nlk', 'import-stop')
  stopBtn.textContent = t('abort')
  stopBtn.hidden = true

  panel.append(title, textarea, counts, loadTabsBtn, tabList, addTabsBtn, progress, runBtn, stopBtn)
  host.append(panel, fab)
  root.appendChild(host)

  let busy = false

  const render = () => {
    const { valid, invalid } = parseUrlList(textarea.value)
    counts.textContent = t('urlCounts', { valid: valid.length, invalid: invalid.length })
    runBtn.textContent = t('importRun', { count: valid.length })
    runBtn.disabled = busy || valid.length === 0
    runBtn.hidden = busy
    stopBtn.hidden = !busy
    textarea.disabled = busy
    loadTabsBtn.disabled = busy
    addTabsBtn.disabled = busy
  }

  fab.addEventListener('click', () => { panel.hidden = !panel.hidden })
  textarea.addEventListener('input', render)
  runBtn.addEventListener('click', () => {
    if (busy) return
    const { valid } = parseUrlList(textarea.value)
    if (valid.length === 0) return
    handlers.onImport(valid)
  })
  stopBtn.addEventListener('click', () => handlers.onStop())

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
        for (const tab of tabs) {
          const label = document.createElement('label')
          label.setAttribute('data-nlk', 'import-tab-item')
          const check = document.createElement('input')
          check.type = 'checkbox'
          check.checked = true
          check.setAttribute('data-nlk', 'import-tab-check')
          check.dataset.url = tab.url
          const text = document.createElement('span')
          text.textContent = tab.title || tab.url
          text.title = tab.url
          label.append(check, text)
          tabList.appendChild(label)
        }
        addTabsBtn.hidden = false
      } catch {
        // background 不通など。パネルは壊さずメッセージだけ出す。
        tabList.textContent = t('tabsError')
      }
    })()
  })

  addTabsBtn.addEventListener('click', () => {
    const urls = Array.from(
      tabList.querySelectorAll<HTMLInputElement>('[data-nlk="import-tab-check"]'),
    )
      .filter((c) => c.checked)
      .map((c) => c.dataset.url ?? '')
      .filter(Boolean)
    if (urls.length === 0) return
    const sep = textarea.value.trim() === '' ? '' : '\n'
    textarea.value = textarea.value.trimEnd() + sep + urls.join('\n') + '\n'
    render()
  })

  render()

  return {
    setBusy(b: boolean) {
      busy = b
      render()
    },
    setProgress(text: string | null) {
      progress.textContent = text ?? ''
    },
    // 成功した URL の行を textarea から取り除く（失敗・未処理分が残りリトライしやすい）。
    // 1行に複数 URL を書いた行は対象外（行単位マッチのみ）。
    removeUrls(urls: string[]) {
      const remove = new Set(urls)
      textarea.value = textarea.value
        .split(/\r?\n/)
        .filter((line) => !remove.has(line.trim()))
        .join('\n')
      render()
    },
    destroy() {
      host.remove()
    },
  }
}
```

`src/content/ui/import-panel.css`:

```css
.nlk-import {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  font: 14px/1.4 system-ui, sans-serif;
}
.nlk-import-fab {
  background: #1a73e8;
  color: #fff;
  border: none;
  border-radius: 20px;
  padding: 10px 16px;
  cursor: pointer;
  font-weight: 600;
}
.nlk-import-panel {
  position: absolute;
  right: 0;
  bottom: 48px;
  width: 360px;
  background: #fff;
  color: #202124;
  border: 1px solid #dadce0;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nlk-import-panel[hidden] { display: none; }
.nlk-import-title { font-weight: 600; }
.nlk-import-panel textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.nlk-import-tab-list {
  max-height: 160px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nlk-import-tab-list label {
  display: flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nlk-import-panel button { cursor: pointer; }
.nlk-import-panel button[disabled] { opacity: 0.5; cursor: default; }
.nlk-import-panel button[data-nlk='import-run'] {
  background: #1a73e8;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-weight: 600;
}
```

- [ ] **Step 4: PASS を確認** — `npx vitest run tests/import-panel.test.ts` / `npm run typecheck`

- [ ] **Step 5: コミット**

```bash
git add src/content/ui/import-panel.ts src/content/ui/import-panel.css tests/import-panel.test.ts
git commit -m "feat: URL/タブ一括インポートのパネル UI を追加"
```

---

### Task 8: main.ts のページルーティングと initImport 配線

**Files:**
- Modify: `src/content/main.ts`
- Test: `tests/main-routing.test.ts`（新規）。既存 `tests/main-wiring.test.ts` は変更しない（`init` / `start` の一覧ページ挙動は維持される）。

**Interfaces:**
- Consumes: Task 4〜7 の全 export（`getAddSourceButton` / `getSourceDialog` / `getWebsiteChip` / `getSourceUrlInput` / `getSourceSubmitButton` / `importUrls` / `ImporterDeps` / `mountImportPanel` / `listOpenTabs` / `setInputValue`）
- Produces: `isNotebookPath(pathname: string): boolean`、`initImport(root?: ParentNode): () => void`、`start(root?: ParentNode, getPath?: () => string): () => void`（第2引数追加。既定は `() => location.pathname`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/main-routing.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { start, initImport, isNotebookPath } from '../src/content/main'
import { importUrls } from '../src/content/importer'

vi.mock('../src/content/importer', () => ({
  importUrls: vi.fn(),
}))

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('isNotebookPath', () => {
  it('detects notebook pages by pathname', () => {
    expect(isNotebookPath('/notebook/abc123')).toBe(true)
    expect(isNotebookPath('/')).toBe(false)
    expect(isNotebookPath('/settings')).toBe(false)
  })
})

describe('start routing', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('mounts the list UI on the projects page', () => {
    document.body.innerHTML = LIST
    const dispose = start(document, () => '/')
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
    dispose()
  })

  it('mounts the import UI on a notebook page', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc123')
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    dispose()
  })

  it('switches UIs when the SPA navigates list → notebook', async () => {
    document.body.innerHTML = LIST
    let path = '/'
    const dispose = start(document, () => path)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    path = '/notebook/abc'
    document.body.innerHTML = '<div id="app"></div>' // SPA 再描画で mutation 発火
    await flush()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    dispose()
  })

  it('dispose unmounts whichever UI is active', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc')
    dispose()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
  })
})

describe('initImport wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(importUrls).mockReset()
  })

  function typeAndRun(text: string) {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    ta.value = text
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-nlk="import-run"]')!.click()
  }

  it('runs importUrls with parsed urls and shows a summary', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: ['https://a.example/'],
      failed: [],
      aborted: false,
    })
    const dispose = initImport()
    typeAndRun('https://a.example/\nbad-url')
    await Promise.resolve()
    expect(importUrls).toHaveBeenCalledTimes(1)
    expect(vi.mocked(importUrls).mock.calls[0][0]).toEqual(['https://a.example/'])
    await new Promise((r) => setTimeout(r, 0))
    const progress = document.querySelector('[data-nlk="import-progress"]')!
    expect(progress.textContent).toContain('1')
    // 成功した URL は textarea から除去される
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    expect(ta.value).not.toContain('https://a.example/')
    dispose()
  })

  it('ignores a second run while one is in flight', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(importUrls).mockReturnValue(new Promise((r) => { resolve = r }) as never)
    const dispose = initImport()
    typeAndRun('https://a.example/')
    typeAndRun('https://a.example/')
    expect(importUrls).toHaveBeenCalledTimes(1)
    resolve({ succeeded: [], failed: [], aborted: false })
    await new Promise((r) => setTimeout(r, 0))
    dispose()
  })
})
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/main-routing.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/content/main.ts` を変更する。

(a) import 群に追加:

```ts
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton,
} from './selectors'
import { mountImportPanel } from './ui/import-panel'
import { importUrls, type ImporterDeps } from './importer'
import { listOpenTabs } from './tabs-bridge'
import { setInputValue } from './dom-utils'
```

（既存の selectors / dom-utils の import 行にまとめてよい）

(b) `init()` の後に `initImport()` を追加:

```ts
// ノートブックページ（/notebook/<id>）側の配線。インポートパネルを載せる。
// ノートブックページの DOM 構造には依存しない（パネルは body 固定配置、
// ソース追加フローの要素は importer が waitFor で都度探す）。
export function initImport(root: ParentNode = document): () => void {
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

  async function runImport(urls: string[]): Promise<void> {
    if (importing || urls.length === 0) return
    importing = true
    const ac = new AbortController()
    currentAbort = ac
    panel.setBusy(true)
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
      const result = await importUrls(urls, deps, {
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
      // 成功した URL は textarea から取り除く（失敗・未処理分が残りリトライしやすい）
      panel.removeUrls(result.succeeded)
    } catch (err) {
      console.error('notebooklmkit: unexpected error during import', err)
      panel.setProgress(t('domError'))
    } finally {
      panel.setBusy(false)
      currentAbort = null
      importing = false
    }
  }

  return () => {
    // SPA 遷移等で teardown されたら進行中のインポートも止める（issue #16 と同じ規約）
    currentAbort?.abort()
    panel.destroy()
  }
}
```

(c) `start()` を常駐ルーターに置き換える（既存の `start` 実装を丸ごと差し替え。`init` は無変更）:

```ts
type PageKind = 'list' | 'notebook' | 'none'

export function isNotebookPath(pathname: string): boolean {
  return pathname.startsWith('/notebook/')
}

function detectPage(root: ParentNode, pathname: string): PageKind {
  if (isNotebookPath(pathname)) return 'notebook'
  if (root.querySelector('.all-projects-container')) return 'list'
  return 'none'
}

// NotebookLM は pushState 遷移でイベントが取れない Angular SPA のため、
// DOM 変化のたびにページ種別を判定して UI を掛け替える常駐ルーター。
// 判定は pathname の前方一致と querySelector 1回だけで軽量。
// 一覧コンテナが未描画の cold load は 'none' 扱いになり、描画後の mutation で
// 'list' に遷移する（旧 bootstrap observer と同じ振る舞い）。
export function start(
  root: ParentNode = document,
  getPath: () => string = () => location.pathname,
): () => void {
  let current: PageKind = 'none'
  let dispose: (() => void) | null = null

  const apply = () => {
    const kind = detectPage(root, getPath())
    if (kind === current) return
    // 'none' への遷移でも dispose する（SPA 遷移で UI を残さない）
    dispose?.()
    dispose = null
    current = kind
    if (kind === 'list') dispose = init(root)
    else if (kind === 'notebook') dispose = initImport(root)
  }

  apply()
  const target: Element =
    (root instanceof Document ? (root.documentElement ?? root.body) : (root as Element)) ??
    document.documentElement
  const router = new MutationObserver(apply)
  router.observe(target, { childList: true, subtree: true })

  return () => {
    router.disconnect()
    dispose?.()
    dispose = null
  }
}
```

- [ ] **Step 4: 全テスト PASS を確認**

Run: `npx vitest run` （main-wiring.test.ts 含む全部）
Run: `npm run typecheck`
Expected: すべて緑。既存テストが壊れた場合は `start` の後方互換（一覧ページで従来どおり `init` される・dispose で解除される）を修正する。

- [ ] **Step 5: コミット**

```bash
git add src/content/main.ts tests/main-routing.test.ts
git commit -m "feat: ページルーティングを追加しノートブックページにインポート UI を配線"
```

---

### Task 9: ドキュメント更新と最終検証

**Files:**
- Create: `docs/e2e-checklist-phase2.md`
- Modify: `docs/requirements.md`（§10 のみ）
- Modify: `CLAUDE.md`（概要とアーキテクチャの記述を Phase 2 実装後の実態に合わせる）

- [ ] **Step 1: e2e チェックリストを書く**

`docs/e2e-checklist-phase2.md`:

```markdown
# Phase 2 手動 E2E チェックリスト（タブ / URL 一括インポート）

ソース追加フローの実 DOM は未調査のため、セレクタはすべて**暫定**。
このチェックリストの最初のセクションでセレクタの実機検証を行い、
ズレていたら `src/content/selectors.ts`（`SOURCE_TEXT` / `SELECTORS`）だけを直す。

準備: `npm run build` → `chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `dist/`。
破棄してよいテスト用ノートブックを1つ用意する。

## 0. 暫定セレクタの実機検証（最初に必ず実施）

ノートブックページ（`/notebook/<id>`）を開き、DevTools で以下を確認:

- [ ] ソース追加ボタン: `aria-label` またはテキストが「ソースを追加」/「追加」/ "Add source" に一致する `button` が存在する
- [ ] それをクリックすると `mat-dialog-container` が出る
- [ ] ダイアログ内に「ウェブサイト」/ "Website" のテキストを持つチップ（`mat-chip` / `[role="option"]` / `button` のいずれか）がある
- [ ] チップクリック後、ダイアログ内に URL 入力欄（`input` または `textarea`）が出る
- [ ] 「挿入」/ "Insert" ボタン（または `button[type="submit"]`）があり、URL 入力で有効化される
- [ ] 挿入後にダイアログが閉じ、ソース一覧に追加される

ズレがあった場合: `selectors.ts` を修正 → 再ビルド → 本セクションを再確認。

## 1. F2-3: URL 貼り付けインポート

- [ ] ノートブックページ右下に「URLをインポート」ボタンが出る（一覧ページには出ない）
- [ ] パネルの textarea に URL を2件貼ると「有効 2件 / 無効 0件」と「2件をインポート」になる
- [ ] 無効な行（`not-a-url` 等）は無効件数に計上され、インポート対象にならない
- [ ] 実行すると 1件ずつ「ソースを追加 → ウェブサイト → URL → 挿入」が自動で流れ、進捗が「1 / 2 インポート中…」と更新される
- [ ] 完了後「完了: 成功 2件 / 失敗 0件」になり、成功 URL が textarea から消える
- [ ] ソースパネルに 2件追加されている

## 2. F2-1: 開いているタブのインポート

- [ ] 適当な http(s) ページを2〜3タブ開いた状態で「開いているタブを読み込む」を押すと、タブ一覧がチェックボックス付きで出る
- [ ] `chrome://` タブと NotebookLM 自身のタブは一覧に出ない
- [ ] チェックを外したタブは「選択したタブを追加」で textarea に入らない
- [ ] 追加 → インポートで選択タブがソースに追加される

## 3. 中断・エラー

- [ ] 3件以上のインポート中に「中断」を押すと、処理中の1件は完了し、残りは未処理のまま「中断しました: …」が出る
- [ ] インポート実行中はインポートボタン・textarea が無効化され、二重実行できない
- [ ] （擬似障害）DevTools でソース追加ボタンを一時的に `display:none` にして実行 → タイムアウト後「中断: …」が表示され、クラッシュしない
- [ ] インポート中に一覧ページへ戻る（SPA 遷移）→ パネルが消え、処理も止まる

## 4. i18n・権限

- [ ] Chrome の UI 言語が日本語なら日本語、それ以外は英語の文言になる
- [ ] `chrome://extensions` で権限が「notebooklm.google.com のデータの読み取りと変更」+「タブ」相当のみである

## 既知の制限

- ソース数上限（無料 50 / Plus 300）に達すると挿入が失敗し、安全停止する（上限の事前チェックはしない）
- 同名 URL の重複検知はしない（NotebookLM 側にも無い）
- 1行に複数 URL を書いた場合、成功後の行削除はスキップされる（インポート自体は行われる）
```

- [ ] **Step 2: requirements.md §10 を更新**

`docs/requirements.md` の §10 の行

```
- [ ] Phase 2（ソース追加フロー）の DOM 調査。
```

を次に置き換える:

```
- [ ] Phase 2（ソース追加フロー）の DOM 調査。→ 実装は暫定セレクタで先行
  （テキスト / aria-label マッチング主軸）。実機確認は `docs/e2e-checklist-phase2.md` §0 で行い、
  ズレは `selectors.ts` の修正で追随する。
```

- [ ] **Step 3: CLAUDE.md を更新**

- 「## 概要」の `Phase 1（実装済み）: … Phase 2（計画中）: タブ / URL の一括インポート。` を
  `Phase 1（実装済み）: ノートブック一覧の複数選択＋一括削除。Phase 2（実装済み: F2-1 / F2-3。F2-2 は未実装）: タブ / URL の一括インポート。` に変更。
- 「## アーキテクチャ」冒頭の `すべて \`src/content/\` 配下にある（単一の content script。popup / background はまだ無い）。` を
  `content script（\`src/content/\`）と、タブ列挙のみを行う最小の background service worker（\`src/background/main.ts\`）で構成される（popup はまだ無い）。` に変更。
- 「## アーキテクチャ」に段落を追加:

```markdown
**Phase 2（インポート）は Phase 1 と同じ分離を踏襲。** `src/content/importer.ts`
（`importUrls`）は `ImporterDeps` を受け取る DI 構成で、1 URL ずつ
「ソース追加 → ウェブサイト → URL 入力 → 挿入 → ダイアログ消滅待ち」を逐次実行する。
失敗で安全停止、中断は URL 境界のみ、という deleter と同じ規約。**ソース追加フローの
セレクタは実 DOM 未調査の暫定**（テキスト / aria-label マッチング主軸。`SOURCE_TEXT`）で、
実機確認は `docs/e2e-checklist-phase2.md` §0 に従う。`main.ts` の `start()` は pathname で
一覧ページ（Phase 1 UI）とノートブックページ（インポートパネル）を出し分ける常駐ルーター。
タブ一括インポート（F2-1）は content → background の `nlk:list-tabs` メッセージで
同一ウィンドウのタブ URL を取得する（`permissions: ['tabs']` はこのためだけに使用）。
```

- [ ] **Step 4: 最終検証**

```bash
npm run typecheck && npm test && npm run build
```

Expected: すべて成功。`dist/` に `manifest.json`（background + tabs 権限入り）が生成される。

- [ ] **Step 5: コミット**

```bash
git add docs/e2e-checklist-phase2.md docs/requirements.md CLAUDE.md
git commit -m "docs: Phase 2 の E2E チェックリスト追加とドキュメント更新"
```

---

## Self-Review 済み事項

- 仕様カバレッジ: F2-3（Task 1/4/5/7/8）、F2-1（Task 6/7/8）、安全停止（Task 5）、i18n（Task 3）、権限（Task 6）、E2E（Task 9）。F2-2 は仕様どおりスコープ外（PR 時に issue 起票）。
- 型整合: `ImporterDeps` のメソッド名は Task 5 定義と Task 8 の deps 構築で一致。`mountImportPanel` の戻り値 API（setBusy / setProgress / removeUrls / destroy）は Task 7 定義と Task 8 の呼び出しで一致。
- 既存テスト互換: `start()` の署名変更は引数追加（既定値あり）のみで、既存 `tests/main-wiring.test.ts` の `start(document)` 呼び出しは jsdom の pathname が `/` のため従来どおり一覧ページ扱いになる。
