import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
} from './selectors'
import { makeTarget, type NotebookTarget } from '../types'
import { SelectionStore } from './selection'
import { detectLang, createT } from './i18n'
import { injectRowCheckboxes } from './ui/row-checkbox'
import { mountActionBar } from './ui/action-bar'
import { confirmDeletion } from './confirm-dialog'
import { deleteNotebooks, type DeleterDeps } from './deleter'
import { waitFor, safeClick } from './dom-utils'

export const VERSION = '0.1.0'

export function buildTargets(store: SelectionStore, root: ParentNode = document): NotebookTarget[] {
  const selected = new Set(store.keys())
  return getNotebookRows(root)
    .map((row) => makeTarget(getRowIdentity(row)))
    .filter((tgt) => selected.has(tgt.key))
}

export function init(root: ParentNode = document): void {
  const store = new SelectionStore()
  const t = createT(detectLang())

  injectRowCheckboxes(store, root)

  let currentAbort: AbortController | null = null

  const bar = mountActionBar({
    store,
    t,
    handlers: {
      onSelectAll: () => {
        store.replaceAll(getNotebookRows(root).map((r) => makeTarget(getRowIdentity(r)).key))
        syncCheckboxes(store, root)
      },
      onClearAll: () => { store.clear(); syncCheckboxes(store, root) },
      onDelete: () => { void runDelete() },
      onStop: () => { currentAbort?.abort() },
    },
  })

  async function runDelete(): Promise<void> {
    const targets = buildTargets(store, root)
    if (targets.length === 0) return
    const totalRows = getNotebookRows(root).length
    const isSelectAll = targets.length === totalRows
    const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
    if (!ok) return

    const ac = new AbortController()
    currentAbort = ac
    bar.setBusy(true)
    const deps: DeleterDeps = {
      findRow: (tgt) => findRowByIdentity(tgt, root),
      getMoreButton,
      getDeleteMenuItem: () => getDeleteMenuItem(),
      getConfirmDialog: () => getConfirmDialog(),
      getConfirmDeleteButton,
      click: (el) => { safeClick(el) },
      waitFor,
    }
    const result = await deleteNotebooks(targets, deps, {
      signal: ac.signal,
      onProgress: (p) => bar.setProgress(t('progress', { done: p.completed, total: p.total })),
    })
    bar.setBusy(false)
    currentAbort = null
    if (result.failed.length > 0) bar.setProgress(t('domError'))
    else bar.setProgress(t('doneSummary', { ok: result.succeeded.length, ng: result.failed.length }))
    // 成功分のみ選択解除
    for (const key of result.succeeded) store.set(key, false)
    syncCheckboxes(store, root)
  }

  // 一覧が再描画されたらチェックボックスを注入し直す
  const observer = new MutationObserver(() => injectRowCheckboxes(store, root))
  const container = (root instanceof Document ? root.body : (root as Element)) ?? document.body
  observer.observe(container, { childList: true, subtree: true })
}

function syncCheckboxes(store: SelectionStore, root: ParentNode): void {
  for (const row of getNotebookRows(root)) {
    const key = makeTarget(getRowIdentity(row)).key
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (box) box.checked = store.has(key)
  }
}

// content script として読み込まれたときだけ自動起動（テスト時は import のみで副作用なし）
if (typeof document !== 'undefined' && document.querySelector('.all-projects-container')) {
  init()
}
