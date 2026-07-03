# issue #47: alarms ウォッチドッグ ＋ tabId 別バッジ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F2-2 の '…' 固着ウォッチドッグを `chrome.alarms` 化し、バッジを元タブ（クリック元）スコープに統一する。

**Architecture:** 純粋ロジック（`handleClipClick` / `handleCreateResult` / `resetStuckClip` / `handlePendingCreate`）は DI のまま拡張し、`tabId` を storage（`pendingCreate`）と結果メッセージで伝搬させて元タブ X を特定する。MV3 SW のアイドル終了に耐えるため 60s の `setTimeout` を `chrome.alarms` へ置換する。alarms / onClicked / 実 `setBadge` の tabId 分岐は既存慣習どおり非ユニットテストのグルー。

**Tech Stack:** TypeScript（strict）、Vite、Vitest（jsdom）、Chrome MV3（`chrome.action` / `chrome.alarms` / `chrome.storage.local`）。

## Global Constraints

- 権限は最小限: `manifest.config.ts` の `permissions` は `['tabs', 'storage', 'alarms']`。`host_permissions` は `notebooklm.google.com` のみ。
- 外部ネットワーク送信ゼロ / トラッカー無し。
- 静的ゲートは `npm run typecheck`（strict、未使用ローカル/引数はエラー）。全テストは `npm test`（vitest run、jsdom）。
- DI ＋純粋ロジックのテスト容易性を維持（`handleClipClick` / `handleCreateResult` / `resetStuckClip` / `handlePendingCreate` は実 `chrome` / `document` に非依存のまま）。
- コミットは日本語メッセージ、末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

### Task 1: `PendingCreate` に `tabId` を追加

**Files:**
- Modify: `src/types.ts:53-56`

**Interfaces:**
- Produces: `interface PendingCreate { urls: string[]; ts: number; tabId?: number }`

- [ ] **Step 1: 型を変更**

`src/types.ts` の `PendingCreate` を次のようにする（コメントも更新）:

```typescript
// F2-2（現ページから新規ノートブック作成）: 実行待ちの URL 群（storage.local）。
// 実行後クリア＋ts 古さガードで残留を無視する。
// tabId はクリック元タブ（バッジ表示先）。tab.id 欠落時は undefined。
export interface PendingCreate {
  urls: string[]
  ts: number
  tabId?: number
}
```

- [ ] **Step 2: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし（`tabId?` はオプショナルのため既存の生成箇所は未変更でも通る）。

- [ ] **Step 3: コミット**

```bash
git add src/types.ts
git commit -m "issue #47: PendingCreate に tabId を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `handleClipClick` / `handleCreateResult` / `resetStuckClip` / `ClipDeps` を tabId 対応にする

**Files:**
- Modify: `src/background/main.ts:52-101`（`ClipDeps` と 3 関数）
- Test: `tests/background-clip.test.ts`

**Interfaces:**
- Consumes: `PendingCreate`（Task 1、`tabId?: number` 付き）
- Produces:
  - `interface ClipDeps { ...; setBadge(text: string, tabId?: number): void; ... }`
  - `handleClipClick(clickedUrl: string | undefined, tabId: number | undefined, d: ClipDeps): Promise<void>`
  - `handleCreateResult(ok: boolean, tabId: number | undefined, d: Pick<ClipDeps, 'setBadge'>): void`
  - `resetStuckClip(d: Pick<ClipDeps, 'storageGet' | 'storageRemove' | 'setBadge'>): Promise<void>`（シグネチャ不変、内部で `pending.tabId` を使用）

- [ ] **Step 1: 失敗するテストを書く**

`tests/background-clip.test.ts` を次の内容に置き換える（`badges` を `{ text, tabId }` 記録に変更し、tabId 検証を追加）:

```typescript
import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleClipClick, handleCreateResult, resetStuckClip, type ClipDeps } from '../src/background/main'

type Badge = { text: string; tabId?: number }

function makeDeps(): ClipDeps & {
  set: Mock<[Record<string, unknown>], Promise<void>>
  created: unknown[]
  badges: Badge[]
  removed: string[]
} {
  const created: unknown[] = []
  const badges: Badge[] = []
  const removed: string[] = []
  const set = vi.fn(async (_i: Record<string, unknown>) => {})
  return {
    created, badges, set, removed,
    storageSet: set,
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    now: () => 1000,
    storageGet: vi.fn(async (_k: string) => ({})),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
  }
}

describe('handleClipClick', () => {
  it('badges "!" on the source tab and does nothing for a non-http url', async () => {
    const d = makeDeps()
    await handleClipClick('chrome://extensions/', 7, d)
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('stores pendingCreate with tabId and badges "…" on the source tab', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', 7, d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: 7 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: true }])
    expect(d.badges).toContainEqual({ text: '…', tabId: 7 })
  })

  it('stores tabId undefined when the clicked tab has no id (global fallback)', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', undefined, d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: undefined } })
    expect(d.badges).toContainEqual({ text: '…', tabId: undefined })
  })

  it('falls back to "!" on the source tab without throwing when storageSet rejects', async () => {
    const d = makeDeps()
    d.storageSet = vi.fn(async () => { throw new Error('storage unavailable') })
    await expect(handleClipClick('https://x.example/', 7, d)).resolves.toBeUndefined()
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
  })

  it('falls back to "!" and removes pendingCreate when createTab rejects', async () => {
    const d = makeDeps()
    d.createTab = vi.fn(async () => { throw new Error('no tab') })
    await expect(handleClipClick('https://x.example/', 7, d)).resolves.toBeUndefined()
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
    expect(d.removed).toEqual(['pendingCreate'])
  })
})

describe('resetStuckClip', () => {
  it('badges "!" on the stored tabId and removes pendingCreate when it is still present', async () => {
    const badges: Badge[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: 9 } }),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    })
    expect(badges).toEqual([{ text: '!', tabId: 9 }])
    expect(removed).toEqual(['pendingCreate'])
  })

  it('does nothing when pendingCreate is already gone (normal flow completed)', async () => {
    const badges: Badge[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({}),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    })
    expect(badges).toEqual([])
    expect(removed).toEqual([])
  })
})

describe('handleCreateResult', () => {
  it('badges check/bang on the given tabId', () => {
    const badges: Badge[] = []
    const setBadge = (text: string, tabId?: number) => { badges.push({ text, tabId }) }
    handleCreateResult(true, 3, { setBadge })
    handleCreateResult(false, 3, { setBadge })
    expect(badges).toEqual([{ text: '✓', tabId: 3 }, { text: '!', tabId: 3 }])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/background-clip.test.ts`
Expected: FAIL（`handleClipClick` の引数不一致 / `setBadge` シグネチャ不一致による型・アサーション失敗）。

- [ ] **Step 3: 実装する**

`src/background/main.ts` の `ClipDeps` と 3 関数を次のように変更する。

`ClipDeps` の `setBadge`（52-59 行付近）:

```typescript
export interface ClipDeps {
  storageSet(items: Record<string, unknown>): Promise<void>
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  setBadge(text: string, tabId?: number): void
  now(): number
}
```

`handleClipClick`（63-81 行付近）:

```typescript
// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームをフォアグラウンドで開く（content script が新規作成を実行）。
// tabId はクリック元タブ。バッジはすべてこのタブにスコープする（元タブ X に統一）。
export async function handleClipClick(
  clickedUrl: string | undefined,
  tabId: number | undefined,
  d: ClipDeps,
): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!', tabId)
    return
  }
  // storage/tabs は reject し得る。失敗しても badge '!' に帰着させ '…' 固着を防ぐ。
  try {
    const pending: PendingCreate = { urls: [clickedUrl], ts: d.now(), tabId }
    await d.storageSet({ pendingCreate: pending })
    d.setBadge('…', tabId)
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
  } catch {
    // M-1: storageSet 後に createTab が失敗すると pendingCreate が残留し、後で
    // 手動で NotebookLM を開いた際に意図しない自動作成を招く。二重障害でも
    // ここは投げずに badge '!' へ帰着させる。
    await d.storageRemove('pendingCreate').catch(() => {})
    d.setBadge('!', tabId)
  }
}
```

`handleCreateResult`（84-86 行付近）:

```typescript
// content からの作成結果でバッジを更新する（元タブにスコープ）。
export function handleCreateResult(ok: boolean, tabId: number | undefined, d: Pick<ClipDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!', tabId)
}
```

`resetStuckClip`（94-101 行付近）:

```typescript
export async function resetStuckClip(
  d: Pick<ClipDeps, 'storageGet' | 'storageRemove' | 'setBadge'>,
): Promise<void> {
  const got = await d.storageGet('pendingCreate')
  const pending = got.pendingCreate as PendingCreate | undefined
  if (pending === undefined) return
  d.setBadge('!', pending.tabId)
  await d.storageRemove('pendingCreate')
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/background-clip.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 5: typecheck を確認**

Run: `npm run typecheck`
Expected: エラーあり（配線部が旧シグネチャで呼んでいるため）。この時点では Task 4 で解消する想定なので、ここでは**テストのみ緑**であればよい。配線を触らずに一旦コミットする。

- [ ] **Step 6: コミット**

```bash
git add src/background/main.ts tests/background-clip.test.ts
git commit -m "issue #47: バッジ純粋ロジックを tabId 対応にする

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `handlePendingCreate` が結果メッセージに tabId をエコーする

**Files:**
- Modify: `src/content/main.ts:275-297`
- Test: `tests/create-wiring.test.ts`

**Interfaces:**
- Consumes: `PendingCreate`（Task 1、`tabId?: number`）
- Produces: content → background メッセージ `{ type: CREATE_RESULT_MESSAGE, ok: boolean, tabId?: number }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/create-wiring.test.ts` の該当テストを更新し、tabId エコーのケースを追加する。既存の 2 ケースの期待値に `tabId` を反映し、末尾に新ケースを足す:

`'runs a fresh pendingCreate, clears it first, and reports the result'` の env と期待値:

```typescript
  it('runs a fresh pendingCreate, clears it first, and reports the result with tabId echoed', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.removed).toEqual(['pendingCreate']) // 実行前クリア
    expect(run).toHaveBeenCalledWith(['https://a/'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true, tabId: 5 }])
  })
```

`'reports failure when run returns false'`:

```typescript
  it('reports failure when run returns false', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => false)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
  })
```

`'reports failure and does not throw when run rejects (M-3)'`:

```typescript
  it('reports failure and does not throw when run rejects (M-3)', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => { throw new Error('dom blew up') })
    await expect(handlePendingCreate(env, run)).resolves.toBeUndefined()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
  })
```

末尾に、tabId 無し（旧データ / tab.id 欠落）のケースを追加:

```typescript
  it('echoes tabId undefined when pendingCreate has no tabId', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true, tabId: undefined }])
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/create-wiring.test.ts`
Expected: FAIL（送信メッセージに `tabId` が無いためアサーション不一致）。

- [ ] **Step 3: 実装する**

`src/content/main.ts` の `handlePendingCreate` 末尾の送信を、`pending.tabId` を含める形にする（289-296 行付近）:

```typescript
  let ok: boolean
  try {
    ok = await run(pending.urls)
  } catch (err) {
    console.error('notebooklmkit: unexpected error during pending create', err)
    ok = false
  }
  // 元タブ X（クリック元）でバッジを更新できるよう、pendingCreate に載っていた
  // tabId をそのまま background に返す（content はタブ Y 上で走るため sender.tab.id は使えない）。
  env.sendMessage({ type: CREATE_RESULT_MESSAGE, ok, tabId: pending.tabId })
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/create-wiring.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 5: コミット**

```bash
git add src/content/main.ts tests/create-wiring.test.ts
git commit -m "issue #47: create-result に tabId をエコーバックする

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 配線を alarms ＋ tabId 別バッジに更新（manifest / background グルー）

**Files:**
- Modify: `manifest.config.ts:12`
- Modify: `src/background/main.ts:103-131`（`chrome.action?.onClicked` グルーブロック）

**Interfaces:**
- Consumes: `handleClipClick(url, tabId, deps)` / `handleCreateResult(ok, tabId, deps)` / `resetStuckClip(deps)`（Task 2）
- Produces: 実 chrome への配線（非ユニットテスト。typecheck ＋ E2E で担保）

- [ ] **Step 1: manifest に `alarms` 権限を追加**

`manifest.config.ts` の `permissions`（12 行付近）とコメントを更新:

```typescript
  // tabs は F2-1（開いているタブの一括インポート）でタブの URL / title を読むためだけに使用。
  // storage は F2-2（現ページから新規ノートブック作成）で pendingCreate を保持するためだけに使用。
  // alarms は F2-2 の '…' 固着ウォッチドッグ（MV3 SW のアイドル終了に耐える）に使用。
  // 取得したデータは端末内で完結し、外部送信はしない（docs/requirements.md §3.3）。
  permissions: ['tabs', 'storage', 'alarms'],
```

- [ ] **Step 2: background の配線ブロックを更新**

`src/background/main.ts` 末尾の `if (typeof chrome !== 'undefined' && chrome.action?.onClicked)` ブロック（103-131 行）を次に置き換える:

```typescript
// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境では登録しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const STUCK_ALARM = 'nlk-reset-stuck'
  const clearLater = (t: string, tabId?: number) => {
    if (t === '✓' || t === '!') {
      setTimeout(() => {
        void chrome.action.setBadgeText(tabId !== undefined ? { text: '', tabId } : { text: '' })
      }, 4000)
    }
  }
  const deps: ClipDeps = {
    storageSet: (i) => chrome.storage.local.set(i),
    storageGet: (k) => chrome.storage.local.get(k),
    storageRemove: (k) => chrome.storage.local.remove(k),
    createTab: (p) => chrome.tabs.create(p),
    setBadge: (text, tabId) => {
      void chrome.action.setBadgeText(tabId !== undefined ? { text, tabId } : { text })
      clearLater(text, tabId)
    },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { id?: number; url?: string }) => {
    void handleClipClick(tab?.url, tab?.id, deps)
    // I-1: バッジ '…' 固着ウォッチドッグ。MV3 の SW はアイドルで終了され得るため
    // setTimeout ではなく chrome.alarms を使う（SW 終了後も再起動して発火する）。
    // 正常フローでは content が pendingCreate を実行前クリアするため resetStuckClip は no-op。
    chrome.alarms.create(STUCK_ALARM, { delayInMinutes: 1 })
  })
  chrome.alarms.onAlarm.addListener((alarm: { name?: string }) => {
    if (alarm.name === STUCK_ALARM) void resetStuckClip(deps)
  })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean; tabId?: number } | null
    if (m?.type === CREATE_RESULT_MESSAGE) handleCreateResult(!!m.ok, m.tabId, deps)
  })
}
```

- [ ] **Step 3: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし（配線が新シグネチャに一致）。

- [ ] **Step 4: 全テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS。

- [ ] **Step 5: ビルドが通ることを確認**

Run: `npm run build`
Expected: 成功（`dist/` 生成。manifest に `alarms` 権限が入る）。

- [ ] **Step 6: コミット**

```bash
git add manifest.config.ts src/background/main.ts
git commit -m "issue #47: 配線を alarms ウォッチドッグ ＋ tabId 別バッジに更新

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: E2E チェックリストに確認項目を追記

**Files:**
- Modify: `docs/e2e-checklist-phase2.md`

**Interfaces:**
- Consumes: なし（ドキュメントのみ）

- [ ] **Step 1: 既存のバッジ関連セクションを確認**

Run: `grep -n "バッジ\|badge\|pendingCreate\|固着\|クリップ\|F2-2\|ツールバー" docs/e2e-checklist-phase2.md`
Expected: F2-2 / バッジ関連の既存項目の位置を把握（無ければ末尾に新セクションを作る）。

- [ ] **Step 2: 確認項目を追記**

F2-2 / バッジ関連セクション（無ければ新規「## issue #47: alarms ウォッチドッグ / tabId 別バッジ」）に、既存記法に合わせて次を追加:

```markdown
- [ ] 未ログイン等で content script が走らないページを開いた状態でツールバーアイコンをクリックし、バッジが '…' になること。約 1 分後に '!' へ落ちること（alarms ウォッチドッグ）。
- [ ] 異なるページを開いた複数タブで短時間に連続してツールバーアイコンをクリックし、各タブのバッジが相互に上書きされないこと（tabId 別スコープ）。
- [ ] 正常フロー（http ページでクリック → NotebookLM で新規作成成功）で、クリック元タブのバッジが最終的に '✓' になること。
```

- [ ] **Step 3: コミット**

```bash
git add docs/e2e-checklist-phase2.md
git commit -m "issue #47: E2E チェックリストに alarms / tabId 別バッジの確認項目を追記

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Part 1（alarms）: Task 4（manifest `alarms` 権限 ＋ `chrome.alarms.create` / `onAlarm`）✓
- Part 2（tabId 伝搬）: `PendingCreate.tabId` = Task 1 ✓ / `ClipDeps.setBadge` ＋ 3 関数 = Task 2 ✓ / content エコー = Task 3 ✓ / 配線（onClicked の tab.id、実 setBadge、clearLater、onMessage）= Task 4 ✓
- スコープ外（badge 色 / '!' 区別）: 計画に含めず（正しい）✓
- テスト: background-clip = Task 2 ✓ / create-wiring = Task 3 ✓ / グルー非テスト = Task 4 で typecheck+build ✓ / E2E 追記 = Task 5 ✓

**2. Placeholder scan:** TBD / TODO / 「適切に」等なし。全コードブロックは実内容。✓

**3. Type consistency:**
- `setBadge(text: string, tabId?: number)` は ClipDeps / makeDeps / 実配線 / resetStuckClip の Pick で一致 ✓
- `handleClipClick(url, tabId, d)` / `handleCreateResult(ok, tabId, d)` は Task 2 定義と Task 4 呼び出しで一致 ✓
- 結果メッセージ `{ type, ok, tabId? }` は Task 3（送信）と Task 4（`m.tabId` 受信）で一致 ✓
- `STUCK_ALARM = 'nlk-reset-stuck'` は create / onAlarm で同一定数 ✓
- 注記: Task 2 Step 5 の時点では配線が旧シグネチャで typecheck が一時的に赤になる。これは意図的で、Task 4 完了時に緑になる（Task 2 のゲートはテスト緑、Task 4 のゲートが typecheck 緑）。
