import {
  getNotebookRows, getRowIdentity, findRowByIdentity, getRowKey,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
} from './selectors'
import { makeTarget, type NotebookTarget } from '../types'
import { SelectionStore } from './selection'
import { detectLang, createT } from './i18n'
import { injectRowCheckboxes, CHECKBOX_ATTR } from './ui/row-checkbox'
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

// confirm 表示中に選択・一覧が変化していないかの検証に使う（issue #13）。
// キーはタイトル由来で重複し得る（同名ノートブック）ため、多重集合として比較する。
// 順序は比較しない（削除順が変わるだけで対象集合は同じ）。
export function sameTargetKeys(a: NotebookTarget[], b: NotebookTarget[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const t of a) counts.set(t.key, (counts.get(t.key) ?? 0) + 1)
  for (const t of b) {
    const n = counts.get(t.key)
    if (!n) return false
    counts.set(t.key, n - 1)
  }
  return true
}

export function init(root: ParentNode = document): () => void {
  const store = new SelectionStore()
  const t = createT(detectLang())

  injectRowCheckboxes(store, root)

  let currentAbort: AbortController | null = null
  let deleting = false
  // 削除処理が pending の間に disposer が呼ばれた（＝ SPA 遷移などで teardown された）
  // ことを内側 finally から判定するためのフラグ（issue #16）。
  let disposed = false

  const bar = mountActionBar({
    store,
    t,
    handlers: {
      onSelectAll: () => {
        store.replaceAll(getNotebookRows(root).map((r) => getRowKey(r)))
        syncCheckboxes(store, root)
      },
      onClearAll: () => { store.clear(); syncCheckboxes(store, root) },
      onDelete: () => { void runDelete() },
      onStop: () => { currentAbort?.abort() },
    },
  })

  // 一覧が再描画されたらチェックボックスを注入し直す
  // アクションバー/進捗表示は document.body 側にあるため、再スキャン対象は
  // ノートブック一覧コンテナに絞り、setProgress 等のテキスト更新で
  // 無駄な再スキャンが走らないようにする。
  const observer = new MutationObserver(() => injectRowCheckboxes(store, root))
  const listContainer = root.querySelector('.all-projects-container')
  const container = listContainer ?? (root instanceof Document ? root.body : (root as Element)) ?? document.body
  observer.observe(container, { childList: true, subtree: true })

  async function runDelete(): Promise<void> {
    if (deleting) return
    deleting = true
    try {
      const targets = buildTargets(store, root)
      if (targets.length === 0) return
      const totalRows = getNotebookRows(root).length
      const isSelectAll = targets.length === totalRows
      const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
      // confirm 待機中に teardown された場合は、たとえ確定されても進めない。
      // currentAbort は confirm 後にしか代入されないため待機中の dispose は
      // no-op になり、確認ダイアログも init 管理外の document.body に残って
      // teardown を生き延びる。ここで再チェックしないと、dispose 後に確定
      // されたときに新品の AbortController で破壊的削除一式が始まってしまう
      // （issue #16 と同じハザード / レビュー第2ラウンド finding B）。
      if (!ok || disposed) return
      // confirm 表示中に選択・一覧が変化していれば中止する（issue #13）。
      // 削除は取り消し不可のため、古いスナップショットのまま進めない。
      // フォーカストラップ（confirm-dialog.ts）が主経路を塞ぎ、こちらはキー
      // 多重集合レベルの安全網（同名タイトルの置換までは検出できない ——
      // タイトル識別の既知の制約。types.ts 参照）。検証通過後は確認時の順序を
      // 保つため targets をそのまま使う。
      if (!sameTargetKeys(targets, buildTargets(store, root))) {
        bar.setProgress(t('selectionChanged'))
        return
      }

      const ac = new AbortController()
      currentAbort = ac
      // 削除中は自分たちで行を書き換える（＝一覧を大量に mutate する）ため、
      // 再スキャン observer を止めて O(n^2) の無駄な再注入を避ける。
      observer.disconnect()
      bar.setBusy(true)
      try {
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
        if (result.aborted) {
          const rest = targets.length - result.succeeded.length - result.failed.length
          bar.setProgress(t('abortedSummary', { ok: result.succeeded.length, rest }))
        } else {
          bar.setProgress(t('doneSummary', { ok: result.succeeded.length, ng: result.failed.length }))
        }
        // 成功分のみ選択解除
        for (const key of result.succeeded) store.set(key, false)
        syncCheckboxes(store, root)
      } catch (err) {
        console.error('notebooklmkit: unexpected error during delete', err)
        bar.setProgress(t('domError'))
      } finally {
        bar.setBusy(false)
        currentAbort = null
        // dispose 済み（disposer が呼ばれた）なら observer を復活させない。
        // そうしないと、削除 pending 中に teardown された破棄済み observer が
        // ここで再度 observe されて再注入を続けてしまう（issue #16）。
        if (!disposed) {
          // 再スキャンを再開し、削除実行中に変化した行を一度だけ同期し直す。
          observer.observe(container, { childList: true, subtree: true })
          injectRowCheckboxes(store, root)
        }
      }
    } finally {
      deleting = false
    }
  }

  return () => {
    disposed = true
    // 進行中の削除ループも停止させる。abort しないと deleter は残りの確定ターゲット
    // 全件へ破壊的クリックを teardown 後も打ち続け、しかも bar.destroy() で Stop
    // ボタンごと消えるため中断手段が無くなる（取り消し不可の操作 / issue #16）。
    currentAbort?.abort()
    observer.disconnect()
    bar.destroy()
  }
}

function syncCheckboxes(store: SelectionStore, root: ParentNode): void {
  for (const row of getNotebookRows(root)) {
    const key = getRowKey(row)
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    if (box) box.checked = store.has(key)
  }
}

// NotebookLM はクライアントレンダリングの Angular SPA のため、モジュール評価時点
// では `.all-projects-container` がまだ DOM に無いことが多い（cold load / SPA 遷移）。
// 既に存在すれば即 init、無ければ出現を待って一度だけ init する。
export function start(root: ParentNode = document): () => void {
  const CONTAINER_SELECTOR = '.all-projects-container'

  if (root.querySelector(CONTAINER_SELECTOR)) {
    return init(root)
  }

  let disposeInit: (() => void) | null = null
  const target: Element =
    (root instanceof Document ? (root.documentElement ?? root.body) : (root as Element)) ?? document.documentElement

  const bootstrapObserver = new MutationObserver(() => {
    if (disposeInit) return // 既に init 済みなら再度呼ばない
    if (root.querySelector(CONTAINER_SELECTOR)) {
      bootstrapObserver.disconnect()
      disposeInit = init(root)
    }
  })
  bootstrapObserver.observe(target, { childList: true, subtree: true })

  return () => {
    bootstrapObserver.disconnect()
    disposeInit?.()
  }
}

// content script として読み込まれたときだけ自動起動。
// テスト(jsdom)では location.hostname が notebooklm.google.com にならないため
// import しても副作用は発生しない。
if (
  typeof document !== 'undefined' &&
  typeof location !== 'undefined' &&
  location.hostname === 'notebooklm.google.com'
) {
  start()
}
