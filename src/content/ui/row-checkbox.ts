import { getNotebookRows, getRowIdentity, getTitleCell, getRowKey } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'
import './row-checkbox.css'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  const rows = getNotebookRows(root)
  const liveKeys = new Set<string>()
  // タイトル未充填の描画途中行があるうちは間引きを見送る（下記ガード）。
  let renderComplete = rows.length > 0

  for (const row of rows) {
    const id = getRowIdentity(row)
    if (!id.title) {
      // タイトル span 未充填の描画途中行。空キー（title:）で同期/間引きすると
      // 選択を壊すため、この行はスキップし間引きパスも見送る（後続変化で再実行）。
      renderComplete = false
      continue
    }
    const target = makeTarget(id)
    liveKeys.add(target.key)

    const existing = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    if (existing) {
      // 行ノードが Angular によって別ノートブックで再利用され得るため、既存の
      // チェックボックスも現在の identity へ同期する（陳腐化した checked /
      // aria-label / キー属性が SelectionStore や読み上げとズレるのを防ぐ / issue #25）。
      // 属性書き込みはキー変化時のみ行い、無関係な mutation バッチでの全行無条件
      // 書き込み（＋属性セレクタ再評価）を避ける。旧キーの掃除はパス2で行う
      // （並び替え時に他行がキーを引き継ぐ前にノード単位で prune すると、まだ
      // 存在する選択を無言で失うため / レビュー第2ラウンド finding A）。
      if (existing.getAttribute(CHECKBOX_ATTR) !== target.key) {
        existing.setAttribute(CHECKBOX_ATTR, target.key)
        existing.setAttribute('aria-label', target.title)
      }
      existing.checked = store.has(target.key)
      continue
    }
    // 新しい <td> を足すと列数がヘッダー行とズレるため、既存のタイトルセル内に入れる。
    const host = getTitleCell(row) ?? row.querySelector('td')
    if (!host) continue

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

  // パス2: 現在の行集合に無いキーを間引き、「表示は未チェックなのに件数だけ残る」
  // 幽霊選択を防ぐ。ノード単位で消すと並び替え時に他行が引き継ぐ前のキーを誤って
  // 消すため、全行同期後に「どの行も持たないキー」だけを消す（同名タイトルの既知
  // エッジとも整合: どこかの行がそのタイトルを持つ限りキーは生存）。描画途中
  // （空一覧 / タイトル未充填行あり）では見送る（レビュー第2ラウンド finding A）。
  if (renderComplete) {
    for (const key of store.keys()) {
      if (!liveKeys.has(key)) store.set(key, false)
    }
  }
}
