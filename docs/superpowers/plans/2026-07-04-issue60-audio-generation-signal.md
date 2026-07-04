# 音声解説 生成開始検知の即時シグナル化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 音声解説の生成開始検知を「テキスト一致 OR 生成カード要素の出現」の OR に拡張し、クリック直前の再チェック（W1封じ）を加えて、生成開始表示の遅延に起因する二重生成を根絶する。

**Architecture:** `selectors.ts` に生成中カード要素を返す best-effort な `getAudioGenerationCard` を新設し、`main.ts` の `isGenerating` を「既存のテキスト判定 OR 要素判定」に強化する（新セレクタが空振りしても現状と同等＝strictly better）。`notebook-creator.ts` の `triggerAudioOverview` はクリック直前に `isGenerating()` を再確認する 1 箇所だけ変更する。DI＋純粋ロジック構成は維持し、jsdom で単体テストする。

**Tech Stack:** TypeScript（strict）、Vite、Vitest（jsdom）、Chrome Manifest V3 content script。

## Global Constraints

- 権限最小化を維持（`host_permissions: notebooklm.google.com` のみ、外部ネットワーク送信ゼロ）。今回の変更で新規権限・新規ネットワークは追加しない。
- セレクタは `src/content/selectors.ts` に集約する。動的属性（`ng-tns-*` / `_ngcontent-*`）に依存しない。
- ロジックモジュールは `document` を直接触らず DI か `root: ParentNode = document` 引数を取る。
- 静的チェックのゲートは `npm run typecheck`（strict、未使用ローカル/引数はエラー）。全テストは `npm test`（vitest run, jsdom）。
- best-effort 規約: 音声トリガーの失敗（要素不在 / 生成開始せず / 中断）は例外を投げず `false` を返し `console.warn`。
- 生成開始検知は **strictly more sensitive** を守る: 既存のテキスト判定（`document.body.innerText` に対する `/生成しています|生成中|generating/i`）は残し、要素判定を OR で **追加**するだけ（削除・置換しない）。

---

## File Structure

- `src/content/selectors.ts` — `SOURCE_TEXT.audioGenerating` 定数を追加。生成中カード要素を返す `getAudioGenerationCard(root)` を新設。
- `src/content/main.ts` — `defaultCreateRunner` 内の `isGenerating` クロージャを「テキスト OR `getAudioGenerationCard`」に強化。import に `getAudioGenerationCard` と `SOURCE_TEXT` を追加。
- `src/content/notebook-creator.ts` — `triggerAudioOverview` のループで `deps.click(btn)` 直前に `isGenerating()` を再チェック（W1封じ）。
- `tests/selectors-source.test.ts` — `getAudioGenerationCard` の単体テストを追加。
- `tests/notebook-creator.test.ts` — W1再チェックの回帰テストを追加。既存の「clicks and succeeds once generation starts」を再チェック導入に合わせて更新。
- `docs/requirements.md` §8.7 / `docs/e2e-checklist-phase2.md` §2.5 — 新シグナルと実機確認待ち・確認手順を追記。

---

## Task 1: 生成カード要素シグナル `getAudioGenerationCard` の新設と配線

**Files:**
- Modify: `src/content/selectors.ts`（`SOURCE_TEXT`＝現状 63-71 行付近に `audioGenerating` 追加、末尾 `getAudioOverviewButton` の後に新関数）
- Modify: `src/content/main.ts:5`（import 追加）、`src/content/main.ts:346`（`isGenerating` 強化）
- Test: `tests/selectors-source.test.ts`（`getAudioGenerationCard` の describe/it 追加）

**Interfaces:**
- Consumes: なし（selectors.ts の既存 `SOURCE_TEXT`、`[data-nlk]` 除外パターン）
- Produces:
  - `SOURCE_TEXT.audioGenerating: RegExp`（値 `/生成しています|生成中|generating/i`。main.ts のテキスト判定と共有）
  - `getAudioGenerationCard(root: ParentNode = document): HTMLElement | null` — Studio の生成中カード（生成中テキストを含む安定クラス候補要素）を返す。該当なしは `null`。`[data-nlk]` 配下は除外。throw しない。

- [ ] **Step 1: `getAudioGenerationCard` の失敗テストを書く**

`tests/selectors-source.test.ts` の import に `getAudioGenerationCard` を追加（既存の import から `getAudioOverviewButton` の隣に）:

```ts
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton,
  getAudioOverviewButton, getAudioGenerationCard,
} from '../src/content/selectors'
```

ファイル末尾（最後の `})` の後）に describe を追加:

```ts
describe('getAudioGenerationCard', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('returns a candidate-class card that contains generating text', () => {
    document.body.innerHTML = `
      <div class="audio-overview-container">
        <span>音声解説を生成しています…</span>
      </div>`
    const card = getAudioGenerationCard()
    expect(card).not.toBeNull()
    expect(card?.classList.contains('audio-overview-container')).toBe(true)
  })

  it('returns null when no candidate card contains generating text', () => {
    document.body.innerHTML = `
      <div class="audio-overview-container"><span>音声解説</span></div>
      <p>関係ないテキスト</p>`
    expect(getAudioGenerationCard()).toBeNull()
  })

  it('ignores cards inside injected [data-nlk] UI', () => {
    document.body.innerHTML = `
      <div data-nlk="action-bar">
        <div class="audio-overview-container"><span>生成しています</span></div>
      </div>`
    expect(getAudioGenerationCard()).toBeNull()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/selectors-source.test.ts -t "getAudioGenerationCard"`
Expected: FAIL（`getAudioGenerationCard` is not exported / not a function）

- [ ] **Step 3: `SOURCE_TEXT` に `audioGenerating` を追加**

`src/content/selectors.ts` の `SOURCE_TEXT` 定数（`audioOverview` 行の直後）に追加:

```ts
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i,
  audioOverview: /音声解説|音声概要|audio overview/i,
  // 音声生成中を表す Studio の表示テキスト（生成開始検知 = 再試行停止 ＆ 二重生成防止に使う。issue #60）。
  audioGenerating: /生成しています|生成中|generating/i,
} as const
```

- [ ] **Step 4: `getAudioGenerationCard` を実装**

`src/content/selectors.ts` の `getAudioOverviewButton` 関数の直後（末尾）に追加:

```ts
// Studio の「音声解説を生成しています…」生成中カード（スピナー付きコンテナ）の要素を返す。
// #60: 生成開始を表示テキスト（body.innerText 一致）より早く・確実に検知するための即時シグナル。
// main.ts の isGenerating で「テキスト一致 OR この要素の出現」の OR に使う（strictly more sensitive）。
// 実 DOM の安定セレクタは未確定（実機確認待ち・§8.7）。best-effort: 生成中を表しうる安定クラス候補に
// 絞り、その中で生成中テキストを含む要素を返す。該当なしは null（呼び出し側がテキスト判定にフォールバック）。
// 自拡張 UI（[data-nlk]）は除外。querySelectorAll + フィルタのみで throw しない。
export function getAudioGenerationCard(root: ParentNode = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.audio-overview-container, .artifact-card, [class*="generating"], [role="status"], [aria-busy="true"]',
    ),
  ).filter((el) => !el.closest('[data-nlk]'))
  return candidates.find((el) => SOURCE_TEXT.audioGenerating.test(el.textContent ?? '')) ?? null
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/selectors-source.test.ts -t "getAudioGenerationCard"`
Expected: PASS（3 tests）

- [ ] **Step 6: `main.ts` の `isGenerating` を OR に強化**

`src/content/main.ts:5` の selectors import に `getAudioGenerationCard` と `SOURCE_TEXT` を追加。現状:

```ts
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton, getAudioOverviewButton,
```

を（同じ import 文の要素として）次のように拡張（`SOURCE_TEXT` が別行の場合は import 文の適切な位置に追加）:

```ts
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton, getAudioOverviewButton,
  getAudioGenerationCard, SOURCE_TEXT,
```

`src/content/main.ts:346` の `isGenerating` 行を置換。現状:

```ts
        // 生成開始の検知（＝再試行停止 ＆ 二重生成防止）。Studio に「生成しています」等が出たか。
        isGenerating: () => /生成しています|生成中|generating/i.test(document.body.innerText || ''),
```

を次に置換（テキスト判定は維持し、要素判定を OR で追加＝strictly more sensitive。#60）:

```ts
        // 生成開始の検知（＝再試行停止 ＆ 二重生成防止）。既存のテキスト判定に加え、生成カード要素の
        // 出現も OR で見る（表示テキストの描画遅延より早く検知しうる。strictly more sensitive。#60）。
        isGenerating: () =>
          SOURCE_TEXT.audioGenerating.test(document.body.innerText || '') ||
          getAudioGenerationCard(root) != null,
```

- [ ] **Step 7: typecheck と全テストが通ることを確認**

Run: `npm run typecheck && npm test`
Expected: typecheck エラーなし。全テスト PASS（`getAudioGenerationCard` 3 件増）。

- [ ] **Step 8: コミット**

```bash
git add src/content/selectors.ts src/content/main.ts tests/selectors-source.test.ts
git commit -m "feat(#60): 音声生成開始検知に生成カード要素シグナルをOR追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: クリック直前の再チェック（W1封じ）

**Files:**
- Modify: `src/content/notebook-creator.ts:100-101`（`waitFor(enabledTile)` 解決後・`deps.click(btn)` 直前）
- Test: `tests/notebook-creator.test.ts`（W1回帰テスト追加＋既存テスト1件更新）

**Interfaces:**
- Consumes: `AudioOverviewDeps`（`isGenerating()`, `getAudioOverviewButton()`, `click()`, `waitFor`）— 署名不変
- Produces: `triggerAudioOverview` の挙動変更（クリック直前に `isGenerating()` が true なら押さずに `true` を返す）

- [ ] **Step 1: W1回帰テストを追加し、既存テストを再チェック導入に合わせて更新**

`tests/notebook-creator.test.ts` の既存テスト「clicks and succeeds once generation starts」を更新（再チェックが入るとクリック前に `isGenerating` が 2 回呼ばれるため、生成中になるのは post-click 待ちの 3 回目にする）:

```ts
  it('clicks and succeeds once generation starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 再チェック導入後、クリック前に isGenerating は 2 回（ループ先頭プリチェック＋クリック直前）呼ばれる。
    // 生成中になるのは post-click 待ちの 3 回目 → クリックは 1 回実行される。
    let calls = 0
    const d = makeAudioDeps({ isGenerating: () => { calls++; return calls >= 3 } })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
```

同ファイルの `describe('triggerAudioOverview', ...)` 内に W1 回帰テストを追加:

```ts
  it('does not click when generation starts between pre-check and click (W1)', async () => {
    // ループ先頭プリチェックでは false、クリック直前の再チェックで true → クリックせず成功。
    let n = 0
    const d = makeAudioDeps({ isGenerating: () => { n++; return n >= 2 } })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toEqual([])
  })
```

- [ ] **Step 2: 更新後テストが（未実装ゆえ）失敗することを確認**

Run: `npx vitest run tests/notebook-creator.test.ts -t "W1"`
Expected: FAIL（再チェック未実装のため、n>=2 でも 1 回クリックしてしまい `d.clicks` が空でない）

- [ ] **Step 3: `triggerAudioOverview` にクリック直前の再チェックを実装**

`src/content/notebook-creator.ts` のループ本体、`const btn = await deps.waitFor(enabledTile, ...)` と `deps.click(btn)` の間に再チェックを挿入。現状:

```ts
      const btn = await deps.waitFor(enabledTile, { timeout: TILE_WAIT_MS, signal })
      deps.click(btn)
```

を次に置換:

```ts
      const btn = await deps.waitFor(enabledTile, { timeout: TILE_WAIT_MS, signal })
      // W1封じ（#60）: プリチェックから enabled タイル待ちの間に生成が始まっていたら押さない。
      if (deps.isGenerating()) return true
      deps.click(btn)
```

- [ ] **Step 4: 対象テストが通ることを確認**

Run: `npx vitest run tests/notebook-creator.test.ts`
Expected: PASS（W1 テスト含め全件。更新した「clicks and succeeds once generation starts」も PASS）

- [ ] **Step 5: typecheck と全テストが通ることを確認**

Run: `npm run typecheck && npm test`
Expected: typecheck エラーなし。全テスト PASS。

- [ ] **Step 6: コミット**

```bash
git add src/content/notebook-creator.ts tests/notebook-creator.test.ts
git commit -m "feat(#60): 音声トリガーでクリック直前に生成中を再チェック（W1封じ）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ドキュメント更新（§8.7 / e2e §2.5）

**Files:**
- Modify: `docs/requirements.md` §8.7（「クリックタイミング（再試行必須）」節の後）
- Modify: `docs/e2e-checklist-phase2.md` §2.5（#51 の音声解説チェック項目付近）

**Interfaces:**
- Consumes: なし（ドキュメントのみ）
- Produces: なし

- [ ] **Step 1: `docs/requirements.md` §8.7 に生成開始検知の更新を追記**

§8.7 の「クリックタイミング（再試行必須）」の箇条書きの直後に、次の箇条書きを追加:

```markdown
- **生成開始検知（テキスト＋要素の OR）**: 二重生成防止・再試行停止に使う「生成が始まったか」の判定は、
  従来の表示テキスト一致（`document.body.innerText` の「音声解説を生成しています…」等）に加え、
  **生成中カード要素の出現**（`getAudioGenerationCard`）を OR で見る（issue #60）。テキスト描画が
  `clickInterval` を超えて遅延しても、要素をより早く検知して再クリック（二重生成）を防ぐ狙い。
  さらに `triggerAudioOverview` はループ先頭のプリチェックに加え、**クリック直前にも生成中を再チェック**して
  プリチェック〜クリック間の窓を塞ぐ。**生成カードの安定セレクタと「要素の出現が表示テキストより早いか」は
  実機確認待ち**（現状は best-effort。空振りしてもテキスト判定にフォールバックし現状と同等）。`clickInterval`（30s）は
  実機で生成開始→表示の遅延を計測してから妥当値を再確認する（未計測）。
```

- [ ] **Step 2: `docs/e2e-checklist-phase2.md` §2.5 に実機確認手順を追記**

§2.5 の #51 音声解説チェック（現状 50-52 行付近）の直後に、次の項目を追加:

```markdown
- [ ] #60: 生成開始検知の実機確認。タイルをクリックしてから「音声解説を生成しています…」表示が出るまでを観察し、
  (a) 生成中カード要素の出現と表示テキストの描画のどちらが先か、(b) クリック→検知の遅延がどれくらいか、を確認する。
  DevTools で生成中カードの安定クラス（`getAudioGenerationCard` の候補セレクタが当たるか）を確認し、
  当たらなければ `selectors.ts` の候補を実 DOM に合わせて更新する。遅延が `clickInterval`（30s）に近い/超える場合は値を見直す。
```

- [ ] **Step 3: docs 変更が全テストに影響しないことを確認**

Run: `npm test`
Expected: 全テスト PASS（ドキュメントのみの変更）。

- [ ] **Step 4: コミット**

```bash
git add docs/requirements.md docs/e2e-checklist-phase2.md
git commit -m "docs(#60): 生成開始検知の更新と実機確認手順を §8.7 / e2e §2.5 に追記

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 方針1（テキスト＋要素 OR / `getAudioGenerationCard` 新設 / main.ts 強化 / strictly better）→ Task 1。
- 方針2（W1封じ = クリック直前再チェック）→ Task 2。
- 方針3（clickInterval/MAX_ATTEMPTS 据え置き）→ 変更なし（据え置きを明示、コード変更なし）。
- テスト（selectors: 拾う/null/data-nlk 除外、notebook-creator: W1回帰＋既存更新）→ Task 1 Step1 / Task 2 Step1。
- ドキュメント（§8.7 / e2e §2.5）→ Task 3。
- 受け入れ基準（typecheck+test / 拾う・null / W1 / strictly better / docs）→ 各 Task の確認ステップで担保。

**Placeholder scan:** プレースホルダなし。全コード・コマンド・期待値を明記。

**Type consistency:** `getAudioGenerationCard(root?: ParentNode): HTMLElement | null` と `SOURCE_TEXT.audioGenerating: RegExp` は Task 1 で定義し main.ts で同名利用。`AudioOverviewDeps.isGenerating` の署名は不変（Task 2 は呼び出し追加のみ）。名称の齟齬なし。
