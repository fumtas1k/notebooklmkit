import type { SelectionStore } from '../selection'
import type { createT } from '../i18n'
import './action-bar.css'

export interface ActionBarHandlers {
  onSelectAll(): void
  onClearAll(): void
  onDelete(): void
  onStop(): void
}

export function mountActionBar(opts: {
  store: SelectionStore
  t: ReturnType<typeof createT>
  handlers: ActionBarHandlers
  root?: HTMLElement
  count?: () => number
}) {
  const { store, t, handlers, root = document.body, count: countFn } = opts

  const bar = document.createElement('div')
  bar.className = 'nlk-action-bar'
  bar.setAttribute('data-nlk', 'action-bar')

  const mkBtn = (nlk: string, label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.setAttribute('data-nlk', nlk)
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  const selectAll = mkBtn('bar-select-all', t('selectAll'), handlers.onSelectAll)
  const clearAll = mkBtn('bar-clear-all', t('deselectAll'), handlers.onClearAll)
  const count = document.createElement('span')
  count.setAttribute('data-nlk', 'bar-count')
  const progress = document.createElement('span')
  progress.setAttribute('data-nlk', 'bar-progress')
  const spacer = document.createElement('span')
  spacer.className = 'nlk-spacer'
  const del = mkBtn('bar-delete', '', handlers.onDelete)
  const stop = mkBtn('bar-stop', t('abort'), handlers.onStop)
  stop.hidden = true

  bar.append(selectAll, clearAll, count, progress, spacer, del, stop)
  root.insertBefore(bar, root.firstChild)

  let busy = false
  const currentCount = () => countFn?.() ?? store.size
  // refresh() は一覧 observer の tick ごとに呼ばれるため、実 DOM と比べて変わるものだけ書き込む
  // （冗長な書き換えと、mount 先が将来監視対象に入った場合の自己発火ループを避ける。
  // injectRowCheckboxes の「変化時のみ書き込み」と対称。issue #72）。前回値のキャッシュではなく
  // 実 DOM と比べるので、外から書き換えられた表示も次の render で直る。
  const setText = (el: HTMLElement, text: string) => { if (el.textContent !== text) el.textContent = text }
  const render = () => {
    const size = currentCount()
    setText(count, t('selectedCount', { count: size }))
    setText(del, t('deleteSelected', { count: size }))
    const disabled = busy || size === 0
    if (del.disabled !== disabled) del.disabled = disabled
    if (del.hidden !== busy) del.hidden = busy
    if (stop.hidden !== !busy) stop.hidden = !busy
  }
  const unsub = store.onChange(() => render())
  render()

  return {
    setProgress(text: string | null) { progress.textContent = text ?? '' },
    setBusy(b: boolean) { busy = b; render() },
    refresh() { render() },
    destroy() { unsub(); bar.remove() },
  }
}
