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
}) {
  const { store, t, handlers, root = document.body } = opts

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
  const render = (size: number) => {
    count.textContent = t('selectedCount', { count: size })
    del.textContent = t('deleteSelected', { count: size })
    del.disabled = busy || size === 0
    del.hidden = busy
    stop.hidden = !busy
  }
  const unsub = store.onChange(render)
  render(store.size)

  return {
    setProgress(text: string | null) { progress.textContent = text ?? '' },
    setBusy(b: boolean) { busy = b; render(store.size) },
    destroy() { unsub(); bar.remove() },
  }
}
