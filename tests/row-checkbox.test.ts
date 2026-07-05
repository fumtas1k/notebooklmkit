import { describe, it, expect, beforeEach } from 'vitest'
import { injectRowCheckboxes, CHECKBOX_ATTR } from '../src/content/ui/row-checkbox'
import { SelectionStore } from '../src/content/selection'

// 各行に moreButton（削除可能な行のマーカー。issue #23）を持たせる。moreButton の
// 有無に関するテストは各テスト内で個別のフィクスチャを使う。
const LIST = `
<project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table>`

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

describe('injectRowCheckboxes', () => {
  beforeEach(() => { document.body.innerHTML = LIST })

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

  it('labels the injected checkbox with the notebook title for a11y', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const box = document.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box.getAttribute('aria-label')).toBe('A')
  })

  it('injects into the existing title cell without adding a new column', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    // no extra <td> added: row still has exactly its original two cells
    // (title-column + actions-column, per the fixture)
    expect(row.querySelectorAll('td').length).toBe(2)
    // checkbox lives inside the title cell, not as a sibling column
    const titleCell = row.querySelector('td.title-column')!
    expect(titleCell.querySelector(`[${CHECKBOX_ATTR}]`)).not.toBeNull()
  })

  it('does not let a checkbox click bubble to the row (avoids navigation)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    let rowClicked = false
    row.addEventListener('click', () => { rowClicked = true })
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rowClicked).toBe(false)
  })

  it('writes the row current key at event time, not a stale injection-time key', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    // simulate the same node being reused with a new identity
    row.querySelector('span.project-table-title')!.textContent = 'A-renamed'
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(store.has('title:A-renamed')).toBe(true)
    expect(store.has('title:A')).toBe(false)
  })

  it('does not let a click on the label hit area bubble to the row (avoids navigation)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    let rowClicked = false
    row.addEventListener('click', () => { rowClicked = true })
    const label = row.querySelector<HTMLLabelElement>('label[data-nlk="checkbox-hit"]')!
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rowClicked).toBe(false)
  })

  it('fires change exactly once on a direct input click (no label re-activation cancelling the toggle)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const box = document.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    let changeCount = 0
    box.addEventListener('change', () => { changeCount++ })
    box.click()
    expect(changeCount).toBe(1)
    expect(box.checked).toBe(true)
    expect(store.has('title:A')).toBe(true)
  })

  it('toggles the checkbox and the selection store via a click on the label hit area', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    const label = row.querySelector<HTMLLabelElement>('label[data-nlk="checkbox-hit"]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box.checked).toBe(false)
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(box.checked).toBe(true)
    expect(store.has('title:A')).toBe(true)
  })

  // issue #25: Angular が <tr> を別ノートブックで再利用したとき、既存チェックボックスの
  // aria-label / CHECKBOX_ATTR キーが再注入時に現在の identity へ同期されること。
  it('re-syncs an existing checkbox aria-label and key when the row node is reused with a new title', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    // 行ノードが別ノートブックで再利用されるケースをシミュレート
    row.querySelector('span.project-table-title')!.textContent = 'A-renamed'
    injectRowCheckboxes(store)
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box.getAttribute('aria-label')).toBe('A-renamed')
    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A-renamed')
    // 二重注入されないこと（既存の冪等性は維持）
    expect(row.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(1)
  })

  // issue #25: 行の再利用に伴い checked（store 同期状態）も再注入のたびに更新されること。
  it('re-syncs an existing checkbox checked state to match the store for the new identity', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(store.has('title:A')).toBe(true)

    // 行が別タイトルで再利用され、そのタイトルは未選択
    row.querySelector('span.project-table-title')!.textContent = 'C'
    injectRowCheckboxes(store)
    expect(box.checked).toBe(false)
    expect(store.has('title:C')).toBe(false)
  })

  // レビュー第3ラウンド finding 1（issue #25 フォロー撤回）: フィルタタブ（すべて/
  // マイ/おすすめ）切替で行が一時的に非表示（DOM から除去）になっても、選択は
  // 消えないこと。observer tick での可視性ベース prune は「削除/リネームで消えた
  // 行」と「フィルタタブで非表示になっただけの行」を区別できず、タブ往復で選択が
  // 無言消失する回帰を生むため、prune 自体を撤去した。
  it('does not prune a selection when its row is hidden (filter tab round-trip persists selection)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const rows = document.querySelectorAll('tr[mat-row]')
    const rowA = rows[0]
    const boxA = rowA.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    boxA.checked = true
    boxA.dispatchEvent(new Event('change'))
    expect(store.has('title:A')).toBe(true)

    // フィルタタブ切替をシミュレート: A の行がサブセット描画から消える（B は残る）
    const tbody = rowA.parentElement!
    tbody.removeChild(rowA)
    injectRowCheckboxes(store)

    // prune されず、選択は保持される
    expect(store.has('title:A')).toBe(true)
    expect(store.size).toBe(1)

    // タブを戻す（A の行を再挿入）と選択表示が復元される
    tbody.insertBefore(rowA, tbody.firstChild)
    injectRowCheckboxes(store)
    const restoredBoxA = rowA.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(restoredBoxA.checked).toBe(true)
  })

  // レビュー第2ラウンド finding A（S1）: 並び替えで先頭挿入が起きると、旧実装は
  // 1 パス内でノード単位に prune するため、他行がそのキーを引き継ぐ前に消してしまい
  // まだ存在する選択が無言で失われる。2 フェーズ reconcile ではこれを防ぐ。
  it('keeps a selection alive across a reorder where another row inherits the key (S1)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const rows = document.querySelectorAll('tr[mat-row]')
    const node1 = rows[0]
    const node2 = rows[1]
    const box1 = node1.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box1.checked = true
    box1.dispatchEvent(new Event('change'))
    expect(store.has('title:A')).toBe(true)

    // 先頭挿入をシミュレート: node1 は新規ノートブック N、node2 が旧 A を引き継ぐ
    node1.querySelector('span.project-table-title')!.textContent = 'N'
    node2.querySelector('span.project-table-title')!.textContent = 'A'
    injectRowCheckboxes(store)

    expect(store.has('title:A')).toBe(true)
    const box2 = node2.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box2.checked).toBe(true)
    const box1After = node1.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box1After.checked).toBe(false)
  })

  // レビュー第2ラウンド finding A（S2）: シフトで表示だけチェックが残り件数が 0 になる
  // （表示と件数の乖離）ケース。
  it('keeps display and store count consistent across a shift (S2)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const rows = document.querySelectorAll('tr[mat-row]')
    const node1 = rows[0]
    const node2 = rows[1]
    const box2 = node2.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box2.checked = true
    box2.dispatchEvent(new Event('change'))
    expect(store.has('title:B')).toBe(true)

    // シフトをシミュレート: node1 が旧 B を引き継ぎ、node2 は新規 X になる
    node1.querySelector('span.project-table-title')!.textContent = 'B'
    node2.querySelector('span.project-table-title')!.textContent = 'X'
    injectRowCheckboxes(store)

    expect(store.has('title:B')).toBe(true)
    expect(store.size).toBe(1)
    const box1 = node1.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box1.checked).toBe(true)
  })

  // issue #28 補足: 行挿入とタイトル span 充填の間に observer が発火すると
  // identity が空文字になり、空キー `title:` / aria-label="" が書き込まれてしまう。
  // タイトル未充填の行は注入自体をスキップする（充填時の mutation で再発火して注入される）。
  it('does not inject a checkbox into a row whose title is still empty (issue #28)', () => {
    const store = new SelectionStore()
    document.body.innerHTML = `
    <project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title"></span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table>`
    injectRowCheckboxes(store)
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(0)

    // タイトル充填後の再実行（observer 再発火のシミュレート）で通常どおり注入される
    document.querySelector('span.project-table-title')!.textContent = 'A'
    injectRowCheckboxes(store)
    const box = document.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A')
    expect(box.getAttribute('aria-label')).toBe('A')
  })

  // issue #28 補足: 既存チェックボックスのある行のタイトルが一時的に空になっても、
  // 空キー `title:` / aria-label="" で上書きしない（同期もスキップ）。
  it('does not stamp an empty key onto an existing checkbox while the title is transiently empty (issue #28)', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))

    row.querySelector('span.project-table-title')!.textContent = ''
    injectRowCheckboxes(store)
    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A')
    expect(box.getAttribute('aria-label')).toBe('A')
    expect(box.checked).toBe(true)
  })

  // issue #23: 「おすすめのノートブック」(Reader ロール) 行には3点メニュー
  // (moreButton) が DOM に存在しない。削除起点が無い行にチェックボックスを
  // 出すと、選択してもクリックの起点が無く削除が無言 no-op になる。
  // moreButton の有無で削除可否を判定する（ロール文字列はロケール依存で
  // 脆いため採用しない。実機で誤分類ゼロを確認済み）。
  it('does not inject a checkbox into a row without a more button (issue #23: recommended/Reader row)', () => {
    const store = new SelectionStore()
    document.body.innerHTML = `
    <project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Recommended</span></td></tr>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Owned</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table>`
    injectRowCheckboxes(store)
    const rows = document.querySelectorAll('tr[mat-row]')
    expect(rows[0].querySelector(`[${CHECKBOX_ATTR}]`)).toBeNull()
    expect(rows[1].querySelector(`[${CHECKBOX_ATTR}]`)).not.toBeNull()
  })

  // issue #23 補足（防御的）: Angular のノード再利用で、既にチェックボックスが
  // 注入済みの行が削除不可行（moreButton 無し）に化けた場合、幽霊選択を防ぐため
  // 注入済みラベルを除去する。
  it('removes an already-injected checkbox when the row is reused as a non-deletable row (issue #23)', () => {
    const store = new SelectionStore()
    document.body.innerHTML = `
    <project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Owned</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table>`
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    expect(row.querySelector(`[${CHECKBOX_ATTR}]`)).not.toBeNull()

    // ノード再利用をシミュレート: moreButton が消え、削除不可の「おすすめ」行になる
    row.querySelector('project-action-button')!.remove()
    row.querySelector('span.project-table-title')!.textContent = 'Recommended'
    injectRowCheckboxes(store)

    expect(row.querySelector(`[${CHECKBOX_ATTR}]`)).toBeNull()
    expect(row.querySelector('label[data-nlk="checkbox-hit"]')).toBeNull()
  })
})
