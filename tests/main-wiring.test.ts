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
