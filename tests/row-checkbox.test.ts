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
    // no extra <td> added: row still has exactly its original one cell
    expect(row.querySelectorAll('td').length).toBe(1)
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

  // issue #25 フォロー: 行が別ノートブックへ付け替えられたとき、旧キーを store から
  // 掃除して「表示は未チェックなのに件数だけ残る」幽霊選択を残さないこと。
  it('prunes the stale old key from the store when a selected row is reused with a new title', () => {
    const store = new SelectionStore()
    injectRowCheckboxes(store)
    const row = document.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(store.size).toBe(1)

    // この行ノードが別ノートブック（未選択の C）へ付け替えられる
    row.querySelector('span.project-table-title')!.textContent = 'C'
    injectRowCheckboxes(store)

    // 旧キー title:A は残らず、幽霊選択（件数だけ 1）にならない
    expect(store.has('title:A')).toBe(false)
    expect(store.size).toBe(0)
    expect(box.checked).toBe(false)
  })
})
