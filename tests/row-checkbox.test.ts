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
})
