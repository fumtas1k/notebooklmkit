import { getNotebookRows, getRowIdentity } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    if (row.querySelector(`[${CHECKBOX_ATTR}]`)) continue // 冪等
    const id = getRowIdentity(row)
    const target = makeTarget(id)

    const cell = document.createElement('td')
    cell.className = 'nlk-checkbox-cell'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    box.checked = store.has(target.key)
    box.addEventListener('change', () => store.set(target.key, box.checked))
    cell.appendChild(box)
    row.insertBefore(cell, row.firstChild)
  }
}
