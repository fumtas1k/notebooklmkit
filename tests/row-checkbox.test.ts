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
