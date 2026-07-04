# #51 新規ノートブック作成後に音声解説（Audio Overview）を自動押下 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ツールバー起動の新規ノートブック作成が成功した後、音声解説（Audio Overview）の生成ボタンを自動押下する。押下失敗は best-effort（作成成功のバッジ '✓' は変えない）。

**Architecture:** 音声解説押下を `createNotebookWithUrls` の内部に混ぜず、独立関数 `triggerAudioOverview(deps)` として分離（単一責務・独立テスト可能）。セレクタ `getAudioOverviewButton` は `selectors.ts` に集約し、text/aria-label 一致の暫定ヒューリスティック（実機 E2E で堅牢化）。`defaultCreateRunner` が作成成功時のみ best-effort で呼ぶ。

**Tech Stack:** TypeScript / Manifest V3 / Vitest（jsdom）

## Global Constraints

- **セレクタは `src/content/selectors.ts` に集約。** 安定クラス `mdc-*`/`mat-*` を優先、`ng-tns-*`/`_ngcontent-*` には依存しない。自拡張 UI（`[data-nlk]` 配下）は除外。
- **DI ＋純粋ロジックでテスト可能に。** ロジックモジュールは `document` を直接触らず、協力オブジェクト or `root: ParentNode` 引数を受け取る。
- 権限最小化・外部ネットワーク送信ゼロを維持。
- 静的チェックのゲートは `npm run typecheck`。テストは `npm test`（vitest, jsdom）。
- ja/en 両対応（`SOURCE_TEXT` のテキストマッチ）。

---

### Task 1: `getAudioOverviewButton` セレクタと `SOURCE_TEXT.audioOverview` を追加

**Files:**
- Modify: `src/content/selectors.ts`（`SOURCE_TEXT` に1行、末尾に関数1つ）
- Test: `tests/selectors-source.test.ts`（末尾に describe 追加）

**Interfaces:**
- Produces:
  - `SOURCE_TEXT.audioOverview: RegExp`（`/音声解説|音声概要|Audio Overview/i`）
  - `getAudioOverviewButton(root?: ParentNode): HTMLElement | null`

- [ ] **Step 1: 失敗するテストを追加**

`tests/selectors-source.test.ts` の import に `getAudioOverviewButton` を足す:

```typescript
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton,
  getAudioOverviewButton,
} from '../src/content/selectors'
```

ファイル末尾の `})`（describe 閉じ）の直前に次のテスト群を追加する:

```typescript
  it('getAudioOverviewButton matches ja「音声解説」text', () => {
    document.body.innerHTML = `
      <button>メモを追加</button>
      <button><span>音声解説を生成</span></button>`
    expect(getAudioOverviewButton()?.textContent).toContain('音声解説')
  })

  it('getAudioOverviewButton matches ja「音声概要」text', () => {
    document.body.innerHTML = `<button><span>音声概要</span></button>`
    expect(getAudioOverviewButton()?.textContent).toContain('音声概要')
  })

  it('getAudioOverviewButton matches en「Audio Overview」text and aria-label', () => {
    document.body.innerHTML = `<button>Generate Audio Overview</button>`
    expect(getAudioOverviewButton()?.textContent).toContain('Audio Overview')
    document.body.innerHTML = `<button aria-label="Audio Overview"><span>▶</span></button>`
    expect(getAudioOverviewButton()?.getAttribute('aria-label')).toBe('Audio Overview')
  })

  it('getAudioOverviewButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `<div data-nlk="x"><button>音声解説</button></div>`
    expect(getAudioOverviewButton()).toBeNull()
  })

  it('getAudioOverviewButton does not match unrelated buttons', () => {
    document.body.innerHTML = `<button>ノートを追加</button>`
    expect(getAudioOverviewButton()).toBeNull()
  })

  it('getAudioOverviewButton returns a disabled matching button (enabled-check is the caller responsibility)', () => {
    document.body.innerHTML = `<button disabled><span>音声解説を生成</span></button>`
    // セレクタは disabled でも返す。有効化待ちは triggerAudioOverview 側で行う（getSourceSubmitButton と同じ分離）。
    expect(getAudioOverviewButton()).not.toBeNull()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/selectors-source.test.ts -t "getAudioOverviewButton"`
Expected: FAIL（`getAudioOverviewButton` が未定義でインポートエラー）

- [ ] **Step 3: セレクタを実装**

`src/content/selectors.ts` の `SOURCE_TEXT` 定数に `audioOverview` を追加する。現状:

```typescript
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i,
} as const
```

を次に変更する:

```typescript
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i,
  audioOverview: /音声解説|音声概要|audio overview/i,
} as const
```

同ファイル末尾に次の関数を追加する:

```typescript
// Studio パネルの「音声解説 / 音声概要 / Audio Overview」生成ボタン。
// 暫定セレクタ（実機未確認 —— docs/requirements.md §8.7）。§8.6 と同じく text / aria-label
// マッチを主軸にし、自拡張 UI（[data-nlk]）は除外する。実機調査後に安定クラス（mat-*/mdc-*）で
// 候補を絞って堅牢化する。disabled でも返す（有効化待ちは triggerAudioOverview 側の責務）。
export function getAudioOverviewButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => SOURCE_TEXT.audioOverview.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.audioOverview.test(b.textContent ?? '')) ??
    null
  )
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: Commit**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "#51: 音声解説ボタンの暫定セレクタ getAudioOverviewButton を追加"
```

---

### Task 2: `triggerAudioOverview` 関数を追加

**Files:**
- Modify: `src/content/notebook-creator.ts`（`AudioOverviewDeps` interface ＋ `triggerAudioOverview` 関数を追加）
- Test: `tests/notebook-creator.test.ts`（末尾に describe 追加）

**Interfaces:**
- Consumes: 既存 `import type { waitFor as WaitFor } from './dom-utils'`
- Produces:
  - `AudioOverviewDeps { getAudioOverviewButton(): HTMLElement | null; click(el: HTMLElement): void; waitFor: typeof WaitFor; timeout?: number }`
  - `triggerAudioOverview(deps: AudioOverviewDeps, opts?: { signal?: AbortSignal }): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを追加**

`tests/notebook-creator.test.ts` の import を次に変更する:

```typescript
import {
  createNotebookWithUrls, triggerAudioOverview,
  type CreatorDeps, type AudioOverviewDeps,
} from '../src/content/notebook-creator'
```

ファイル末尾に次の describe を追加する（既存 `fakeWaitFor` を再利用する）:

```typescript
function makeAudioDeps(over: Partial<AudioOverviewDeps> = {}): AudioOverviewDeps & { clicks: HTMLElement[] } {
  const btn = { disabled: false } as unknown as HTMLElement
  const clicks: HTMLElement[] = []
  return {
    clicks,
    getAudioOverviewButton: () => btn,
    click: (el) => { clicks.push(el) },
    waitFor: fakeWaitFor,
    ...over,
  }
}

describe('triggerAudioOverview', () => {
  it('clicks the audio-overview button when present and enabled', async () => {
    const d = makeAudioDeps()
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toHaveLength(1)
  })

  it('returns false without clicking when the button never appears', async () => {
    const d = makeAudioDeps({ getAudioOverviewButton: () => null })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
  })

  it('returns false while the button stays disabled (waits for enabled)', async () => {
    const disabled = { disabled: true } as unknown as HTMLElement
    const d = makeAudioDeps({ getAudioOverviewButton: () => disabled })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/notebook-creator.test.ts -t "triggerAudioOverview"`
Expected: FAIL（`triggerAudioOverview` が未定義でインポートエラー）

- [ ] **Step 3: 関数を実装**

`src/content/notebook-creator.ts` の末尾（`createNotebookWithUrls` の後）に次を追加する:

```typescript
export interface AudioOverviewDeps {
  getAudioOverviewButton(): HTMLElement | null
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// #51: ノートブック作成後に音声解説（Audio Overview）の生成ボタンを1回押す。
// 「ボタンが present かつ enabled（disabled でない）になるまで waitFor → click」。
// ソース解析中はボタンが無効/未表示のことがあるため、既定タイムアウトは作成フロー（15s）より
// 長い 30s（E2E で調整）。呼び出し側が best-effort で握りつぶすため、失敗（要素不在 / 無効の
// まま / タイムアウト / 中断）は例外を投げず false を返す（createNotebookWithUrls と同じ規約）。
export async function triggerAudioOverview(
  deps: AudioOverviewDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const { signal } = opts
  const timeout = deps.timeout ?? 30000
  try {
    const btn = await deps.waitFor(() => {
      const b = deps.getAudioOverviewButton()
      if (!b) return null
      return (b as HTMLButtonElement).disabled ? null : b
    }, { timeout, signal })
    deps.click(btn)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `npx vitest run tests/notebook-creator.test.ts`
Expected: PASS（既存＋新規すべて）

- [ ] **Step 5: Commit**

```bash
git add src/content/notebook-creator.ts tests/notebook-creator.test.ts
git commit -m "#51: triggerAudioOverview（音声解説の生成トリガー・best-effort）を追加"
```

---

### Task 3: `defaultCreateRunner` に best-effort 配線し、docs を更新

**Files:**
- Modify: `src/content/main.ts`（import 2 箇所 ＋ `defaultCreateRunner`）
- Modify: `docs/requirements.md`（§8.7 を追加）
- Modify: `docs/e2e-checklist-phase2.md`（F2-2 に確認項目を追記）

**Interfaces:**
- Consumes: Task 1 の `getAudioOverviewButton`、Task 2 の `triggerAudioOverview`、既存 `waitFor`/`safeClick`

**Note:** `defaultCreateRunner` は未エクスポートの薄いグルーで、既存も単体テストを持たない（`handlePendingCreate` 経由で `run` を注入してテストする方針）。本タスクも同方針に従い、グルーの新規単体テストは足さず、`npm run typecheck` と `npm test`（既存 `create-wiring.test.ts` の回帰）で検証する。

- [ ] **Step 1: import を追加**

`src/content/main.ts` の selectors import に `getAudioOverviewButton` を足す。現状:

```typescript
import {
  getNotebookRows, getRowIdentity, findRowByIdentity, getRowKey,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton,
} from './selectors'
```

を次に変更する:

```typescript
import {
  getNotebookRows, getRowIdentity, findRowByIdentity, getRowKey,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton, getAudioOverviewButton,
} from './selectors'
```

続いて notebook-creator import を次に変更する。現状:

```typescript
import { createNotebookWithUrls } from './notebook-creator'
```

を:

```typescript
import { createNotebookWithUrls, triggerAudioOverview } from './notebook-creator'
```

- [ ] **Step 2: `defaultCreateRunner` を best-effort 配線に変更**

`src/content/main.ts` の現状:

```typescript
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

を次に変更する:

```typescript
function defaultCreateRunner(root: ParentNode): (urls: string[]) => Promise<boolean> {
  return async (urls) => {
    const ok = await createNotebookWithUrls(urls, {
      getCreateNewButton: () => getCreateNewButton(root),
      getSourceDialog: () => getSourceDialog(),
      getWebsiteChip,
      getUrlInput: getSourceUrlInput,
      getSubmitButton: getSourceSubmitButton,
      setInputValue,
      click: (el) => { safeClick(el) },
      waitFor,
    })
    // #51: 作成成功時のみ、音声解説の生成トリガーを best-effort で押す。
    // 失敗しても作成成功（ok）は変えない（triggerAudioOverview は例外を投げないが防御的に try/catch）。
    if (ok) {
      try {
        await triggerAudioOverview({
          getAudioOverviewButton: () => getAudioOverviewButton(root),
          click: (el) => { safeClick(el) },
          waitFor,
        })
      } catch (err) {
        console.warn('notebooklmkit: audio overview trigger failed', err)
      }
    }
    return ok
  }
}
```

- [ ] **Step 3: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: どちらも成功（`create-wiring.test.ts` 含む既存テストは回帰なし）

- [ ] **Step 4: requirements.md に §8.7 を追加**

`docs/requirements.md` の `## 8.6 ...` セクションの直後（`## 9. スコープ外` の前）に次を挿入する:

```markdown
## 8.7 音声解説（Audio Overview）生成ボタン DOM 調査（暫定・実機未確認）

#51 でツールバー作成後に音声解説の生成をトリガーする。ボタンのセレクタは**暫定**で、
`getAudioOverviewButton`（`src/content/selectors.ts`）が text / aria-label
（`SOURCE_TEXT.audioOverview` = `/音声解説|音声概要|audio overview/i`）で一致させる。
自拡張 UI（`[data-nlk]`）は除外。§8.6 と同じく「暫定 → 実機 E2E で堅牢化」の二段階。

実機 E2E（`docs/e2e-checklist-phase2.md`）で以下を確定し、必要なら安定クラス（`mat-*`/`mdc-*`）で
候補を絞って堅牢化する:

- Studio パネルの音声解説生成ボタンの安定クラス / aria-label の実値。
- ボタンが present + enabled になるタイミング（ソース解析中は無効の可能性）と、`triggerAudioOverview`
  の既定タイムアウト 30s の妥当性。
- 生成前にカスタマイズ / 確認ダイアログが挟まるか（挟まる場合の操作は別対応・現状スコープ外）。
```

- [ ] **Step 5: e2e-checklist-phase2.md に確認項目を追記**

`docs/e2e-checklist-phase2.md` の `## 2.5 F2-2: ...` セクション内に、次の趣旨の項目を追記する:

```markdown
- [ ] #51: 作成完了後、音声解説（Audio Overview）の生成ボタンが自動押下され、生成が始まる。
  - [ ] ソース解析中でボタンが無効な場合、有効化を待って押される（30s 以内。超過時は best-effort で諦め、作成自体は '✓' のまま）。
  - [ ] 音声解説の押下に失敗しても、ノートブック作成のバッジは '✓'（作成成功と切り離し）。console に warning のみ。
  - [ ] 生成前にカスタマイズ / 確認ダイアログが出るか観察（出る場合は別対応の要否をメモ）。
```

（見出し・記法は実ファイルに合わせる。）

- [ ] **Step 6: Commit**

```bash
git add src/content/main.ts docs/requirements.md docs/e2e-checklist-phase2.md
git commit -m "#51: 作成成功時に音声解説トリガーを best-effort 配線し docs を更新"
```

---

## Self-Review

- **Spec coverage:**
  - 独立関数分離 → Task 2。
  - `SOURCE_TEXT.audioOverview` ＋ `getAudioOverviewButton`（text/aria-label・data-nlk 除外・暫定コメント）→ Task 1。
  - present+enabled 待ち・専用タイムアウト 30s → Task 2。
  - best-effort 配線（作成成功と切り離し・console.warn）→ Task 3 Step 2。
  - §8 追記・E2E 追記 → Task 3 Step 4/5。
  - グルー未テストは既存 `defaultCreateRunner` の方針に準拠（Task 3 Note に明記）。
- **Placeholder scan:** なし（全 code step に実コードあり）。
- **Type consistency:**
  - `getAudioOverviewButton(root?: ParentNode): HTMLElement | null` は Task 1 定義・Task 3 で `() => getAudioOverviewButton(root)` として消費。一致。
  - `triggerAudioOverview(deps: AudioOverviewDeps, opts?): Promise<boolean>` は Task 2 定義・Task 3 で `await triggerAudioOverview({...})` として消費。`AudioOverviewDeps` のプロパティ名（`getAudioOverviewButton`/`click`/`waitFor`/`timeout?`）は Task 3 の配線と一致。
