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

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    box.setAttribute('aria-label', target.title)
    box.checked = store.has(target.key)
    box.style.marginRight = '12px'
    box.style.verticalAlign = 'middle'
    // 行クリック（ノートブックを開く）へ伝播させない。既定のトグルは維持。
    box.addEventListener('click', (ev) => ev.stopPropagation())
    box.addEventListener('change', () =>
      store.set(getRowKey(row), box.checked),
    )
    host.insertBefore(box, host.firstChild)
  }
}
