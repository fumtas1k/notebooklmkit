import { getNotebookRows, getRowIdentity, getTitleCell, getRowKey } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'
import './row-checkbox.css'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    const existing = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    if (existing) {
      // 行ノードが Angular によって別ノートブックで再利用され得るため、既存の
      // チェックボックスも現在の identity へ同期する（陳腐化した checked /
      // aria-label / キー属性が SelectionStore や読み上げとズレるのを防ぐ / issue #25）。
      const target = makeTarget(getRowIdentity(row))
      const prevKey = existing.getAttribute(CHECKBOX_ATTR)
      if (prevKey !== target.key) {
        // キーが変わった＝この行ノードが別ノートブックへ付け替えられた。旧キーが
        // store に残ると「表示は未チェックなのに件数だけ残る」幽霊選択になり、
        // 無言 no-op 削除や同名行の意図しないプリチェックを招くため掃除する。
        // 属性書き込みも値が変わったときだけ行い、無関係な mutation バッチでの
        // 全行無条件書き込み（＋属性セレクタ再評価）を避ける。
        if (prevKey) store.set(prevKey, false)
        existing.setAttribute(CHECKBOX_ATTR, target.key)
        existing.setAttribute('aria-label', target.title)
      }
      existing.checked = store.has(target.key)
      continue
    }
    // 新しい <td> を足すと列数がヘッダー行とズレるため、既存のタイトルセル内に入れる。
    const host = getTitleCell(row) ?? row.querySelector('td')
    if (!host) continue

    const id = getRowIdentity(row)
    const target = makeTarget(id)

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
    host.insertBefore(label, host.firstChild)
  }
}
