import { getNotebookRows, getRowIdentity, getCheckboxHost, getRowKey, isDeletableRow } from '../selectors'
import { makeTarget } from '../../types'
import type { SelectionStore } from '../selection'
import './row-checkbox.css'

export const CHECKBOX_ATTR = 'data-nlk-checkbox'

export function injectRowCheckboxes(store: SelectionStore, root: ParentNode = document): void {
  for (const row of getNotebookRows(root)) {
    const identity = getRowIdentity(row)
    // 行挿入直後で ID もタイトルも未充填の行はスキップする。空キー `title:` を書き込まないため
    // （issue #28 補足 / #33）。スキップしても、充填時の characterData / childList / 属性変化で
    // observer が再発火し、そこで注入・同期される。ID が取れていればキーは有効なので注入する
    // （「すべて選択」/ 削除対象の規則 isSelectableRow と揃える。チェックボックスの無い行が
    // 選択されないようにする）。
    if (!identity.id && !identity.title) continue
    // 削除できない行（おすすめ = Reader ロール。判定は isDeletableRow / §8.14）にはチェックボックスを
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
      // 旧キーの掃除（prune）は行わない: Angular のノード再利用下では（キーが ID でもタイトルでも）、
      // observer tick で「削除/リネームで消えた行」と「フィルタタブで非表示になった
      // だけの行」を区別できず、可視性ベースで prune するとタブ往復で選択が無言消失
      // する（§8.5 のフィルタタブはサブセット描画）。削除フロー由来の解除は main.ts が
      // succeeded キーを明示的に外す（レビュー第3ラウンド finding 1）。
      if (existing.getAttribute(CHECKBOX_ATTR) !== target.key) {
        existing.setAttribute(CHECKBOX_ATTR, target.key)
      }
      // キーが ID のとき（§8.14）、リネームではキーが変わらないので aria-label は別に追従させる。
      // タイトルが一時的に空の間は上書きしない（aria-label="" を書かない。issue #28 補足）。
      if (target.title && existing.getAttribute('aria-label') !== target.title) {
        existing.setAttribute('aria-label', target.title)
      }
      existing.checked = store.has(target.key)
      continue
    }
    // 注入ホストと挿入位置はモード別（テーブル=タイトルセル先頭 / カード=3点メニューの左）。
    const placement = getCheckboxHost(row)
    if (!placement) continue

    // スタイルは row-checkbox.css（co-located）で data 属性セレクタに対して当てる。
    const label = document.createElement('label')
    label.setAttribute('data-nlk', 'checkbox-hit')
    // 行クリック（ノートブックを開く）へ伝播させない。既定のトグルは維持。
    label.addEventListener('click', (ev) => ev.stopPropagation())

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute(CHECKBOX_ATTR, target.key)
    // タイトル未充填（ID だけ取れている）なら付けない。充填時に上の同期パスが付ける。
    if (target.title) box.setAttribute('aria-label', target.title)
    box.checked = store.has(target.key)
    box.addEventListener('change', () =>
      store.set(getRowKey(row), box.checked),
    )

    label.appendChild(box)
    placement.host.insertBefore(label, placement.before)
  }
}
