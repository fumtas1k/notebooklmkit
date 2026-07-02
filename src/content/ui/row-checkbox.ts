import { getNotebookRows, getRowIdentity, getTitleCell, getRowKey } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    if (row.querySelector(`[${CHECKBOX_ATTR}]`)) continue // 冪等
    // 新しい <td> を足すと列数がヘッダー行とズレるため、既存のタイトルセル内に入れる。
    const host = getTitleCell(row) ?? row.querySelector('td')
    if (!host) continue

    const id = getRowIdentity(row)
    const target = makeTarget(id)

    const label = document.createElement('label')
    label.setAttribute('data-nlk', 'checkbox-hit')
    label.style.padding = '8px'
    label.style.cursor = 'pointer'
    label.style.display = 'inline-block'
    label.style.verticalAlign = 'middle'
    label.style.marginRight = '4px'
    // 行クリック（ノートブックを開く）へ伝播させない。既定のトグルは維持。
    label.addEventListener('click', (ev) => ev.stopPropagation())

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    box.setAttribute('aria-label', target.title)
    box.checked = store.has(target.key)
    box.style.width = '18px'
    box.style.height = '18px'
    box.style.cursor = 'pointer'
    box.style.display = 'block'
    box.addEventListener('change', () =>
      store.set(getRowKey(row), box.checked),
    )

    label.appendChild(box)
    host.insertBefore(label, host.firstChild)
  }
}
