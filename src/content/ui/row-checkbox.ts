import { getNotebookRows, getRowIdentity, getTitleCell, getRowKey, isDeletableRow } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'
import './row-checkbox.css'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    const identity = getRowIdentity(row)
    // 行挿入直後でタイトル span が未充填の行はスキップする。空キー `title:` /
    // aria-label="" を書き込まないため（issue #28 補足）。スキップしても、
    // タイトル充填時の characterData / childList 変化で observer が再発火し、
    // そこで注入・同期される。
    if (!identity.title) continue
    // 削除できない行（おすすめ = Reader ロール、3点メニュー無し）にはチェックボックスを
    // 出さない（issue #23）。ノード再利用で削除可能行→削除不可行に化けた場合は
    // 注入済みラベルを掃除する。
    if (!isDeletableRow(row)) {
      const existing = row.querySelector<HTMLElement>(`[${CHECKBOX_ATTR}]`)
      existing?.closest('label[data-nlk="checkbox-hit"]')?.remove()
      continue
    }
    const target = makeTarget(identity)
    const existing = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    if (existing) {
      // 行ノードが Angular によって別ノートブックで再利用され得るため、既存の
      // チェックボックスも現在の identity へ同期する（陳腐化した checked /
      // aria-label / キー属性が SelectionStore や読み上げとズレるのを防ぐ / issue #25）。
      // 属性書き込みはキー変化時のみ（無関係な mutation バッチでの全行無条件書き込み
      // ＋属性セレクタ再評価を避ける）。
      // 旧キーの掃除（prune）は行わない: title 識別＋Angular のノード再利用下では、
      // observer tick で「削除/リネームで消えた行」と「フィルタタブで非表示になった
      // だけの行」を区別できず、可視性ベースで prune するとタブ往復で選択が無言消失
      // する（§8.5 のフィルタタブはサブセット描画）。削除フロー由来の解除は main.ts が
      // succeeded キーを明示的に外す（レビュー第3ラウンド finding 1）。
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
}
