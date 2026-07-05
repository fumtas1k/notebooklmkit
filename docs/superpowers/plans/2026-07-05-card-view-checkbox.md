# カード表示チェックボックス注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ノートブック一覧のカード（グリッド）表示でも、一覧表示と同様に削除用チェックボックスを注入し一括選択・削除できるようにする。

**Architecture:** セレクタ抽象（`getNotebookRows` / `getRowIdentity` / 注入ホスト取得 / `isDeletableRow`）をテーブル・カード両モード対応に拡張する。ページは常に一方のモードなので行列挙は両セレクタの和集合で足りる。注入ホストは新設 `getCheckboxHost` がモード別に返す。`main.ts` / `action-bar.ts` / `deleter.ts` は変更しない。

**Tech Stack:** TypeScript（strict）, Vite, Vitest（jsdom）, Chrome Manifest V3 content script。

## Global Constraints

- セレクタは `src/content/selectors.ts` の `SELECTORS` に集約する。安定クラス `mdc-*` / `mat-*` と Angular コンポーネントタグ（`project-table` / `project-button` / `project-action-button` 等）のみに依存し、`ng-tns-*` / `_ngcontent-*` には依存しない。
- **`main.ts` と `action-bar.ts` は変更しない**（別セッションの issue #31 との衝突回避）。本タスクは `selectors.ts` / `row-checkbox.ts` / `row-checkbox.css` とテストに閉じる。
- ロジックは DI ＋ `root: ParentNode = document` 引数でテスト可能に保つ（jsdom フラグメントを渡せる）。
- 注入 DOM には `data-nlk` 属性を付ける。チェックボックスは `CHECKBOX_ATTR`（`data-nlk-checkbox`）。
- 静的ゲートは `npm run typecheck`（strict / 未使用ローカル・引数エラー）。
- 権限最小化・外部送信ゼロ・日英 i18n を維持（本タスクで新規権限・ネットワーク・文言を追加しない）。

---

### Task 1: セレクタをモード対応にする（selectors.ts）

**Files:**
- Modify: `src/content/selectors.ts`（`SELECTORS` にカード用セレクタ追加、`getNotebookRows` / `getRowIdentity` 拡張、`getCheckboxHost` 新設）
- Test: `tests/selectors.test.ts`（カード DOM のテスト追加）

**Interfaces:**
- Produces: `SELECTORS.cardRow: 'project-button.project-button'`, `SELECTORS.cardTitle: 'span.project-button-title'`, `SELECTORS.cardCheckboxHost: 'div.project-button-box'`, `SELECTORS.cardActionButton: 'project-action-button'`（すべて `as const`）
- Produces: `interface CheckboxHost { host: HTMLElement; before: Node | null }`
- Produces: `getCheckboxHost(row: HTMLElement): CheckboxHost | null` — テーブル行はタイトルセルと先頭挿入、カード行は box と3点メニュー直前の挿入位置を返す。どちらも無ければ null。
- Consumes（Task 2 が使う）: 上記に加え、既存の `getNotebookRows` / `getRowIdentity` / `isDeletableRow`（挙動はカード行にも波及）。

- [ ] **Step 1: カード DOM のテストを書く（失敗させる）**

`tests/selectors.test.ts` の import に `getCheckboxHost` を追加する（既存 import 文へ）:

```ts
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getListObserveTarget, getCheckboxHost, isDeletableRow,
} from '../src/content/selectors'
```

ファイル末尾に以下の describe を追加する:

```ts
// カード（グリッド）表示の DOM（requirements §8.8）。1枚目=所有カード（moreButton あり）、
// 2枚目=おすすめカード（moreButton 無し・project-action-button 無し）。
const CARD_HTML = `
<div class="all-projects-container"><div class="my-projects-container">
  <project-button class="project-button"><mat-card class="project-button-card">
    <a class="primary-action-button" role="link"></a>
    <div class="project-button-box">
      <div class="project-button-box-icon">💻</div>
      <project-action-button><button class="project-button-more" aria-label="プロジェクトの操作メニュー"></button></project-action-button>
    </div>
    <div><span class="project-button-title">Gamma</span></div>
    <div class="project-button-subtitle"><span>出典: 1 件</span></div>
  </mat-card></project-button>
  <project-button class="project-button"><mat-card class="project-button-card">
    <a class="primary-action-button" role="link"></a>
    <div class="project-button-box"><div class="project-button-box-icon">🌐</div></div>
    <div><span class="project-button-title">Recommended</span></div>
  </mat-card></project-button>
</div></div>`

describe('selectors (card / grid view)', () => {
  beforeEach(() => { document.body.innerHTML = CARD_HTML })

  it('lists project-button cards as notebook rows', () => {
    expect(getNotebookRows().length).toBe(2)
  })

  it('reads identity from the card title span', () => {
    const first = getNotebookRows()[0]
    expect(getRowIdentity(first).title).toBe('Gamma')
  })

  it('treats a card with a more button as deletable and one without as non-deletable', () => {
    const [owned, recommended] = getNotebookRows()
    expect(isDeletableRow(owned)).toBe(true)
    expect(isDeletableRow(recommended)).toBe(false)
  })

  it('returns the box as host and the action button as insert-before for a card', () => {
    const owned = getNotebookRows()[0]
    const placement = getCheckboxHost(owned)!
    expect(placement.host.classList.contains('project-button-box')).toBe(true)
    expect((placement.before as HTMLElement).tagName.toLowerCase()).toBe('project-action-button')
  })
})

describe('getCheckboxHost (table view)', () => {
  beforeEach(() => { document.body.innerHTML = LIST_HTML })

  it('returns the title cell as host and its first child as insert-before', () => {
    const row = getNotebookRows()[0]
    const placement = getCheckboxHost(row)!
    expect(placement.host.classList.contains('title-column')).toBe(true)
    // 先頭に挿入するため before は title セルの現在の先頭ノード（emoji span 等）。
    expect(placement.before).toBe(placement.host.firstChild)
  })

  it('returns null when the row has neither a title cell/td nor a card box', () => {
    const bare = document.createElement('div')
    expect(getCheckboxHost(bare)).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run tests/selectors.test.ts`
Expected: FAIL — `getCheckboxHost` が未定義（import エラー）、およびカードの `getNotebookRows` が 0 を返す（`toBe(2)` 失敗）。

- [ ] **Step 3: `SELECTORS` にカード用セレクタを追加する**

`src/content/selectors.ts` の `SELECTORS` で、`titleCell` の次の行に追加する:

```ts
  titleCell: 'td.title-column',
  // ---- カード（グリッド）表示。2026-07-05 実機調査済み（requirements.md §8.8）。----
  // ページは常に一方のモード（カード=project-button のみ / 一覧=project-table のみ）。
  cardRow: 'project-button.project-button',
  cardTitle: 'span.project-button-title',
  cardCheckboxHost: 'div.project-button-box',
  cardActionButton: 'project-action-button',
```

- [ ] **Step 4: `getNotebookRows` と `getRowIdentity` を両モード対応にする**

`getNotebookRows` を、テーブル行とカードの和集合を document order で返すよう変更する:

```ts
export function getNotebookRows(root: ParentNode = document): HTMLElement[] {
  // テーブル行とカードの和集合（ページは常に一方のモードなので片方は空）。
  return Array.from(root.querySelectorAll<HTMLElement>(`${SELECTORS.row}, ${SELECTORS.cardRow}`))
}
```

`getRowIdentity` を、テーブル/カードのどちらのタイトル span からも取れるよう変更する:

```ts
export function getRowIdentity(row: HTMLElement): RowIdentity {
  const titleEl = row.querySelector(SELECTORS.title) ?? row.querySelector(SELECTORS.cardTitle)
  const title = titleEl?.textContent?.trim() ?? ''
  return { title }
}
```

- [ ] **Step 5: `getCheckboxHost` を新設する**

`getTitleCell`（既存）はそのまま残す。その直後に `CheckboxHost` 型と `getCheckboxHost` を追加する:

```ts
// チェックボックスの注入ホストと挿入位置（before）。モード別に返す。
export interface CheckboxHost {
  host: HTMLElement
  before: Node | null
}

// テーブル行はタイトルセル先頭（新しい列を足すとヘッダーとズレるため）、
// カード行は box 内・3点メニュー（project-action-button）の直前（＝左）に注入する。
export function getCheckboxHost(row: HTMLElement): CheckboxHost | null {
  const titleCell = getTitleCell(row) ?? row.querySelector<HTMLElement>('td')
  if (titleCell) return { host: titleCell, before: titleCell.firstChild }
  const box = row.querySelector<HTMLElement>(SELECTORS.cardCheckboxHost)
  if (box) return { host: box, before: box.querySelector(SELECTORS.cardActionButton) }
  return null
}
```

- [ ] **Step 6: テストを実行して通過を確認する**

Run: `npx vitest run tests/selectors.test.ts`
Expected: PASS（既存 + 新規カードテスト全通過）。

- [ ] **Step 7: typecheck を実行する**

Run: `npm run typecheck`
Expected: エラー無し。

- [ ] **Step 8: コミットする**

```bash
git add src/content/selectors.ts tests/selectors.test.ts
git commit -m "feat(#66): セレクタをカード/テーブル両モード対応にする

getNotebookRows を和集合に、getRowIdentity を両タイトル対応に、
注入ホストを返す getCheckboxHost を新設。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: カード行へのチェックボックス注入とスタイル（row-checkbox）

**Files:**
- Modify: `src/content/ui/row-checkbox.ts`（注入ホスト取得を `getCheckboxHost` に置換）
- Modify: `src/content/ui/row-checkbox.css`（カード用の配置スタイル追加）
- Test: `tests/row-checkbox.test.ts`（カード注入テスト追加）
- Test: `tests/main-wiring.test.ts`（カード DOM で init する結線テスト追加）

**Interfaces:**
- Consumes: Task 1 の `getCheckboxHost(row): CheckboxHost | null`（`{ host, before }`）、既存の `getNotebookRows` / `getRowIdentity` / `getRowKey` / `isDeletableRow` / `CHECKBOX_ATTR`。
- Produces: なし（UI 注入のみ。挙動はテストで固定）。

- [ ] **Step 1: カード注入のテストを書く（失敗させる）**

`tests/row-checkbox.test.ts` の先頭付近（既存 import の下、最初の describe の前）にカード用フィクスチャを追加する:

```ts
// カード（グリッド）表示の1枚（requirements §8.8）。moreButton あり=所有カード。
const CARD = (title: string) => `
<project-button class="project-button"><mat-card class="project-button-card">
  <a class="primary-action-button" role="link"></a>
  <div class="project-button-box">
    <div class="project-button-box-icon">💻</div>
    <project-action-button><button class="project-button-more" aria-label="プロジェクトの操作メニュー"></button></project-action-button>
  </div>
  <div><span class="project-button-title">${title}</span></div>
</mat-card></project-button>`
```

`describe('injectRowCheckboxes', …)` の中に以下のテストを追加する（既存の `it` 群と同じ階層）:

```ts
it('injects a card checkbox just before the action button (left of the 3-dot)', () => {
  document.body.innerHTML = `<div>${CARD('Gamma')}</div>`
  const store = new SelectionStore()
  injectRowCheckboxes(store)
  const box = document.querySelector('.project-button-box')!
  const label = box.querySelector('label[data-nlk="checkbox-hit"]')!
  // box の子順で label が project-action-button の直前にある。
  const kids = [...box.children]
  expect(kids.indexOf(label)).toBe(kids.findIndex((c) => c.tagName.toLowerCase() === 'project-action-button') - 1)
  // 1 枚に 1 つだけ・冪等。
  injectRowCheckboxes(store)
  expect(box.querySelectorAll('[data-nlk-checkbox]').length).toBe(1)
})

it('does not inject into a card without a more button (recommended card)', () => {
  document.body.innerHTML = `
    <project-button class="project-button"><mat-card class="project-button-card">
      <div class="project-button-box"><div class="project-button-box-icon">🌐</div></div>
      <div><span class="project-button-title">Recommended</span></div>
    </mat-card></project-button>`
  injectRowCheckboxes(new SelectionStore())
  expect(document.querySelector('[data-nlk-checkbox]')).toBeNull()
})

it('updates the store when a card checkbox is toggled', () => {
  document.body.innerHTML = `<div>${CARD('Gamma')}</div>`
  const store = new SelectionStore()
  injectRowCheckboxes(store)
  const box = document.querySelector<HTMLInputElement>('[data-nlk-checkbox]')!
  box.checked = true
  box.dispatchEvent(new Event('change'))
  expect(store.has('title:Gamma')).toBe(true)
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: FAIL — カードにはチェックボックスが注入されず（`label` が null / 件数 0）テストが落ちる。

- [ ] **Step 3: `row-checkbox.ts` の注入ホスト取得を差し替える**

import 文を変更する（`getTitleCell` を `getCheckboxHost` に置換）:

```ts
import { getNotebookRows, getRowIdentity, getCheckboxHost, getRowKey, isDeletableRow } from '../selectors'
```

新規注入部（現在の `const host = getTitleCell(row) ?? row.querySelector('td')` 以降）を次に置き換える:

```ts
    // 注入ホストと挿入位置はモード別（テーブル=タイトルセル先頭 / カード=3点メニューの左）。
    const placement = getCheckboxHost(row)
    if (!placement) continue

    // スタイルは row-checkbox.css（co-located）で data 属性セレクタに対して当てる。
    const label = document.createElement('label')
    label.setAttribute('data-nlk', 'checkbox-hit')
    // 行クリック（ノートブックを開く）へ伝播させない。既定のトグルは維持。
    label.addEventListener('click', (ev) => ev.stopPropagation())

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    box.setAttribute('aria-label', target.title)
    box.checked = store.has(target.key)
    box.addEventListener('change', () =>
      store.set(getRowKey(row), box.checked),
    )

    label.appendChild(box)
    placement.host.insertBefore(label, placement.before)
```

（`target` は既存コードで `makeTarget(identity)` として同スコープに定義済み。変更しない。）

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `npx vitest run tests/row-checkbox.test.ts`
Expected: PASS（既存 + 新規カードテスト全通過）。

- [ ] **Step 5: カード用スタイルを追加する**

`src/content/ui/row-checkbox.css` の末尾に追加する。カードの `.project-button-box` は
アイコン左・アクション右のレイアウトなので、注入ラベルを右寄せして3点メニューの左に並べ、
カード全体オーバーレイ（`a.primary-action-button`）より前面に出す:

```css
/* カード（グリッド）表示: box 内で3点メニューの左に配置。カード全体リンク
   （a.primary-action-button）より前面に出すため stacking を確立する。 */
.project-button-box > label[data-nlk="checkbox-hit"] {
  margin: 0 4px 0 auto;
  padding: 4px;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
}
```

- [ ] **Step 6: カード DOM の結線テストを追加する（main-wiring）**

`tests/main-wiring.test.ts` の `describe('init', …)` に、カード DOM で init する
テストを追加する（`main.ts` 本体は変更しないが、カード経路の結線を固定する）。
まずファイル上部（既存 `LIST` 定数の下）にカード用フィクスチャを足す:

```ts
const CARD_LIST = `
<welcome-page><div class="all-projects-container"><div class="my-projects-container">
  <project-button class="project-button"><mat-card class="project-button-card">
    <div class="project-button-box">
      <div class="project-button-box-icon">💻</div>
      <project-action-button><button class="project-button-more"></button></project-action-button>
    </div>
    <div><span class="project-button-title">Gamma</span></div>
  </mat-card></project-button>
</div></div></welcome-page>`
```

`describe('init', …)` に追加:

```ts
  it('injects a checkbox in card (grid) view too', () => {
    document.body.innerHTML = CARD_LIST
    const dispose = init()
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(1)
    expect(document.querySelector('.project-button-box [data-nlk-checkbox]')).not.toBeNull()
    dispose()
  })
```

- [ ] **Step 7: 全テストと typecheck を実行する**

Run: `npm test && npm run typecheck`
Expected: 全テスト PASS、typecheck エラー無し。

- [ ] **Step 8: build して dist を確認する**

Run: `npm run build`
Expected: `✓ built in ...`（エラー無し）。

- [ ] **Step 9: コミットする**

```bash
git add src/content/ui/row-checkbox.ts src/content/ui/row-checkbox.css tests/row-checkbox.test.ts tests/main-wiring.test.ts
git commit -m "feat(#66): カード表示の3点メニュー左にチェックボックスを注入

row-checkbox の注入ホスト取得を getCheckboxHost に委譲し、カード用の
配置スタイルを追加。おすすめカード（moreButton 無し）は除外。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 実機 E2E 確認と §8.8 追記（コード最小 / 手動確認主体）

**Files:**
- Modify（必要時）: `docs/requirements.md` §8.8（カード削除フローが表と差異あれば追記）
- Modify（必要時）: `docs/e2e-checklist-phase1.md`（カード表示の確認手順追記）

- [ ] **Step 1: dist を読み込んで実機確認する**

`npm run build` 済みの `dist/` を `chrome://extensions` で読み込み、一覧ページのカード表示で spec §実機 E2E の 1〜4 を確認する:
1. カードのチェックボックスが3点メニューの左に出る / おすすめカードには出ない。
2. カードを数件選択 → アクションバー件数増 → 一括削除（メニュー→削除→確認）が正常。
3. カードで選択 → 一覧表示へ切替 → 選択維持（逆も）。
4. チェックボックスのクリックでノートブックが開かない。

- [ ] **Step 2: 差異があれば記録する**

カードの削除フロー（3点メニューの「削除」項目・確認ダイアログ）が表と異なる場合のみ
`docs/requirements.md` §8.8 に追記する。差異が無ければ「表と同一を確認」と1行追記する。
カード表示の確認観点を `docs/e2e-checklist-phase1.md` に1節追記する。

- [ ] **Step 3: コミットする（ドキュメント変更がある場合のみ）**

```bash
git add docs/requirements.md docs/e2e-checklist-phase1.md
git commit -m "docs(#66): カード表示の E2E 確認結果を §8.8 / e2e-checklist に反映

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- モード対応セレクタ（getNotebookRows 和集合 / getRowIdentity 両対応 / getCheckboxHost / cardRow 等）→ Task 1。✓
- isDeletableRow・getMoreButton は共通で不変 → Task 1 でテストのみ（おすすめカード除外を検証）。✓
- 注入ホスト差し替え・カード注入 → Task 2 Step 3。✓
- カード CSS（3点メニュー左・前面）→ Task 2 Step 5。✓
- クリック非伝播（アンカー外＋stopPropagation）→ Task 2 Step 1 のトグルテスト＋既存の非伝播テストで担保。✓
- 選択のモード跨ぎ維持（#67 observer）→ 追加実装不要、E2E で確認（Task 3 Step 1-3）。✓
- 削除は deleter 無改造再利用・カード削除フロー同一性の実機確認 → Task 3。✓
- main.ts / action-bar.ts 非改修 → 変更ファイルに含めない（Task 2 は row-checkbox のみ、main-wiring はテスト追加のみ）。✓
- 視覚的選択強調はスコープ外 → 計画に含めない。✓

**2. Placeholder scan:** TBD/TODO/「適切に」等なし。全コードステップに実コード・実コマンド・期待出力を記載。Task 3 の「差異があれば」は実機依存の条件分岐で、両分岐の行動（追記 / 「同一を確認」1行）を明示。✓

**3. Type consistency:** `getCheckboxHost(row): CheckboxHost | null`（`{ host: HTMLElement; before: Node | null }`）は Task 1 定義と Task 2 消費で一致。`placement.host.insertBefore(label, placement.before)` は `before: Node | null` と整合。`SELECTORS.cardActionButton` / `cardCheckboxHost` / `cardTitle` / `cardRow` の参照名も一致。✓
